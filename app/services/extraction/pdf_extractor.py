"""
PDF statement extractor using pdfplumber.
Detects Nigerian bank format and extracts transactions.
"""
from __future__ import annotations

import re
import logging
from dataclasses import dataclass, field
from datetime import datetime, date
from pathlib import Path

import pdfplumber

logger = logging.getLogger(__name__)

NIGERIAN_BANKS = [
    "access bank", "zenith bank", "gtbank", "guaranty trust", "first bank",
    "uba", "united bank for africa", "fidelity bank", "sterling bank",
    "ecobank", "union bank", "stanbic ibtc", "keystone bank", "heritage bank",
    "wema bank", "providus bank", "titan trust", "polaris bank",
    "opay", "kuda", "moniepoint", "palmpay", "vfd microfinance",
]

DATE_PATTERNS = [
    re.compile(r"\b(\d{2}[/\-]\d{2}[/\-]\d{4})\b"),
    re.compile(r"\b(\d{2}[/\-]\d{2}[/\-]\d{2})(?:\s+\d{2}:\d{2}(?::\d{2})?)?\b"),
    re.compile(r"\b(\d{4}[/\-]\d{2}[/\-]\d{2})\b"),
    re.compile(r"\b(\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b", re.I),
    re.compile(r"\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b", re.I),
]
AMOUNT_RE = re.compile(r"[\d,]+\.\d{2}")
BALANCE_KEYWORDS = re.compile(r"(opening|closing|balance|brought forward|b/f|c/f)", re.I)


@dataclass
class ExtractedTransaction:
    date: date
    description: str
    amount: float
    type: str   # debit | credit
    balance: float | None = None
    raw_date: str = ""
    raw_amount: str = ""
    raw_balance: str = ""


@dataclass
class ExtractionResult:
    transactions: list[ExtractedTransaction] = field(default_factory=list)
    bank_name: str | None = None
    account_number: str | None = None
    period_from: date | None = None
    period_to: date | None = None
    opening_balance: float | None = None
    closing_balance: float | None = None
    warnings: list[str] = field(default_factory=list)


class PdfExtractor:
    def extract(self, file_path: str | Path) -> ExtractionResult:
        result = ExtractionResult()
        try:
            with pdfplumber.open(str(file_path)) as pdf:
                full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)

            result.bank_name = self._detect_bank(full_text)
            result.opening_balance, result.closing_balance = self._extract_balances(full_text)
            result.period_from, result.period_to = self._extract_period(full_text)

            # Try table extraction first (structured PDFs)
            with pdfplumber.open(str(file_path)) as pdf:
                all_rows: list[list[str | None]] = []
                for page in pdf.pages:
                    tables = page.extract_tables()
                    for table in tables:
                        all_rows.extend(table)

            if all_rows:
                txs = self._parse_table_rows(all_rows)
                if txs:
                    result.transactions = txs
                    return result

            # Fallback: line-by-line text parsing
            result.transactions = self._parse_text_lines(full_text)
            if not result.transactions:
                result.warnings.append("Could not extract transactions from this PDF format")

        except Exception as e:
            logger.error(f"PDF extraction error: {e}")
            result.warnings.append(f"Extraction error: {str(e)}")

        return result

    def _detect_bank(self, text: str) -> str | None:
        lower = text[:500].lower()
        for bank in NIGERIAN_BANKS:
            if bank in lower:
                return bank.title()
        return None

    def _extract_balances(self, text: str) -> tuple[float | None, float | None]:
        opening = None
        closing = None
        lines = text.split("\n")
        for line in lines:
            lower = line.lower()
            amounts = AMOUNT_RE.findall(line)
            if not amounts:
                continue
            val = float(amounts[-1].replace(",", ""))
            if "opening" in lower or "brought forward" in lower or "b/f" in lower:
                opening = val
            elif "closing" in lower or "carried forward" in lower or "c/f" in lower:
                closing = val
        return opening, closing

    def _extract_period(self, text: str) -> tuple[date | None, date | None]:
        dates: list[date] = []
        for pattern in DATE_PATTERNS:
            for match in pattern.finditer(text[:800]):
                parsed = self._parse_date(match.group(1))
                if parsed:
                    dates.append(parsed)
        if len(dates) >= 2:
            return min(dates), max(dates)
        return None, None

    def _parse_table_rows(self, rows: list[list[str | None]]) -> list[ExtractedTransaction]:
        txs: list[ExtractedTransaction] = []
        date_col = amount_col = desc_col = debit_col = credit_col = balance_col = -1

        # Find header row
        for i, row in enumerate(rows[:5]):
            cells = [str(c or "").lower() for c in row]
            for j, cell in enumerate(cells):
                if any(k in cell for k in ["date", "value date", "trans date"]):
                    date_col = j
                if any(k in cell for k in ["description", "narration", "details", "particulars"]):
                    desc_col = j
                if any(k in cell for k in ["amount", "debit", "withdrawal"]) and "credit" not in cell:
                    if debit_col == -1:
                        debit_col = j
                if any(k in cell for k in ["credit", "deposit"]):
                    credit_col = j
                if any(k in cell for k in ["balance"]):
                    balance_col = j
            if date_col >= 0 and desc_col >= 0:
                rows = rows[i + 1:]
                break

        if date_col < 0 or desc_col < 0:
            return []

        for row in rows:
            if not row or all(c is None or str(c).strip() == "" for c in row):
                continue
            try:
                raw_date = str(row[date_col] or "").strip()
                parsed_date = self._parse_date(raw_date)
                if not parsed_date:
                    continue

                desc = str(row[desc_col] or "").strip()
                if not desc:
                    continue

                debit_val = credit_val = 0.0
                if debit_col >= 0 and debit_col < len(row):
                    debit_val = self._parse_amount(str(row[debit_col] or ""))
                if credit_col >= 0 and credit_col < len(row):
                    credit_val = self._parse_amount(str(row[credit_col] or ""))

                if amount_col >= 0 and amount_col < len(row) and debit_val == 0 and credit_val == 0:
                    amt = self._parse_amount(str(row[amount_col] or ""))
                    if amt > 0:
                        debit_val = amt

                if debit_val == 0 and credit_val == 0:
                    continue

                balance = None
                if balance_col >= 0 and balance_col < len(row):
                    balance = self._parse_amount(str(row[balance_col] or "")) or None

                tx_type = "credit" if credit_val > debit_val else "debit"
                amount = credit_val if tx_type == "credit" else debit_val

                txs.append(ExtractedTransaction(
                    date=parsed_date, description=desc,
                    amount=amount, type=tx_type,
                    balance=balance, raw_date=raw_date,
                    raw_amount=str(amount), raw_balance=str(balance or ""),
                ))
            except Exception:
                continue

        return txs

    def _parse_text_lines(self, text: str) -> list[ExtractedTransaction]:
        txs: list[ExtractedTransaction] = []
        lines = text.split("\n")

        for line in lines:
            line = line.strip()
            if not line or len(line) < 15:
                continue

            date_match = None
            raw_date = ""
            for pattern in DATE_PATTERNS:
                m = pattern.search(line)
                if m:
                    date_match = self._parse_date(m.group(1))
                    raw_date = m.group(1)
                    break

            if not date_match:
                continue

            amounts = AMOUNT_RE.findall(line)
            if not amounts:
                continue

            amount_vals = [float(a.replace(",", "")) for a in amounts]
            balance = amount_vals[-1] if len(amount_vals) >= 2 else None
            amount = amount_vals[-2] if len(amount_vals) >= 2 else amount_vals[0]

            # Remove date, amounts from description
            desc = line
            for pattern in DATE_PATTERNS:
                desc = pattern.sub("", desc)
            desc = AMOUNT_RE.sub("", desc).strip(" |-/,")

            if not desc or amount <= 0:
                continue

            lower = line.lower()
            tx_type = "credit" if any(k in lower for k in ["cr", "credit", "deposit", "received"]) else "debit"

            txs.append(ExtractedTransaction(
                date=date_match, description=desc[:200],
                amount=amount, type=tx_type,
                balance=balance, raw_date=raw_date,
                raw_amount=str(amount), raw_balance=str(balance or ""),
            ))

        return txs

    def _parse_date(self, raw: str) -> date | None:
        formats = [
            "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d",
            "%d/%m/%y", "%d-%m-%y",
            "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y",
            "%d%b%Y", "%d/%b/%Y", "%d-%b-%Y", "%d-%b-%y",
        ]
        raw = raw.strip()
        for fmt in formats:
            try:
                return datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
        return None

    def _parse_amount(self, raw: str) -> float:
        cleaned = re.sub(r"[^\d.]", "", raw.replace(",", ""))
        try:
            return float(cleaned)
        except ValueError:
            return 0.0


pdf_extractor = PdfExtractor()
