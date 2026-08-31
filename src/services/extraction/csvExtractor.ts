import Papa from "papaparse";
import type { ExtractionResult, RawTransaction } from "../../types";
import { parseAmount, parseDate } from "../utils/parseHelpers";

// Common CSV column name patterns
const DATE_COLUMNS = ["date", "transaction date", "trans date", "value date", "posting date", "trans_date", "txn_date"];
const DESCRIPTION_COLUMNS = ["description", "narration", "details", "transaction description", "particulars", "remarks", "memo", "narrative"];
const DEBIT_COLUMNS = ["debit", "withdrawals", "withdrawal", "dr", "debit amount", "money out", "amount_dr"];
const CREDIT_COLUMNS = ["credit", "deposits", "deposit", "cr", "credit amount", "money in", "amount_cr"];
const AMOUNT_COLUMNS = ["amount", "transaction amount", "value", "amt"];
const BALANCE_COLUMNS = ["balance", "running balance", "available balance", "ledger balance", "bal"];
const REFERENCE_COLUMNS = ["reference", "ref", "transaction ref", "trans ref", "reference number"];

function matchColumn(headers: string[], patterns: string[]): number {
  const headersLower = headers.map((h) => h.toLowerCase().trim());
  for (const pattern of patterns) {
    const idx = headersLower.indexOf(pattern.toLowerCase());
    if (idx !== -1) return idx;
  }
  // Partial match
  for (const pattern of patterns) {
    const idx = headersLower.findIndex((h) => h.includes(pattern.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

export async function extractFromCSV(content: string): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const transactions: RawTransaction[] = [];

  const parsed = Papa.parse<string[]>(content, {
    skipEmptyLines: true,
    trim: true,
  });

  if (parsed.errors.length > 0) {
    errors.push(`CSV parsing issues: ${parsed.errors[0].message}`);
  }

  if (!parsed.data || parsed.data.length < 2) {
    errors.push("CSV has insufficient data rows");
    return { transactions, warnings, errors };
  }

  const headers = parsed.data[0] as string[];
  const rows = parsed.data.slice(1) as string[][];

  // Map column indices
  const dateIdx = matchColumn(headers, DATE_COLUMNS);
  const descIdx = matchColumn(headers, DESCRIPTION_COLUMNS);
  const debitIdx = matchColumn(headers, DEBIT_COLUMNS);
  const creditIdx = matchColumn(headers, CREDIT_COLUMNS);
  const amountIdx = matchColumn(headers, AMOUNT_COLUMNS);
  const balanceIdx = matchColumn(headers, BALANCE_COLUMNS);
  const refIdx = matchColumn(headers, REFERENCE_COLUMNS);

  if (dateIdx === -1) warnings.push("Could not detect date column - using first column");
  if (descIdx === -1) warnings.push("Could not detect description column");

  const effectiveDateIdx = dateIdx !== -1 ? dateIdx : 0;
  const effectiveDescIdx = descIdx !== -1 ? descIdx : 1;

  let openingBalance: number | undefined;
  let closingBalance: number | undefined;
  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !c || !c.trim())) continue;

    const rawDate = row[effectiveDateIdx]?.trim() || "";
    const rawDesc = row[effectiveDescIdx]?.trim() || "";

    if (!rawDate && !rawDesc) continue;

    // Parse date
    const date = parseDate(rawDate);
    if (!date) {
      warnings.push(`Row ${i + 2}: Could not parse date "${rawDate}"`);
      continue;
    }

    // Parse amounts
    let debit: number | undefined;
    let credit: number | undefined;
    let amount: number | undefined;

    if (debitIdx !== -1 && row[debitIdx]) {
      debit = parseAmount(row[debitIdx]);
    }
    if (creditIdx !== -1 && row[creditIdx]) {
      credit = parseAmount(row[creditIdx]);
    }
    if (amountIdx !== -1 && row[amountIdx]) {
      amount = parseAmount(row[amountIdx]);
    }

    // Determine final amount and type
    let finalAmount: number;
    let type: "debit" | "credit" | "transfer" = "debit";

    if (debit !== undefined && debit > 0) {
      finalAmount = debit;
      type = "debit";
    } else if (credit !== undefined && credit > 0) {
      finalAmount = credit;
      type = "credit";
    } else if (amount !== undefined) {
      finalAmount = Math.abs(amount);
      type = amount < 0 ? "debit" : "credit";
    } else {
      warnings.push(`Row ${i + 2}: Could not parse amount`);
      continue;
    }

    const balance =
      balanceIdx !== -1 ? parseAmount(row[balanceIdx] || "") : undefined;
    const reference = refIdx !== -1 ? row[refIdx]?.trim() : undefined;

    // Track period
    if (!periodStart || date < periodStart) periodStart = date;
    if (!periodEnd || date > periodEnd) periodEnd = date;

    transactions.push({
      date: rawDate,
      description: rawDesc,
      debit: type === "debit" ? finalAmount : undefined,
      credit: type === "credit" ? finalAmount : undefined,
      amount: finalAmount,
      balance,
      reference,
      type,
    });
  }

  // Try to find opening/closing balance from last/first transaction
  if (balanceIdx !== -1 && transactions.length > 0) {
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    if (firstRow[balanceIdx]) {
      const b = parseAmount(firstRow[balanceIdx]);
      if (b !== undefined) openingBalance = b;
    }
    if (lastRow[balanceIdx]) {
      const b = parseAmount(lastRow[balanceIdx]);
      if (b !== undefined) closingBalance = b;
    }
  }

  return {
    transactions,
    openingBalance,
    closingBalance,
    periodStart,
    periodEnd,
    warnings,
    errors,
  };
}
