"""
Entity resolver: resolves raw transaction names to canonical entities.
Uses rapidfuzz for fuzzy matching + account number index.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from rapidfuzz import fuzz, process

ACCOUNT_RE = re.compile(r"\b\d{10}\b")


@dataclass
class ResolvedEntity:
    canonical_name: str
    entity_id: str | None
    confidence: float
    match_type: str  # exact | account | fuzzy | partial | new


class EntityResolver:
    def __init__(self) -> None:
        # In-memory indexes; populated from DB on startup
        self._alias_index: dict[str, tuple[str, str]] = {}   # alias_lower → (entity_id, canonical_name)
        self._account_index: dict[str, tuple[str, str]] = {}  # account_number → (entity_id, canonical_name)
        self._canonical_list: list[str] = []

    def load(
        self,
        aliases: list[tuple[str, str, str]],       # (alias, entity_id, canonical_name)
        account_numbers: list[tuple[str, str, str]], # (account_number, entity_id, canonical_name)
    ) -> None:
        self._alias_index = {a[0].lower(): (a[1], a[2]) for a in aliases}
        self._account_index = {a[0]: (a[1], a[2]) for a in account_numbers}
        self._canonical_list = list({a[2] for a in aliases})

    def resolve(self, raw_name: str, account_number: str | None = None) -> ResolvedEntity:
        raw_clean = raw_name.strip()
        lower = raw_clean.lower()

        # 1. Account number exact match
        if account_number and account_number in self._account_index:
            eid, canonical = self._account_index[account_number]
            return ResolvedEntity(canonical, eid, 1.0, "account")

        # 2. Extract account from description
        acc_match = ACCOUNT_RE.search(raw_clean)
        if acc_match:
            acc = acc_match.group()
            if acc in self._account_index:
                eid, canonical = self._account_index[acc]
                return ResolvedEntity(canonical, eid, 0.97, "account")

        # 3. Exact alias match
        if lower in self._alias_index:
            eid, canonical = self._alias_index[lower]
            return ResolvedEntity(canonical, eid, 1.0, "exact")

        # 4. Fuzzy alias match
        if self._alias_index:
            match = process.extractOne(
                lower,
                list(self._alias_index.keys()),
                scorer=fuzz.token_sort_ratio,
                score_cutoff=82,
            )
            if match:
                eid, canonical = self._alias_index[match[0]]
                return ResolvedEntity(canonical, eid, match[1] / 100, "fuzzy")

        # 5. Partial word overlap against canonical names
        words = set(re.split(r"\W+", lower))
        best_score = 0.0
        best_canonical = None
        for name in self._canonical_list:
            name_words = set(re.split(r"\W+", name.lower()))
            overlap = len(words & name_words) / max(len(words | name_words), 1)
            if overlap > best_score:
                best_score = overlap
                best_canonical = name

        if best_canonical and best_score >= 0.5:
            for alias_lower, (eid, canonical) in self._alias_index.items():
                if canonical == best_canonical:
                    return ResolvedEntity(canonical, eid, best_score * 0.9, "partial")

        # 6. New entity — suggest canonical name
        canonical = self._suggest_canonical(raw_clean)
        return ResolvedEntity(canonical, None, 0.0, "new")

    def _suggest_canonical(self, raw: str) -> str:
        # Nigerian bank format: "Name/AccountNumber/BankName" — extract name segment
        if "/" in raw:
            name_part = raw.split("/")[0].strip()
            if name_part:
                raw = name_part

        # Strip account numbers, dates, common noise
        clean = re.sub(r"\b\d{10}\b", "", raw)
        clean = re.sub(r"\d{4}[-/]\d{2}[-/]\d{2}", "", clean)
        clean = re.sub(r"\b(nip|neft|trf|trn|from|to|via|through)\b", "", clean, flags=re.I)
        clean = re.sub(r"[-_]+$", "", clean)  # trailing dashes (e.g. "David Shalkur -")
        clean = re.sub(r"\s+", " ", clean).strip()
        # Title-case first 3 words
        parts = clean.split()[:3]
        return " ".join(p.capitalize() for p in parts) or raw.strip()

    def add_alias(self, entity_id: str, canonical_name: str, alias: str, account_number: str | None = None) -> None:
        self._alias_index[alias.lower()] = (entity_id, canonical_name)
        if canonical_name not in self._canonical_list:
            self._canonical_list.append(canonical_name)
        if account_number:
            self._account_index[account_number] = (entity_id, canonical_name)


entity_resolver = EntityResolver()
