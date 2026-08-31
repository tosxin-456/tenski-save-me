from __future__ import annotations

import io
import re
import logging
from dataclasses import dataclass, field
from datetime import datetime, date
from pathlib import Path

import pandas as pd

from app.services.extraction.pdf_extractor import ExtractionResult, ExtractedTransaction

logger = logging.getLogger(__name__)

DATE_COLS = [
    "date", "value date", "trans date", "transaction date", "posting date",
    "value_date", "txn date", "trans. date", "post date",
]
DESC_COLS = [
    "description", "narration", "details", "particulars", "reference",
    "remarks", "memo", "beneficiary", "recipient", "sender",
]
DEBIT_COLS = [
    "debit", "withdrawal", "debit amount", "dr", "amount out", "money out",
    "outflow", "withdrawals",
]
CREDIT_COLS = [
    "credit", "deposit", "credit amount", "cr", "amount in", "money in",
    "inflow", "deposits", "lodgement",
]
AMOUNT_COLS = ["amount", "transaction amount", "txn amount"]
BALANCE_COLS = [
    "balance", "available balance", "running balance", "ledger balance",
    "book balance", "closing balance",
]
TYPE_COLS = [
    "type", "transaction type", "txn type", "trans type", "tran type",
    "entry type",
]

CURRENCY_RE = re.compile(r"[₦NGN$€£,\s]")
DATE_RE = re.compile(r"\d{2}[/\-]\d{2}[/\-]\d{2,4}")
AMOUNT_PATTERN = re.compile(r"^[₦NGN$€£\s]*[\d,]+\.\d{2}\s*$")

INWARD_KEYWORDS = {"inward", "credit", "cr", "deposit", "received", "inflow", "lodgement"}
OUTWARD_KEYWORDS = {"outward", "debit", "dr", "withdrawal", "payment", "outflow", "purchase"}


class CsvExtractor:
    def extract(self, file_path: str | Path) -> ExtractionResult:
        result = ExtractionResult()
        try:
            content = Path(file_path).read_bytes()
            df = self._read_flexible(content)
            if df is not None and len(df) > 0:
                result = self._process_df(df)
            if not result.transactions:
                result = self._process_raw_text(content)
        except Exception as e:
            logger.error(f"CSV extraction error: {e}")
            result.warnings.append(f"Extraction error: {str(e)}")
        return result

    def extract_from_bytes(self, content: bytes) -> ExtractionResult:
        try:
            df = self._read_flexible(content)
            if df is not None and len(df) > 0:
                result = self._process_df(df)
                if result.transactions:
                    return result
            return self._process_raw_text(content)
        except Exception as e:
            result = ExtractionResult()
            result.warnings.append(str(e))
            return result

    def _read_flexible(self, content: bytes) -> pd.DataFrame | None:
        text = content.decode("utf-8", errors="replace")
        sep = self._detect_separator(text)
        for encoding in ("utf-8", "latin-1", "cp1252"):
            try:
                df = pd.read_csv(
                    io.BytesIO(content), sep=sep,
                    on_bad_lines="skip", encoding=encoding,
                    encoding_errors="replace",
                    dtype=str, keep_default_na=False,
                )
                if len(df.columns) < 3 or len(df) == 0:
                    continue

                if self._is_headerless(df):
                    df = pd.read_csv(
                        io.BytesIO(content), sep=sep,
                        on_bad_lines="skip", encoding=encoding,
                        encoding_errors="replace",
                        dtype=str, keep_default_na=False,
                        header=None,
                    )
                return df
            except Exception:
                continue
        return None

    def _is_headerless(self, df: pd.DataFrame) -> bool:
        first_col = str(df.columns[0])
        if self._parse_date(first_col.split()[0] if " " in first_col else first_col):
            return True
        if self._looks_like_amount(first_col):
            return True
        date_like_headers = sum(
            1 for c in df.columns
            if self._parse_date(str(c).split()[0] if " " in str(c) else str(c))
        )
        if date_like_headers > 0:
            return True
        return False

    def _detect_separator(self, text: str) -> str:
        sample = text[:5000]
        tab_count = sample.count("\t")
        comma_count = sample.count(",")
        semi_count = sample.count(";")
        pipe_count = sample.count("|")

        counts = {"\t": tab_count, ",": comma_count, ";": semi_count, "|": pipe_count}
        lines = sample.split("\n")[:10]
        best_sep = ","
        best_consistency = -1

        for sep, total in counts.items():
            if total < 2:
                continue
            per_line = [line.count(sep) for line in lines if line.strip()]
            if not per_line:
                continue
            if max(per_line) - min(per_line) <= 2:
                consistency = min(per_line) * 10 + total
                if consistency > best_consistency:
                    best_consistency = consistency
                    best_sep = sep

        return best_sep

    def _process_df(self, df: pd.DataFrame) -> ExtractionResult:
        result = ExtractionResult()

        df.columns = [str(c).strip() for c in df.columns]
        cols_lower = {c.lower().strip(): c for c in df.columns}

        date_col = self._find_col(cols_lower, DATE_COLS)
        desc_col = self._find_col(cols_lower, DESC_COLS)
        debit_col = self._find_col(cols_lower, DEBIT_COLS)
        credit_col = self._find_col(cols_lower, CREDIT_COLS)
        amount_col = self._find_col(cols_lower, AMOUNT_COLS)
        balance_col = self._find_col(cols_lower, BALANCE_COLS)
        type_col = self._find_col(cols_lower, TYPE_COLS)

        if not date_col or not desc_col:
            inferred = self._infer_columns(df)
            if inferred:
                date_col = inferred.get("date", date_col)
                desc_col = inferred.get("description", desc_col)
                debit_col = inferred.get("debit", debit_col)
                credit_col = inferred.get("credit", credit_col)
                balance_col = inferred.get("balance", balance_col)
                type_col = inferred.get("type", type_col)

        if not date_col:
            result.warnings.append("Could not identify date column")
            return result

        for _, row in df.iterrows():
            try:
                raw_date = str(row.get(date_col, "")).strip()
                parsed_date = self._parse_date(raw_date)
                if not parsed_date:
                    continue

                desc = str(row.get(desc_col, "")).strip() if desc_col else ""

                debit = self._parse_amount(str(row.get(debit_col, ""))) if debit_col else 0.0
                credit = self._parse_amount(str(row.get(credit_col, ""))) if credit_col else 0.0

                if amount_col and debit == 0 and credit == 0:
                    amt = self._parse_amount(str(row.get(amount_col, "")))
                    if amt != 0:
                        debit = abs(amt) if amt > 0 else 0
                        credit = abs(amt) if amt < 0 else 0

                if debit == 0 and credit == 0:
                    continue

                tx_type = "credit" if credit > debit else "debit"

                if type_col:
                    type_val = str(row.get(type_col, "")).lower()
                    if any(k in type_val for k in INWARD_KEYWORDS):
                        tx_type = "credit"
                    elif any(k in type_val for k in OUTWARD_KEYWORDS):
                        tx_type = "debit"

                amount = credit if tx_type == "credit" else debit

                if not desc:
                    parts = []
                    for col in df.columns:
                        if col in (date_col, debit_col, credit_col, amount_col, balance_col, type_col):
                            continue
                        val = str(row.get(col, "")).strip()
                        if val and not self._looks_like_amount(val) and not self._parse_date(val):
                            parts.append(val)
                    desc = " | ".join(parts) if parts else "Unknown transaction"

                balance = None
                if balance_col:
                    balance = self._parse_amount(str(row.get(balance_col, ""))) or None

                if amount <= 0:
                    continue

                result.transactions.append(ExtractedTransaction(
                    date=parsed_date, description=desc[:300],
                    amount=amount, type=tx_type,
                    balance=balance, raw_date=raw_date,
                    raw_amount=str(amount), raw_balance=str(balance or ""),
                ))
            except Exception:
                continue

        return result

    def _infer_columns(self, df: pd.DataFrame) -> dict[str, str] | None:
        mapping: dict[str, str] = {}
        amount_cols_found: list[tuple[str, float, int]] = []
        text_cols: list[tuple[str, float]] = []

        for col in df.columns:
            sample = df[col].astype(str).head(20)
            non_empty_vals = [v.strip() for v in sample if v.strip()]

            if len(non_empty_vals) == 0:
                continue

            date_hits = sum(
                1 for v in non_empty_vals
                if self._parse_date(v.split()[0] if " " in v else v) is not None
            )
            if date_hits >= len(non_empty_vals) * 0.5 and "date" not in mapping:
                mapping["date"] = col
                continue

            amt_hits = sum(1 for v in non_empty_vals if self._looks_like_amount(v))
            if amt_hits >= 1:
                fill_ratio = len(non_empty_vals) / max(len(sample), 1)
                col_idx = list(df.columns).index(col)
                amount_cols_found.append((col, fill_ratio, col_idx))
                continue

            type_hits = sum(
                1 for v in non_empty_vals
                if any(k in v.lower() for k in INWARD_KEYWORDS | OUTWARD_KEYWORDS)
                or v.lower() in ("bills", "airtime", "data", "pos", "atm", "web")
            )
            if type_hits >= len(non_empty_vals) * 0.4 and "type" not in mapping:
                mapping["type"] = col
                continue

            avg_len = sum(len(v) for v in non_empty_vals) / len(non_empty_vals) if non_empty_vals else 0
            if avg_len > 8:
                text_cols.append((col, avg_len))

        if text_cols:
            text_cols.sort(key=lambda x: x[1], reverse=True)
            mapping["description"] = text_cols[0][0]

        if len(amount_cols_found) >= 3:
            amount_cols_found.sort(key=lambda x: x[2])
            mapping["credit"] = amount_cols_found[0][0]
            mapping["debit"] = amount_cols_found[1][0]
            mapping["balance"] = amount_cols_found[-1][0]
        elif len(amount_cols_found) == 2:
            amount_cols_found.sort(key=lambda x: x[1])
            if amount_cols_found[0][1] < 0.8 and amount_cols_found[1][1] < 0.8:
                amount_cols_found.sort(key=lambda x: x[2])
                mapping["credit"] = amount_cols_found[0][0]
                mapping["debit"] = amount_cols_found[1][0]
            else:
                mapping["debit"] = amount_cols_found[0][0]
                mapping["balance"] = amount_cols_found[1][0]
        elif len(amount_cols_found) == 1:
            mapping["debit"] = amount_cols_found[0][0]

        return mapping if "date" in mapping else None

    def _process_raw_text(self, content: bytes) -> ExtractionResult:
        result = ExtractionResult()
        text = content.decode("utf-8", errors="replace")
        lines = text.split("\n")

        for line in lines:
            line = line.strip()
            if not line or len(line) < 15:
                continue

            date_match = DATE_RE.search(line)
            if not date_match:
                continue

            raw_date = date_match.group()
            parsed_date = self._parse_date(raw_date)
            if not parsed_date:
                continue

            amounts = re.findall(r"₦?[\d,]+\.\d{2}", line)
            amount_vals = [self._parse_amount(a) for a in amounts]
            amount_vals = [v for v in amount_vals if v > 0]

            if not amount_vals:
                continue

            lower = line.lower()
            if any(k in lower for k in ["inward", "credit", "cr ", "deposit", "received"]):
                tx_type = "credit"
            elif any(k in lower for k in ["outward", "debit", "dr ", "withdrawal", "purchase", "bills", "payment"]):
                tx_type = "debit"
            else:
                tx_type = "debit"

            balance = amount_vals[-1] if len(amount_vals) >= 2 else None
            amount = amount_vals[0] if len(amount_vals) >= 2 else amount_vals[0]

            desc = line
            desc = DATE_RE.sub("", desc)
            desc = re.sub(r"₦?[\d,]+\.\d{2}", "", desc)
            desc = re.sub(r"\s+", " ", desc).strip(" \t|/,-")
            if not desc:
                desc = "Unknown transaction"

            result.transactions.append(ExtractedTransaction(
                date=parsed_date, description=desc[:300],
                amount=amount, type=tx_type,
                balance=balance, raw_date=raw_date,
                raw_amount=str(amount), raw_balance=str(balance or ""),
            ))

        return result

    def _find_col(self, cols_lower: dict[str, str], candidates: list[str]) -> str | None:
        for c in candidates:
            if c in cols_lower:
                return cols_lower[c]
        for c in candidates:
            for key, orig in cols_lower.items():
                if c in key:
                    return orig
        return None

    def _looks_like_amount(self, val: str) -> bool:
        cleaned = val.strip()
        if not cleaned:
            return False
        return bool(AMOUNT_PATTERN.match(cleaned))

    def _parse_date(self, raw: str) -> date | None:
        formats = [
            "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d",
            "%m/%d/%Y", "%d %b %Y", "%d %B %Y",
            "%d/%m/%y", "%m/%d/%y",
            "%d/%m/%y %H:%M:%S", "%d/%m/%Y %H:%M:%S",
            "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S",
            "%d-%m-%Y %H:%M:%S", "%d/%m/%y %H:%M",
            "%d/%m/%Y %H:%M", "%Y-%m-%dT%H:%M:%S",
            "%d-%b-%Y", "%d-%b-%y",
        ]
        raw = raw.strip()
        for fmt in formats:
            try:
                return datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
        return None

    def _parse_amount(self, raw: str) -> float:
        clean = CURRENCY_RE.sub("", raw.replace(",", ""))
        clean = re.sub(r"[^\d.\-]", "", clean)
        try:
            return abs(float(clean))
        except ValueError:
            return 0.0


csv_extractor = CsvExtractor()
