import pdfParse from "pdf-parse";
import type { ExtractionResult, RawTransaction } from "../../types";
import { parseAmount, parseDate } from "../utils/parseHelpers";

// ─── PDF Text Table Parser ────────────────────────────────────────────────────

export async function extractFromPDF(buffer: Buffer): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const transactions: RawTransaction[] = [];

  let text = "";

  try {
    const data = await pdfParse(buffer, {
      max: 0, // parse all pages
    });
    text = data.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`PDF extraction failed: ${message}`);
    return { transactions, warnings, errors };
  }

  if (!text || text.trim().length < 50) {
    errors.push("PDF appears to be scanned or empty. OCR support coming soon.");
    return { transactions, warnings, errors };
  }

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Try to detect statement structure
  const structureResult = detectStatementStructure(lines, warnings);

  if (structureResult.transactions.length === 0) {
    warnings.push("Could not parse transactions using standard format. Attempting line-by-line parsing.");
    const fallback = parseLineByLine(lines, warnings);
    transactions.push(...fallback);
  } else {
    transactions.push(...structureResult.transactions);
  }

  return {
    transactions,
    openingBalance: structureResult.openingBalance,
    closingBalance: structureResult.closingBalance,
    periodStart: structureResult.periodStart,
    periodEnd: structureResult.periodEnd,
    bankName: structureResult.bankName,
    warnings,
    errors,
  };
}

interface StructureResult {
  transactions: RawTransaction[];
  openingBalance?: number;
  closingBalance?: number;
  periodStart?: Date;
  periodEnd?: Date;
  bankName?: string;
}

function detectStatementStructure(lines: string[], warnings: string[]): StructureResult {
  const transactions: RawTransaction[] = [];
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;
  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;
  let bankName: string | undefined;

  // Detect known Nigerian bank headers
  const BANK_PATTERNS: [RegExp, string][] = [
    [/GUARANTY\s*TRUST|GTBank|GTB\b/i, "GTBank"],
    [/ZENITH\s*BANK/i, "Zenith Bank"],
    [/ACCESS\s*BANK/i, "Access Bank"],
    [/UNITED\s*BANK.*AFRICA|UBA\b/i, "UBA"],
    [/FIRST\s*BANK/i, "First Bank"],
    [/STANBIC\s*IBTC/i, "Stanbic IBTC"],
    [/FIDELITY\s*BANK/i, "Fidelity Bank"],
    [/POLARIS\s*BANK/i, "Polaris Bank"],
    [/STERLING\s*BANK/i, "Sterling Bank"],
    [/ECOBANK/i, "Ecobank"],
    [/UNION\s*BANK/i, "Union Bank"],
    [/WEMA\s*BANK/i, "Wema Bank"],
    [/KUDA\s*BANK/i, "Kuda Bank"],
    [/OPAY/i, "OPay"],
    [/PALMPAY/i, "PalmPay"],
  ];

  for (const line of lines.slice(0, 20)) {
    for (const [pattern, name] of BANK_PATTERNS) {
      if (pattern.test(line)) {
        bankName = name;
        break;
      }
    }
    if (bankName) break;
  }

  // Look for opening/closing balance
  for (const line of lines) {
    const openMatch = line.match(/opening\s*balance[:\s]+([₦\d,\.]+)/i);
    if (openMatch) openingBalance = parseAmount(openMatch[1]) ?? undefined;

    const closeMatch = line.match(/closing\s*balance[:\s]+([₦\d,\.]+)/i);
    if (closeMatch) closingBalance = parseAmount(closeMatch[1]) ?? undefined;

    const periodMatch = line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+to\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (periodMatch) {
      periodStart = parseDate(periodMatch[1]) ?? undefined;
      periodEnd = parseDate(periodMatch[2]) ?? undefined;
    }
  }

  // Try to find and parse transaction table
  // Pattern: DATE | DESCRIPTION | DEBIT | CREDIT | BALANCE (or variations)
  const transactionLines = extractTransactionLines(lines, warnings);
  transactions.push(...transactionLines);

  return { transactions, openingBalance, closingBalance, periodStart, periodEnd, bankName };
}

function extractTransactionLines(lines: string[], warnings: string[]): RawTransaction[] {
  const transactions: RawTransaction[] = [];

  // Nigerian bank statement date patterns
  const DATE_REGEX = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{2}[A-Za-z]{3}\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
  const AMOUNT_REGEX = /[₦]?\s*[\d,]+\.\d{2}/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if line starts with a date
    const dateMatch = line.match(DATE_REGEX);
    if (!dateMatch) continue;

    const date = parseDate(dateMatch[1]);
    if (!date || date.getFullYear() < 2000) continue;

    // Extract all amounts from this line
    const amounts: number[] = [];
    let match: RegExpExecArray | null;
    const amountRegex = /[₦]?\s*([\d,]+\.\d{2})/g;
    while ((match = amountRegex.exec(line)) !== null) {
      const amt = parseAmount(match[1]);
      if (amt !== undefined && amt > 0) amounts.push(amt);
    }

    if (amounts.length === 0) continue;

    // Get description - the non-numeric, non-date part
    const description = line
      .replace(DATE_REGEX, "")
      .replace(/[₦]?\s*[\d,]+\.\d{2}/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (description.length < 2) continue;

    // Determine debit/credit based on position (last amount is usually balance)
    let debit: number | undefined;
    let credit: number | undefined;
    let balance: number | undefined;

    if (amounts.length === 1) {
      // Could be either, default to debit
      debit = amounts[0];
    } else if (amounts.length === 2) {
      // First is transaction amount, second is balance
      debit = amounts[0];
      balance = amounts[1];
    } else if (amounts.length >= 3) {
      // Debit, credit, balance pattern
      if (amounts[0] > 0 && amounts[1] === 0) {
        debit = amounts[0];
      } else if (amounts[0] === 0 && amounts[1] > 0) {
        credit = amounts[1];
      } else {
        debit = amounts[0];
        credit = amounts[1];
      }
      balance = amounts[amounts.length - 1];
    }

    const type: "debit" | "credit" | "transfer" =
      credit !== undefined && (debit === undefined || debit === 0) ? "credit" : "debit";

    transactions.push({
      date: dateMatch[1],
      description,
      debit: type === "debit" ? (debit || amounts[0]) : undefined,
      credit: type === "credit" ? credit : undefined,
      amount: debit || credit || amounts[0],
      balance,
      type,
    });
  }

  return transactions;
}

function parseLineByLine(lines: string[], warnings: string[]): RawTransaction[] {
  const transactions: RawTransaction[] = [];
  warnings.push("Using fallback line-by-line parser");

  for (const line of lines) {
    // Very basic: look for a date anywhere in the line
    const dateMatch = line.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
    const amountMatch = line.match(/[₦]?\s*([\d,]+\.\d{2})/);

    if (!dateMatch || !amountMatch) continue;

    const date = parseDate(dateMatch[1]);
    const amount = parseAmount(amountMatch[1]);

    if (!date || amount === undefined || amount <= 0) continue;

    const description = line
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/, "")
      .replace(/[₦]?\s*[\d,]+\.\d{2}/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!description) continue;

    transactions.push({
      date: dateMatch[1],
      description,
      amount,
      type: "debit",
    });
  }

  return transactions;
}
