import * as XLSX from "xlsx";
import type { ExtractionResult } from "../../types";
import { extractFromCSV } from "./csvExtractor";

export async function extractFromXLSX(buffer: Buffer): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      errors.push("No sheets found in Excel file");
      return { transactions: [], warnings, errors };
    }

    // Try to find a sheet with transaction data
    let targetSheet = workbook.SheetNames[0];
    for (const name of workbook.SheetNames) {
      const lower = name.toLowerCase();
      if (
        lower.includes("transaction") ||
        lower.includes("statement") ||
        lower.includes("history") ||
        lower.includes("data")
      ) {
        targetSheet = name;
        break;
      }
    }

    if (workbook.SheetNames.length > 1) {
      warnings.push(`Multiple sheets found. Using "${targetSheet}"`);
    }

    const sheet = workbook.Sheets[targetSheet];

    // Convert to CSV and reuse the CSV extractor
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });

    const result = await extractFromCSV(csv);
    result.warnings.unshift(...warnings);
    result.errors.unshift(...errors);

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to read Excel file: ${message}`);
    return { transactions: [], warnings, errors };
  }
}
