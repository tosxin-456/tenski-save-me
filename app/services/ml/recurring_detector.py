from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from collections import defaultdict

KNOWN_SUBSCRIPTIONS: dict[str, tuple[str, str]] = {
    "netflix": ("Streaming", "monthly"), "spotify": ("Music", "monthly"),
    "youtube premium": ("Streaming", "monthly"), "showmax": ("Streaming", "monthly"),
    "amazon prime": ("Streaming", "monthly"), "prime video": ("Streaming", "monthly"),
    "apple music": ("Music", "monthly"), "deezer": ("Music", "monthly"),
    "dstv": ("Cable TV", "monthly"), "gotv": ("Cable TV", "monthly"),
    "startimes": ("Cable TV", "monthly"),
    "icloud": ("Cloud Storage", "monthly"), "google one": ("Cloud Storage", "monthly"),
    "dropbox": ("Cloud Storage", "monthly"),
    "microsoft 365": ("Software", "annual"), "office 365": ("Software", "annual"),
    "adobe": ("Software", "monthly"), "canva": ("Software", "monthly"),
    "chatgpt": ("Software", "monthly"), "nordvpn": ("VPN", "monthly"),
    "expressvpn": ("VPN", "monthly"),
    "coursera": ("Education", "monthly"), "udemy": ("Education", "one-time"),
    "audible": ("Audiobooks", "monthly"),
    "piggyvest": ("Savings", "monthly"), "cowrywise": ("Savings", "monthly"),
}

FREQ_DAYS = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 91, "annual": 365}
FREQ_ANNUAL_MULTIPLIER = {"daily": 365, "weekly": 52, "monthly": 12, "quarterly": 4, "annual": 1}


@dataclass
class DetectedSubscription:
    name: str
    merchant: str
    amount: float
    frequency: str
    subcategory: str
    last_seen: date
    next_expected: date
    annual_cost: float
    confidence: float
    is_known: bool


class RecurringDetector:
    def detect(self, transactions: list[dict]) -> list[DetectedSubscription]:
        results: list[DetectedSubscription] = []
        seen_merchants: set[str] = set()

        # Group by merchant/description
        groups: dict[str, list[dict]] = defaultdict(list)
        for tx in transactions:
            if tx.get("type") != "debit":
                continue
            key = (tx.get("merchant") or tx.get("description", "")).lower()
            if key:
                groups[key].append(tx)

        for key, txs in groups.items():
            # Known subscription
            for sub_name, (subcat, freq) in KNOWN_SUBSCRIPTIONS.items():
                if sub_name in key and len(txs) >= 1:
                    if sub_name in seen_merchants:
                        continue
                    seen_merchants.add(sub_name)
                    amounts = [float(t["amount"]) for t in txs]
                    avg_amount = sum(amounts) / len(amounts)
                    last = max(t["date"] for t in txs)
                    if isinstance(last, str):
                        from datetime import datetime
                        last = datetime.fromisoformat(last).date()
                    freq_days = FREQ_DAYS.get(freq, 30)
                    next_exp = last + timedelta(days=freq_days)
                    annual = avg_amount * FREQ_ANNUAL_MULTIPLIER.get(freq, 12)
                    results.append(DetectedSubscription(
                        name=sub_name.title(), merchant=sub_name.title(),
                        amount=round(avg_amount, 2), frequency=freq,
                        subcategory=subcat, last_seen=last,
                        next_expected=next_exp, annual_cost=round(annual, 2),
                        confidence=0.97, is_known=True,
                    ))
                    break
            else:
                # Unknown recurring — detect by frequency
                if len(txs) < 2:
                    continue
                dates = sorted(
                    t["date"] if isinstance(t["date"], date) else
                    __import__("datetime").datetime.fromisoformat(str(t["date"])).date()
                    for t in txs
                )
                if len(dates) < 2:
                    continue
                gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
                avg_gap = sum(gaps) / len(gaps)
                variance = max(gaps) - min(gaps)

                if variance > 10:
                    continue

                amounts = [float(t["amount"]) for t in txs]
                avg_amount = sum(amounts) / len(amounts)
                amount_variance = max(amounts) - min(amounts)

                if amount_variance / avg_amount > 0.15:
                    continue

                freq = self._gap_to_freq(avg_gap)
                if not freq:
                    continue

                if key in seen_merchants:
                    continue
                seen_merchants.add(key)

                last = dates[-1]
                next_exp = last + timedelta(days=int(avg_gap))
                annual = avg_amount * (365 / avg_gap)

                results.append(DetectedSubscription(
                    name=key.title(), merchant=key.title(),
                    amount=round(avg_amount, 2), frequency=freq,
                    subcategory="Recurring", last_seen=last,
                    next_expected=next_exp, annual_cost=round(annual, 2),
                    confidence=0.78, is_known=False,
                ))

        return results

    def _gap_to_freq(self, days: float) -> str | None:
        if days <= 2:
            return "daily"
        if 5 <= days <= 9:
            return "weekly"
        if 25 <= days <= 35:
            return "monthly"
        if 85 <= days <= 97:
            return "quarterly"
        if 355 <= days <= 375:
            return "annual"
        return None


recurring_detector = RecurringDetector()
