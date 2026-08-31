// ─── Amount Parsing ────────────────────────────────────────────────────────────

export function parseAmount(raw: string | undefined | null): number | undefined {
  if (!raw || raw.trim() === "" || raw.trim() === "-" || raw.trim() === "N/A") {
    return undefined;
  }

  // Remove currency symbols, spaces, and commas
  const cleaned = raw
    .replace(/[₦$€£¥]/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  if (!cleaned || cleaned === "" || cleaned === "." || cleaned === "-") {
    return undefined;
  }

  // Handle negative in parentheses: (1,234.56) -> -1234.56
  const parenthesized = cleaned.match(/^\((.+)\)$/);
  if (parenthesized) {
    const n = parseFloat(parenthesized[1]);
    return isNaN(n) ? undefined : -n;
  }

  const n = parseFloat(cleaned);
  return isNaN(n) ? undefined : n;
}

// ─── Date Parsing ──────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export function parseDate(raw: string | undefined | null): Date | null {
  if (!raw || raw.trim() === "") return null;

  const s = raw.trim();

  // Try native Date parsing first
  const native = new Date(s);
  if (!isNaN(native.getTime()) && native.getFullYear() > 1990) {
    return native;
  }

  // DD/MM/YYYY or DD-MM-YYYY (Nigerian format)
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmy) {
    let [, day, month, year] = dmy;
    const y = parseInt(year) < 100 ? 2000 + parseInt(year) : parseInt(year);
    const d = new Date(y, parseInt(month) - 1, parseInt(day));
    if (!isNaN(d.getTime())) return d;
  }

  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const [, month, day, year] = mdy;
    const y = parseInt(year) < 100 ? 2000 + parseInt(year) : parseInt(year);
    const d = new Date(y, parseInt(month) - 1, parseInt(day));
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990) return d;
  }

  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // "01 Jan 2024" or "Jan 01, 2024"
  const textDate = s.match(
    /^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$|^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})$/
  );
  if (textDate) {
    if (textDate[1]) {
      const month = MONTH_MAP[textDate[2].toLowerCase()];
      if (month !== undefined) {
        const d = new Date(parseInt(textDate[3]), month, parseInt(textDate[1]));
        if (!isNaN(d.getTime())) return d;
      }
    } else if (textDate[4]) {
      const month = MONTH_MAP[textDate[4].toLowerCase()];
      if (month !== undefined) {
        const d = new Date(parseInt(textDate[6]), month, parseInt(textDate[5]));
        if (!isNaN(d.getTime())) return d;
      }
    }
  }

  // "01-Jan-24" or "01Jan2024"
  const compactDate = s.match(/^(\d{1,2})[\-\/]?([a-zA-Z]{3,})[\-\/]?(\d{2,4})$/i);
  if (compactDate) {
    const month = MONTH_MAP[compactDate[2].toLowerCase()];
    if (month !== undefined) {
      const y =
        parseInt(compactDate[3]) < 100
          ? 2000 + parseInt(compactDate[3])
          : parseInt(compactDate[3]);
      const d = new Date(y, month, parseInt(compactDate[1]));
      if (!isNaN(d.getTime())) return d;
    }
  }

  return null;
}

// ─── Hash ──────────────────────────────────────────────────────────────────────

export function createTransactionHash(
  date: Date,
  amount: number,
  description: string,
  type: string
): string {
  const crypto = require("crypto");
  const content = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${description.toLowerCase().trim()}|${type}`;
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
}
