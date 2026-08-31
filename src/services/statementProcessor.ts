import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { db } from "../db";
import {
  statements,
  transactions,
  subscriptions,
  subscriptionOccurrences,
  entities,
  entityAliases,
  unknownAccounts,
  categories,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import { extractFromCSV } from "./extraction/csvExtractor";
import { extractFromXLSX } from "./extraction/xlsxExtractor";
import { extractFromPDF } from "./extraction/pdfExtractor";
import { classifier } from "./ml/classifier";
import { recurringDetector } from "./ml/recurringDetector";
import { parseDate } from "./utils/parseHelpers";
import type { ProcessingJob, NormalizedTransaction, RawTransaction } from "../types";

export async function processStatement(job: ProcessingJob): Promise<void> {
  const { statementId, userId, filePath, fileType, accountId } = job;

  try {
    // Mark as processing
    await db
      .update(statements)
      .set({ status: "processing", processingStartedAt: new Date() })
      .where(eq(statements.id, statementId));

    // Read file
    const fileBuffer = await fs.readFile(filePath);
    const fileContent = fileBuffer.toString("utf-8");

    // Extract transactions
    let extractionResult;
    switch (fileType.toLowerCase()) {
      case "csv":
        extractionResult = await extractFromCSV(fileContent);
        break;
      case "xlsx":
      case "xls":
        extractionResult = await extractFromXLSX(fileBuffer);
        break;
      case "pdf":
      case "scanned_pdf":
        extractionResult = await extractFromPDF(fileBuffer);
        break;
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }

    if (extractionResult.errors.length > 0 && extractionResult.transactions.length === 0) {
      await db
        .update(statements)
        .set({
          status: "failed",
          processingError: extractionResult.errors.join("; "),
        })
        .where(eq(statements.id, statementId));
      return;
    }

    // Update statement with period info
    await db
      .update(statements)
      .set({
        status: "extracted",
        periodStart: extractionResult.periodStart,
        periodEnd: extractionResult.periodEnd,
        openingBalance: extractionResult.openingBalance
          ? String(extractionResult.openingBalance)
          : undefined,
        closingBalance: extractionResult.closingBalance
          ? String(extractionResult.closingBalance)
          : undefined,
        transactionCount: extractionResult.transactions.length,
        extractionWarnings: extractionResult.warnings,
      })
      .where(eq(statements.id, statementId));

    // Classify and normalize transactions
    const rawTransactions = extractionResult.transactions;
    const normalizedTransactions: NormalizedTransaction[] = [];
    const transactionHashes = new Set<string>();

    // Fetch system categories for mapping
    const systemCats = await db
      .select()
      .from(categories)
      .where(eq(categories.isSystem, true));

    const categoryMap = new Map(
      systemCats.map((c) => [c.name.toLowerCase(), c.id])
    );

    const insertedTransactions = [];

    for (const raw of rawTransactions) {
      try {
        const date = parseDate(raw.date);
        if (!date) continue;

        const amount =
          raw.amount ||
          raw.debit ||
          raw.credit ||
          0;
        if (!amount || amount <= 0) continue;

        const type = raw.type || (raw.credit && raw.credit > 0 ? "credit" : "debit");
        const description = (raw.description || "").trim();

        if (!description) continue;

        // Deduplication hash
        const hashContent = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${description.toLowerCase().slice(0, 50)}|${type}`;
        const txHash = crypto.createHash("sha256").update(hashContent).digest("hex").slice(0, 32);

        const isDuplicate = transactionHashes.has(txHash);
        transactionHashes.add(txHash);

        // Classify
        const classification = classifier.classify(description);

        const categoryId = classification.category
          ? categoryMap.get(classification.category.toLowerCase())
          : undefined;

        // Build transaction record
        const txData = {
          userId,
          statementId,
          accountId: accountId || undefined,
          rawDescription: description,
          rawDate: raw.date?.toString(),
          rawAmount: String(amount),
          rawBalance: raw.balance ? String(raw.balance) : undefined,
          date,
          amount: String(amount),
          currency: extractionResult.currency || "NGN",
          type: type as "debit" | "credit" | "transfer",
          description,
          balance: raw.balance ? String(raw.balance) : undefined,
          reference: raw.reference || undefined,
          merchant: classification.merchant || undefined,
          subcategory: classification.subcategory || undefined,
          confidence: classification.confidence
            ? String(classification.confidence)
            : "0",
          classifiedBy: classification.classifiedBy,
          categoryId: categoryId || undefined,
          isRecurring: classification.isRecurring || false,
          isSubscription: classification.isSubscription || false,
          isBankCharge: classification.isBankCharge || false,
          isDuplicate,
          isUncertain: classification.confidence < 0.5,
          transactionHash: txHash,
        };

        const normalized: NormalizedTransaction = {
          date,
          amount,
          currency: extractionResult.currency || "NGN",
          type: type as "debit" | "credit" | "transfer",
          description,
          rawDescription: description,
          merchant: classification.merchant,
          entity: classification.entity,
          category: classification.category,
          subcategory: classification.subcategory,
          confidence: classification.confidence,
          isRecurring: classification.isRecurring || false,
          isSubscription: classification.isSubscription || false,
          isBankCharge: classification.isBankCharge || false,
          isDuplicate,
        };

        normalizedTransactions.push(normalized);
        insertedTransactions.push(txData);
      } catch (err) {
        console.error("Failed to process transaction:", err);
      }
    }

    // Batch insert transactions
    if (insertedTransactions.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < insertedTransactions.length; i += BATCH_SIZE) {
        const batch = insertedTransactions.slice(i, i + BATCH_SIZE);
        await db.insert(transactions).values(batch);
      }
    }

    // Detect recurring subscriptions
    const debitTransactions = normalizedTransactions.filter(
      (t) => t.type === "debit"
    );
    const detectedSubs = recurringDetector.detect(debitTransactions);

    for (const sub of detectedSubs) {
      const existingSub = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, userId),
            eq(subscriptions.name, sub.name)
          )
        )
        .limit(1);

      if (existingSub.length === 0) {
        await db.insert(subscriptions).values({
          userId,
          name: sub.name,
          merchant: sub.merchant,
          amount: String(sub.amount),
          currency: sub.currency || "NGN",
          frequency: sub.frequency,
          subcategory: sub.subcategory,
          isAutoDetected: true,
          firstSeenAt: sub.firstSeen,
          lastSeenAt: sub.lastSeen,
          nextExpectedAt: sub.nextExpected || undefined,
          confidence: String(sub.confidence),
          occurrenceCount: sub.occurrences.length,
        });
      }
    }

    // Track unknown account number transfers
    const accountTransfers = insertedTransactions.filter(
      (t) =>
        t.type === "debit" &&
        /\b\d{10}\b/.test(t.description) &&
        !t.merchant
    );

    for (const tx of accountTransfers) {
      const match = tx.description.match(/\b(\d{10})\b/);
      if (match) {
        const accountNumber = match[1];
        const txAmount = parseFloat(String(tx.amount));

        const existing = await db
          .select()
          .from(unknownAccounts)
          .where(
            and(
              eq(unknownAccounts.userId, userId),
              eq(unknownAccounts.accountNumber, accountNumber)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          await db.insert(unknownAccounts).values({
            userId,
            accountNumber,
            totalSent: String(txAmount),
            transactionCount: 1,
          });
        } else {
          const e = existing[0];
          await db
            .update(unknownAccounts)
            .set({
              totalSent: String(parseFloat(String(e.totalSent)) + txAmount),
              transactionCount: (e.transactionCount || 0) + 1,
            })
            .where(eq(unknownAccounts.id, e.id));
        }
      }
    }

    // Balance validation
    let balanceValidated: boolean | undefined;
    let validationNotes: string | undefined;

    if (
      extractionResult.openingBalance !== undefined &&
      extractionResult.closingBalance !== undefined
    ) {
      const totalCredits = normalizedTransactions
        .filter((t) => t.type === "credit" && !t.isDuplicate)
        .reduce((s, t) => s + t.amount, 0);
      const totalDebits = normalizedTransactions
        .filter((t) => t.type === "debit" && !t.isDuplicate)
        .reduce((s, t) => s + t.amount, 0);

      const calculatedClose =
        extractionResult.openingBalance + totalCredits - totalDebits;
      const diff = Math.abs(
        calculatedClose - extractionResult.closingBalance
      );

      balanceValidated = diff < 1; // Allow 1 naira rounding difference
      validationNotes = balanceValidated
        ? "Statement balance validated successfully"
        : `Balance discrepancy of ₦${diff.toFixed(2)} detected`;
    }

    // Mark complete
    await db
      .update(statements)
      .set({
        status: "completed",
        extractedCount: insertedTransactions.length,
        balanceValidated,
        validationNotes,
        processingCompletedAt: new Date(),
      })
      .where(eq(statements.id, statementId));

    console.log(
      `Statement ${statementId} processed: ${insertedTransactions.length} transactions`
    );
  } catch (err) {
    console.error(`Statement ${statementId} processing failed:`, err);
    await db
      .update(statements)
      .set({
        status: "failed",
        processingError:
          err instanceof Error ? err.message : "Unknown error occurred",
      })
      .where(eq(statements.id, statementId));
  }
}
