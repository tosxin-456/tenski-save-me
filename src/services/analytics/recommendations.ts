import type {
  GeneratedRecommendation,
  NormalizedTransaction,
  SpendingAnalytics,
} from "../../types";

// ─── Rule-Based Recommendation Engine ────────────────────────────────────────
// All math is deterministic. Never fabricate numbers.

const INCOME_SUBSCRIPTION_THRESHOLD = 0.15; // 15% of income
const INCOME_BANKCHARGE_THRESHOLD = 0.02; // 2% of income
const SPENDING_INCREASE_THRESHOLD = 0.20; // 20% increase triggers recommendation
const HIGH_FOOD_PERCENTAGE = 0.30; // 30% of spend on food is high
const HIGH_TRANSPORT_PERCENTAGE = 0.20;

export class RecommendationEngine {
  generate(
    current: NormalizedTransaction[],
    previous: NormalizedTransaction[],
    analytics: SpendingAnalytics,
    subscriptionTotal: number
  ): GeneratedRecommendation[] {
    const recommendations: GeneratedRecommendation[] = [];

    const totalIncome = analytics.totalIncome;
    const totalSpend = analytics.totalExpenditure;

    // 1. Subscription burden
    if (totalIncome > 0 && subscriptionTotal > 0) {
      const subPct = subscriptionTotal / totalIncome;
      if (subPct > INCOME_SUBSCRIPTION_THRESHOLD) {
        const pct = Math.round(subPct * 100);
        recommendations.push({
          type: "HIGH_SUBSCRIPTIONS",
          title: "High subscription spend",
          description: `Your recurring subscriptions represent ${pct}% of your income this period. Consider reviewing which subscriptions you actively use.`,
          currentSpend: subscriptionTotal,
          suggestedReduction: 0.20,
          potentialSavingMonthly: subscriptionTotal * 0.20,
          potentialSavingAnnual: subscriptionTotal * 0.20 * 12,
          priority: 8,
          data: { subscriptionTotal, percentage: pct },
        });
      }
    }

    // 2. Bank charges
    const bankCharges = analytics.bankChargesTotal;
    if (totalIncome > 0 && bankCharges > 0) {
      const chargePct = bankCharges / totalIncome;
      if (chargePct > INCOME_BANKCHARGE_THRESHOLD) {
        recommendations.push({
          type: "HIGH_BANK_CHARGES",
          title: "Significant banking fees",
          description: `You paid ₦${this.fmt(bankCharges)} in banking fees this period. Switching to a zero-fee account (e.g., Kuda, OPay) may reduce this.`,
          currentSpend: bankCharges,
          suggestedReduction: 0.80,
          potentialSavingMonthly: bankCharges * 0.80,
          potentialSavingAnnual: bankCharges * 0.80 * 12,
          priority: 7,
          data: { bankCharges, percentage: Math.round(chargePct * 100) },
        });
      }
    }

    // 3. Category-level spending increases vs previous period
    if (previous.length > 0) {
      const currentByCategory = this.groupByCategory(current);
      const previousByCategory = this.groupByCategory(previous);

      for (const [cat, currentAmt] of currentByCategory) {
        if (["Income", "Financial", "Savings"].includes(cat)) continue;
        const previousAmt = previousByCategory.get(cat) || 0;
        if (previousAmt === 0 || currentAmt < 1000) continue;

        const change = (currentAmt - previousAmt) / previousAmt;
        if (change > SPENDING_INCREASE_THRESHOLD) {
          const pct = Math.round(change * 100);
          recommendations.push({
            type: "CATEGORY_INCREASE",
            title: `${cat} spending increased ${pct}%`,
            description: `Your spending on ${cat} increased by ${pct}% compared with the previous period (₦${this.fmt(previousAmt)} → ₦${this.fmt(currentAmt)}). Based on your pattern, you could potentially save ₦${this.fmt(currentAmt * 0.20)}/month by reducing by 20%.`,
            currentSpend: currentAmt,
            suggestedReduction: 0.20,
            potentialSavingMonthly: currentAmt * 0.20,
            potentialSavingAnnual: currentAmt * 0.20 * 12,
            priority: 6,
            data: { category: cat, previousAmt, currentAmt, changePercent: pct },
          });
        }
      }
    }

    // 4. High food spending
    const foodData = analytics.byCategory.find(
      (c) => c.category === "Food"
    );
    if (foodData && totalSpend > 0) {
      const foodPct = foodData.amount / totalSpend;
      if (foodPct > HIGH_FOOD_PERCENTAGE) {
        recommendations.push({
          type: "HIGH_FOOD",
          title: "Food is your largest spending category",
          description: `Food accounts for ${Math.round(foodPct * 100)}% of your spending (₦${this.fmt(foodData.amount)}). Based on your pattern, preparing more meals at home could potentially save ₦${this.fmt(foodData.amount * 0.25)}/month.`,
          currentSpend: foodData.amount,
          suggestedReduction: 0.25,
          potentialSavingMonthly: foodData.amount * 0.25,
          potentialSavingAnnual: foodData.amount * 0.25 * 12,
          priority: 5,
          data: { foodAmount: foodData.amount, percentage: Math.round(foodPct * 100) },
        });
      }
    }

    // 5. High mobile data spend
    const dataTransactions = current.filter(
      (t) =>
        t.type === "debit" &&
        t.subcategory === "Mobile Data"
    );
    const dataTotal = dataTransactions.reduce((s, t) => s + t.amount, 0);
    if (dataTotal > 5000) {
      recommendations.push({
        type: "HIGH_MOBILE_DATA",
        title: "Mobile data is a notable expense",
        description: `You spent ₦${this.fmt(dataTotal)} on mobile data this period. Consider a monthly data bundle instead of daily plans to potentially save up to 30%.`,
        currentSpend: dataTotal,
        suggestedReduction: 0.30,
        potentialSavingMonthly: dataTotal * 0.30,
        potentialSavingAnnual: dataTotal * 0.30 * 12,
        priority: 5,
        data: { dataTotal },
      });
    }

    // 6. Many small transactions (convenience spending)
    const smallTx = current.filter((t) => t.type === "debit" && t.amount < 500);
    if (smallTx.length > 20) {
      const smallTotal = smallTx.reduce((s, t) => s + t.amount, 0);
      recommendations.push({
        type: "SMALL_TRANSACTIONS",
        title: "Many small purchases add up",
        description: `You made ${smallTx.length} transactions under ₦500, totaling ₦${this.fmt(smallTotal)}. Tracking and planning small purchases could potentially save ₦${this.fmt(smallTotal * 0.30)}/month.`,
        currentSpend: smallTotal,
        suggestedReduction: 0.30,
        potentialSavingMonthly: smallTotal * 0.30,
        potentialSavingAnnual: smallTotal * 0.30 * 12,
        priority: 3,
        data: { count: smallTx.length, total: smallTotal },
      });
    }

    // Sort by priority descending
    return recommendations.sort((a, b) => b.priority - a.priority).slice(0, 8);
  }

  private groupByCategory(
    transactions: NormalizedTransaction[]
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (const t of transactions.filter((t) => t.type === "debit")) {
      const cat = t.category || "Other";
      map.set(cat, (map.get(cat) || 0) + t.amount);
    }
    return map;
  }

  private fmt(amount: number): string {
    return new Intl.NumberFormat("en-NG").format(Math.round(amount));
  }
}

export const recommendationEngine = new RecommendationEngine();
