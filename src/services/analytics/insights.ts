import type { GeneratedInsight, NormalizedTransaction, SpendingAnalytics } from "../../types";

// ─── Insights Generator — deterministic, data-driven ──────────────────────────

export class InsightsGenerator {
  generate(
    transactions: NormalizedTransaction[],
    analytics: SpendingAnalytics,
    previous?: NormalizedTransaction[]
  ): GeneratedInsight[] {
    const insights: GeneratedInsight[] = [];

    // ── Biggest spending day
    const biggestDay = analytics.byDay.reduce(
      (best, d) => (d.expenditure > best.expenditure ? d : best),
      { date: "", expenditure: 0, income: 0, count: 0 }
    );
    if (biggestDay.expenditure > 0) {
      insights.push({
        type: "BIGGEST_SPENDING_DAY",
        title: "Biggest spending day",
        body: `${this.formatDate(biggestDay.date)} was your biggest spending day with ₦${this.fmt(biggestDay.expenditure)} across ${biggestDay.count} transaction${biggestDay.count !== 1 ? "s" : ""}.`,
        icon: "🔥",
        severity: "info",
        data: biggestDay,
      });
    }

    // ── Largest transaction
    const allDebits = transactions
      .filter((t) => t.type === "debit")
      .sort((a, b) => b.amount - a.amount);
    if (allDebits.length > 0) {
      const largest = allDebits[0];
      insights.push({
        type: "LARGEST_TRANSACTION",
        title: "Largest transaction",
        body: `Your largest transaction was ₦${this.fmt(largest.amount)} — ${largest.description}.`,
        icon: "💸",
        severity: "info",
        data: { amount: largest.amount, description: largest.description, date: largest.date },
      });
    }

    // ── Top spending category
    if (analytics.byCategory.length > 0) {
      const top = analytics.byCategory[0];
      insights.push({
        type: "TOP_CATEGORY",
        title: `${top.category} is your top category`,
        body: `${top.category} was your biggest spending category at ₦${this.fmt(top.amount)} (${Math.round(top.percentage)}% of total spending).`,
        icon: "📊",
        severity: "info",
        data: top,
      });
    }

    // ── Top recipient (person)
    const people = analytics.byEntity
      .filter((e) => e.totalSent > 0)
      .sort((a, b) => b.totalSent - a.totalSent);
    if (people.length > 0) {
      const topPerson = people[0];
      insights.push({
        type: "TOP_RECIPIENT",
        title: `${topPerson.entity} received the most`,
        body: `You sent ₦${this.fmt(topPerson.totalSent)} to ${topPerson.entity} across ${topPerson.count} transaction${topPerson.count !== 1 ? "s" : ""}.`,
        icon: "👤",
        severity: "info",
        data: topPerson,
      });
    }

    // ── Subscription total
    if (analytics.subscriptionTotal > 0) {
      const annual = analytics.subscriptionTotal * 12;
      insights.push({
        type: "SUBSCRIPTION_TOTAL",
        title: "Your subscriptions this period",
        body: `Your active subscriptions cost ₦${this.fmt(analytics.subscriptionTotal)} this period — that's approximately ₦${this.fmt(annual)} per year.`,
        icon: "🔄",
        severity: analytics.subscriptionTotal > analytics.totalIncome * 0.15 ? "warning" : "info",
        data: {
          monthly: analytics.subscriptionTotal,
          annual,
          percentage: analytics.totalIncome > 0
            ? Math.round((analytics.subscriptionTotal / analytics.totalIncome) * 100)
            : 0,
        },
      });
    }

    // ── Month-over-month comparison
    if (previous && previous.length > 0) {
      const prevSpend = previous
        .filter((t) => t.type === "debit")
        .reduce((s, t) => s + t.amount, 0);
      const currSpend = analytics.totalExpenditure;

      if (prevSpend > 0) {
        const change = ((currSpend - prevSpend) / prevSpend) * 100;
        const direction = change > 0 ? "increased" : "decreased";
        const icon = change > 0 ? "📈" : "📉";
        const severity = change > 20 ? "warning" : change < -10 ? "success" : "info";

        insights.push({
          type: "MOM_CHANGE",
          title: `Spending ${direction} vs last period`,
          body: `Your spending ${direction} by ${Math.abs(Math.round(change))}% compared with the previous period (₦${this.fmt(prevSpend)} → ₦${this.fmt(currSpend)}).`,
          icon,
          severity,
          data: { prevSpend, currSpend, changePercent: Math.round(change * 10) / 10 },
        });
      }
    }

    // ── Savings rate
    if (analytics.savingsRate > 0) {
      const severity =
        analytics.savingsRate >= 20 ? "success" : analytics.savingsRate >= 10 ? "info" : "warning";
      insights.push({
        type: "SAVINGS_RATE",
        title: "Your savings rate",
        body: `You saved ${analytics.savingsRate.toFixed(1)}% of your income this period (₦${this.fmt(analytics.netCashFlow)} net cash flow).`,
        icon: analytics.savingsRate >= 20 ? "💰" : "💡",
        severity,
        data: {
          savingsRate: analytics.savingsRate,
          netCashFlow: analytics.netCashFlow,
          totalIncome: analytics.totalIncome,
        },
      });
    }

    // ── Bank charges
    if (analytics.bankChargesTotal > 0) {
      insights.push({
        type: "BANK_CHARGES",
        title: "Banking fees this period",
        body: `You paid ₦${this.fmt(analytics.bankChargesTotal)} in banking fees and charges. Over a year, that's approximately ₦${this.fmt(analytics.bankChargesTotal * 12)}.`,
        icon: "🏦",
        severity: analytics.bankChargesTotal > analytics.totalIncome * 0.02 ? "warning" : "info",
        data: { bankCharges: analytics.bankChargesTotal, annualEstimate: analytics.bankChargesTotal * 12 },
      });
    }

    return insights;
  }

  private fmt(amount: number): string {
    return new Intl.NumberFormat("en-NG").format(Math.round(amount));
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) return "Unknown date";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" });
  }
}

export const insightsGenerator = new InsightsGenerator();
