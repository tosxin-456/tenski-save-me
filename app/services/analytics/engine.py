from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any


@dataclass
class CategoryStat:
    category: str
    total: float
    count: int
    percentage: float


@dataclass
class EntityStat:
    name: str
    sent_total: float
    received_total: float
    net_flow: float
    transaction_count: int


@dataclass
class SpendingAnalytics:
    total_income: float
    total_expenditure: float
    net_cash_flow: float
    savings_rate: float
    avg_daily: float
    avg_weekly: float
    avg_monthly: float
    by_category: list[CategoryStat]
    by_merchant: list[dict]
    by_entity: list[EntityStat]
    by_day: list[dict]
    by_week: list[dict]
    by_month: list[dict]
    recurring_total: float
    subscription_total: float
    bank_charges_total: float
    largest_debit: dict | None
    largest_credit: dict | None


def _parse_date(d: Any) -> date:
    if isinstance(d, date):
        return d
    from datetime import datetime
    if isinstance(d, str):
        return datetime.fromisoformat(d).date()
    return d


class AnalyticsEngine:
    def compute(self, transactions: list[dict]) -> SpendingAnalytics:
        debits = [t for t in transactions if t.get("type") == "debit" and not t.get("is_duplicate")]
        credits = [t for t in transactions if t.get("type") == "credit" and not t.get("is_duplicate")]

        total_income = sum(float(t["amount"]) for t in credits)
        total_expenditure = sum(float(t["amount"]) for t in debits)
        net = total_income - total_expenditure
        savings_rate = (net / total_income * 100) if total_income > 0 else 0.0

        # Category breakdown
        cat_totals: dict[str, float] = defaultdict(float)
        cat_counts: dict[str, int] = defaultdict(int)
        for t in debits:
            cat = t.get("category") or "Unknown"
            cat_totals[cat] += float(t["amount"])
            cat_counts[cat] += 1

        by_category = sorted(
            [
                CategoryStat(
                    category=cat,
                    total=round(total, 2),
                    count=cat_counts[cat],
                    percentage=round((total / total_expenditure * 100) if total_expenditure > 0 else 0, 2),
                )
                for cat, total in cat_totals.items()
            ],
            key=lambda x: x.total, reverse=True,
        )

        # Merchant breakdown
        merchant_totals: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0})
        for t in debits:
            m = t.get("merchant")
            if m:
                merchant_totals[m]["total"] += float(t["amount"])
                merchant_totals[m]["count"] += 1

        by_merchant = sorted(
            [{"merchant": k, "total": round(v["total"], 2), "count": v["count"]}
             for k, v in merchant_totals.items()],
            key=lambda x: x["total"], reverse=True,
        )[:15]

        # Entity (people) breakdown
        entity_map: dict[str, dict] = defaultdict(lambda: {"sent": 0.0, "received": 0.0, "count": 0})
        for t in transactions:
            eid = t.get("entity_name") or t.get("merchant")
            if not eid or t.get("category") != "People":
                continue
            if t.get("type") == "debit":
                entity_map[eid]["sent"] += float(t["amount"])
            else:
                entity_map[eid]["received"] += float(t["amount"])
            entity_map[eid]["count"] += 1

        by_entity = sorted(
            [
                EntityStat(
                    name=name,
                    sent_total=round(v["sent"], 2),
                    received_total=round(v["received"], 2),
                    net_flow=round(v["received"] - v["sent"], 2),
                    transaction_count=v["count"],
                )
                for name, v in entity_map.items()
            ],
            key=lambda x: x.sent_total + x.received_total, reverse=True,
        )

        # Time breakdown
        by_day: dict[str, float] = defaultdict(float)
        by_week: dict[str, float] = defaultdict(float)
        by_month: dict[str, dict] = defaultdict(lambda: {"income": 0.0, "expenditure": 0.0})

        for t in transactions:
            d = _parse_date(t["date"])
            month_key = d.strftime("%b %Y")
            if t.get("type") == "debit":
                by_day[str(d)] += float(t["amount"])
                week_key = f"{d.year}-W{d.isocalendar().week:02d}"
                by_week[week_key] += float(t["amount"])
                by_month[month_key]["expenditure"] += float(t["amount"])
            else:
                by_month[month_key]["income"] += float(t["amount"])

        days = len(by_day) or 1
        avg_daily = total_expenditure / days
        avg_weekly = avg_daily * 7
        avg_monthly = avg_daily * 30

        recurring_total = sum(float(t["amount"]) for t in debits if t.get("is_recurring"))
        subscription_total = sum(float(t["amount"]) for t in debits if t.get("is_subscription"))
        bank_charges_total = sum(float(t["amount"]) for t in debits if t.get("is_bank_charge"))

        largest_debit = max(debits, key=lambda t: float(t["amount"]), default=None)
        largest_credit = max(credits, key=lambda t: float(t["amount"]), default=None)

        return SpendingAnalytics(
            total_income=round(total_income, 2),
            total_expenditure=round(total_expenditure, 2),
            net_cash_flow=round(net, 2),
            savings_rate=round(savings_rate, 2),
            avg_daily=round(avg_daily, 2),
            avg_weekly=round(avg_weekly, 2),
            avg_monthly=round(avg_monthly, 2),
            by_category=by_category,
            by_merchant=by_merchant,
            by_entity=by_entity,
            by_day=[{"date": k, "amount": round(v, 2)} for k, v in sorted(by_day.items())],
            by_week=[{"week": k, "amount": round(v, 2)} for k, v in sorted(by_week.items())],
            by_month=[{"month": k, "income": round(v["income"], 2), "expenditure": round(v["expenditure"], 2)}
                      for k, v in sorted(by_month.items())],
            recurring_total=round(recurring_total, 2),
            subscription_total=round(subscription_total, 2),
            bank_charges_total=round(bank_charges_total, 2),
            largest_debit=largest_debit,
            largest_credit=largest_credit,
        )

    def detect_money_leaks(self, current: list[dict], previous: list[dict]) -> list[dict]:
        def cat_totals(txs: list[dict]) -> dict[str, float]:
            totals: dict[str, float] = defaultdict(float)
            for t in txs:
                if t.get("type") == "debit" and not t.get("is_duplicate"):
                    cat = t.get("category") or "Unknown"
                    totals[cat] += float(t["amount"])
            return totals

        curr = cat_totals(current)
        prev = cat_totals(previous)
        leaks = []

        for cat, curr_amt in curr.items():
            prev_amt = prev.get(cat, 0)
            if prev_amt <= 0:
                continue
            change_pct = ((curr_amt - prev_amt) / prev_amt) * 100
            if change_pct >= 15:
                saving = curr_amt * 0.25
                leaks.append({
                    "category": cat,
                    "current_amount": round(curr_amt, 2),
                    "previous_amount": round(prev_amt, 2),
                    "change_percent": round(change_pct, 2),
                    "potential_saving_monthly": round(saving, 2),
                    "potential_saving_annual": round(saving * 12, 2),
                })

        return sorted(leaks, key=lambda x: x["change_percent"], reverse=True)

    def compare_periods(self, current: list[dict], previous: list[dict]) -> dict:
        curr_analytics = self.compute(current)
        prev_analytics = self.compute(previous)

        income_change = ((curr_analytics.total_income - prev_analytics.total_income) / prev_analytics.total_income * 100) if prev_analytics.total_income else 0
        spend_change = ((curr_analytics.total_expenditure - prev_analytics.total_expenditure) / prev_analytics.total_expenditure * 100) if prev_analytics.total_expenditure else 0

        return {
            "current": {
                "income": curr_analytics.total_income,
                "expenditure": curr_analytics.total_expenditure,
                "savings_rate": curr_analytics.savings_rate,
            },
            "previous": {
                "income": prev_analytics.total_income,
                "expenditure": prev_analytics.total_expenditure,
                "savings_rate": prev_analytics.savings_rate,
            },
            "income_change_pct": round(income_change, 2),
            "spend_change_pct": round(spend_change, 2),
        }


analytics_engine = AnalyticsEngine()
