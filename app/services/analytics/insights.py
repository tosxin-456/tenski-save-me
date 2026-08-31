from __future__ import annotations

from dataclasses import dataclass
from app.services.analytics.engine import SpendingAnalytics


@dataclass
class Insight:
    id: str
    type: str
    severity: str  # high | medium | low | info
    title: str
    description: str
    potential_saving: float | None
    category: str | None


class InsightsGenerator:
    def generate(self, analytics: SpendingAnalytics) -> list[Insight]:
        insights: list[Insight] = []
        income = analytics.total_income
        spend = analytics.total_expenditure
        idx = 0

        def make_id() -> str:
            nonlocal idx
            idx += 1
            return str(idx)

        # Savings rate
        if analytics.savings_rate >= 20:
            insights.append(Insight(
                id=make_id(), type="positive", severity="info",
                title=f"Strong savings rate: {analytics.savings_rate:.1f}%",
                description=f"You saved ₦{analytics.net_cash_flow:,.0f} this period. That's a great habit!",
                potential_saving=None, category=None,
            ))
        elif analytics.savings_rate < 5 and income > 0:
            insights.append(Insight(
                id=make_id(), type="low_savings", severity="high",
                title=f"Low savings rate: {analytics.savings_rate:.1f}%",
                description=f"Less than 5% of income was saved this period. Aim for at least 20%.",
                potential_saving=round(income * 0.20 - analytics.net_cash_flow, 2),
                category=None,
            ))

        # Bank charges
        if income > 0 and analytics.bank_charges_total / income > 0.02:
            insights.append(Insight(
                id=make_id(), type="bank_charges", severity="medium",
                title=f"Bank charges: ₦{analytics.bank_charges_total:,.0f}",
                description=f"You paid ₦{analytics.bank_charges_total:,.0f} in fees "
                            f"({analytics.bank_charges_total / income * 100:.1f}% of income).",
                potential_saving=round(analytics.bank_charges_total * 0.5, 2),
                category="Financial",
            ))

        # Category insights
        for cat_stat in analytics.by_category[:5]:
            # High spending category
            if spend > 0 and cat_stat.percentage > 25 and cat_stat.category != "People":
                saving = cat_stat.total * 0.25
                insights.append(Insight(
                    id=make_id(), type="high_category", severity="medium",
                    title=f"{cat_stat.category} is {cat_stat.percentage:.1f}% of spending",
                    description=f"You spent ₦{cat_stat.total:,.0f} on {cat_stat.category}. "
                                f"Reducing by 25% could save ₦{saving:,.0f}/month.",
                    potential_saving=round(saving, 2),
                    category=cat_stat.category,
                ))

        # Subscriptions
        if analytics.subscription_total > 0 and income > 0:
            sub_pct = analytics.subscription_total / income * 100
            if sub_pct > 10:
                saving = analytics.subscription_total * 0.25
                insights.append(Insight(
                    id=make_id(), type="subscriptions", severity="medium",
                    title=f"Subscriptions cost ₦{analytics.subscription_total:,.0f}/month",
                    description=f"That's {sub_pct:.1f}% of income — ₦{analytics.subscription_total * 12:,.0f}/year. "
                                f"Review unused ones.",
                    potential_saving=round(saving, 2),
                    category="Subscriptions",
                ))

        # Largest debit
        if analytics.largest_debit:
            insights.append(Insight(
                id=make_id(), type="largest_transaction", severity="info",
                title=f"Biggest spend: ₦{float(analytics.largest_debit.get('amount', 0)):,.0f}",
                description=f"{analytics.largest_debit.get('description', 'Unknown')[:80]}",
                potential_saving=None, category=analytics.largest_debit.get("category"),
            ))

        return insights


insights_generator = InsightsGenerator()
