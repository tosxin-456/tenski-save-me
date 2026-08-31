from __future__ import annotations

from dataclasses import dataclass
from app.services.analytics.engine import SpendingAnalytics


@dataclass
class Recommendation:
    type: str
    title: str
    description: str
    potential_saving_monthly: float
    potential_saving_annual: float
    priority: int  # 1 = highest


class RecommendationEngine:
    def generate(
        self,
        analytics: SpendingAnalytics,
        subscription_total: float,
        previous_analytics: SpendingAnalytics | None = None,
    ) -> list[Recommendation]:
        recs: list[Recommendation] = []
        income = analytics.total_income
        if income <= 0:
            return recs

        # High subscriptions (>15% of income)
        if income > 0 and subscription_total / income > 0.15:
            saving = subscription_total * 0.25
            recs.append(Recommendation(
                type="HIGH_SUBSCRIPTIONS",
                title="Subscription overload",
                description=f"You're spending {subscription_total / income * 100:.1f}% of income on subscriptions. "
                            f"Reviewing and cutting unused ones could save ₦{saving:,.0f}/month.",
                potential_saving_monthly=round(saving, 2),
                potential_saving_annual=round(saving * 12, 2),
                priority=1,
            ))

        # High bank charges (>2% of income)
        if analytics.bank_charges_total / income > 0.02:
            saving = analytics.bank_charges_total * 0.5
            recs.append(Recommendation(
                type="HIGH_BANK_CHARGES",
                title="Bank charges eating into income",
                description=f"You paid ₦{analytics.bank_charges_total:,.0f} in bank charges "
                            f"({analytics.bank_charges_total / income * 100:.1f}% of income). "
                            f"Consider a no-fee digital bank.",
                potential_saving_monthly=round(saving, 2),
                potential_saving_annual=round(saving * 12, 2),
                priority=2,
            ))

        # High food spending (>30% of expenditure)
        food_stat = next((c for c in analytics.by_category if c.category == "Food"), None)
        if food_stat and analytics.total_expenditure > 0 and food_stat.total / analytics.total_expenditure > 0.30:
            saving = food_stat.total * 0.25
            recs.append(Recommendation(
                type="HIGH_FOOD",
                title="Food spending is high",
                description=f"Food is {food_stat.percentage:.1f}% of your spending. "
                            f"Reducing restaurants by 25% could save ₦{saving:,.0f}/month.",
                potential_saving_monthly=round(saving, 2),
                potential_saving_annual=round(saving * 12, 2),
                priority=2,
            ))

        # Period-over-period category increases
        if previous_analytics:
            prev_by_cat = {c.category: c.total for c in previous_analytics.by_category}
            for cat_stat in analytics.by_category:
                prev = prev_by_cat.get(cat_stat.category, 0)
                if prev > 0:
                    change = (cat_stat.total - prev) / prev * 100
                    if change >= 20:
                        saving = cat_stat.total * 0.20
                        recs.append(Recommendation(
                            type="CATEGORY_INCREASE",
                            title=f"{cat_stat.category} spending up {change:.0f}%",
                            description=f"You spent ₦{cat_stat.total:,.0f} on {cat_stat.category} this period, "
                                        f"up ₦{cat_stat.total - prev:,.0f} from last period.",
                            potential_saving_monthly=round(saving, 2),
                            potential_saving_annual=round(saving * 12, 2),
                            priority=3,
                        ))

        return sorted(recs, key=lambda r: r.priority)


recommendation_engine = RecommendationEngine()
