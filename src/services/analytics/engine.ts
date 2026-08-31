import type {
  SpendingAnalytics,
  CategoryBreakdown,
  MerchantBreakdown,
  EntityBreakdown,
  DayBreakdown,
  PeriodBreakdown,
  NormalizedTransaction,
} from "../../types";

// ─── Analytics Engine — all calculations are deterministic ────────────────────

export class AnalyticsEngine {
  compute(transactions: NormalizedTransaction[]): SpendingAnalytics {
    const debits = transactions.filter(
      (t) => t.type === "debit" && !t.isDuplicate
    );
    const credits = transactions.filter(
      (t) => t.type === "credit" && !t.isDuplicate
    );

    const totalIncome = credits.reduce((s, t) => s + t.amount, 0);
    const totalExpenditure = debits.reduce((s, t) => s + t.amount, 0);
    const netCashFlow = totalIncome - totalExpenditure;
    const savingsRate =
      totalIncome > 0 ? ((totalIncome - totalExpenditure) / totalIncome) * 100 : 0;

    const allAmounts = [...debits, ...credits].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const uniqueDays = this.getUniqueDays(debits);
    const avgDailySpending =
      uniqueDays > 0 ? totalExpenditure / uniqueDays : 0;
    const avgWeeklySpending = avgDailySpending * 7;
    const avgMonthlySpending = avgDailySpending * 30.44;

    const largestTransaction = Math.max(...allAmounts.map((t) => t.amount), 0);
    const transactionCount = transactions.filter((t) => !t.isDuplicate).length;

    const bankChargesTotal = debits
      .filter((t) => t.isBankCharge)
      .reduce((s, t) => s + t.amount, 0);
    const subscriptionTotal = debits
      .filter((t) => t.isSubscription)
      .reduce((s, t) => s + t.amount, 0);
    const recurringTotal = debits
      .filter((t) => t.isRecurring || t.isSubscription)
      .reduce((s, t) => s + t.amount, 0);

    return {
      totalIncome,
      totalExpenditure,
      netCashFlow,
      savingsRate: Math.round(savingsRate * 100) / 100,
      avgDailySpending,
      avgWeeklySpending,
      avgMonthlySpending,
      largestTransaction,
      transactionCount,
      byCategory: this.computeCategoryBreakdown(debits, totalExpenditure),
      byMerchant: this.computeMerchantBreakdown(debits, totalExpenditure),
      byEntity: this.computeEntityBreakdown(transactions),
      byDay: this.computeDayBreakdown(transactions),
      byWeek: this.computePeriodBreakdown(transactions, "week"),
      byMonth: this.computePeriodBreakdown(transactions, "month"),
      recurringTotal,
      subscriptionTotal,
      bankChargesTotal,
    };
  }

  private computeCategoryBreakdown(
    debits: NormalizedTransaction[],
    total: number
  ): CategoryBreakdown[] {
    const map = new Map<string, { amount: number; count: number; subcategories: Map<string, number> }>();

    for (const t of debits) {
      const cat = t.category || "Other";
      const existing = map.get(cat) || {
        amount: 0,
        count: 0,
        subcategories: new Map(),
      };
      existing.amount += t.amount;
      existing.count += 1;
      if (t.subcategory) {
        existing.subcategories.set(
          t.subcategory,
          (existing.subcategories.get(t.subcategory) || 0) + t.amount
        );
      }
      map.set(cat, existing);
    }

    const result: CategoryBreakdown[] = [];
    for (const [cat, data] of map) {
      result.push({
        category: cat,
        amount: data.amount,
        count: data.count,
        percentage: total > 0 ? (data.amount / total) * 100 : 0,
      });
    }

    return result.sort((a, b) => b.amount - a.amount);
  }

  private computeMerchantBreakdown(
    debits: NormalizedTransaction[],
    total: number
  ): MerchantBreakdown[] {
    const map = new Map<string, { amount: number; count: number; category?: string }>();

    for (const t of debits) {
      if (!t.merchant) continue;
      const existing = map.get(t.merchant) || { amount: 0, count: 0, category: t.category };
      existing.amount += t.amount;
      existing.count += 1;
      map.set(t.merchant, existing);
    }

    const result: MerchantBreakdown[] = [];
    for (const [merchant, data] of map) {
      result.push({
        merchant,
        amount: data.amount,
        count: data.count,
        percentage: total > 0 ? (data.amount / total) * 100 : 0,
        category: data.category,
      });
    }

    return result.sort((a, b) => b.amount - a.amount).slice(0, 20);
  }

  private computeEntityBreakdown(
    transactions: NormalizedTransaction[]
  ): EntityBreakdown[] {
    const map = new Map<
      string,
      {
        id?: string;
        type?: string;
        sent: number;
        received: number;
        count: number;
        amounts: number[];
      }
    >();

    for (const t of transactions) {
      if (!t.entity) continue;
      const key = t.entity;
      const existing = map.get(key) || {
        sent: 0,
        received: 0,
        count: 0,
        amounts: [],
      };
      if (t.type === "debit") existing.sent += t.amount;
      if (t.type === "credit") existing.received += t.amount;
      existing.count += 1;
      existing.amounts.push(t.amount);
      map.set(key, existing);
    }

    const result: EntityBreakdown[] = [];
    for (const [entity, data] of map) {
      result.push({
        entity,
        totalSent: data.sent,
        totalReceived: data.received,
        netAmount: data.received - data.sent,
        count: data.count,
        averageAmount: data.amounts.reduce((s, a) => s + a, 0) / data.amounts.length,
        largestTransaction: Math.max(...data.amounts),
      });
    }

    return result.sort((a, b) => b.totalSent - a.totalSent);
  }

  private computeDayBreakdown(transactions: NormalizedTransaction[]): DayBreakdown[] {
    const map = new Map<string, { income: number; expenditure: number; count: number }>();

    for (const t of transactions) {
      const dayKey = new Date(t.date).toISOString().slice(0, 10);
      const existing = map.get(dayKey) || { income: 0, expenditure: 0, count: 0 };
      if (t.type === "credit") existing.income += t.amount;
      if (t.type === "debit") existing.expenditure += t.amount;
      existing.count += 1;
      map.set(dayKey, existing);
    }

    return Array.from(map.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private computePeriodBreakdown(
    transactions: NormalizedTransaction[],
    period: "week" | "month"
  ): PeriodBreakdown[] {
    const map = new Map<string, { income: number; expenditure: number; count: number }>();

    for (const t of transactions) {
      const d = new Date(t.date);
      let key: string;
      if (period === "month") {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      } else {
        // ISO week
        const thursday = new Date(d.getTime());
        thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
        const jan4 = new Date(thursday.getFullYear(), 0, 4);
        const week = Math.ceil(
          ((thursday.getTime() - jan4.getTime()) / 86400000 + 1) / 7
        );
        key = `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`;
      }

      const existing = map.get(key) || { income: 0, expenditure: 0, count: 0 };
      if (t.type === "credit") existing.income += t.amount;
      if (t.type === "debit") existing.expenditure += t.amount;
      existing.count += 1;
      map.set(key, existing);
    }

    return Array.from(map.entries())
      .map(([p, data]) => ({
        period: p,
        income: data.income,
        expenditure: data.expenditure,
        savings: data.income - data.expenditure,
        count: data.count,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  private getUniqueDays(transactions: NormalizedTransaction[]): number {
    const days = new Set(
      transactions.map((t) => new Date(t.date).toISOString().slice(0, 10))
    );
    return days.size || 1;
  }

  // ─── Period Comparison ──────────────────────────────────────────────────────

  compareMonths(
    current: NormalizedTransaction[],
    previous: NormalizedTransaction[]
  ): Record<string, number> {
    const computeTotal = (txs: NormalizedTransaction[], type: string) =>
      txs.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);

    const currentSpend = computeTotal(current, "debit");
    const previousSpend = computeTotal(previous, "debit");
    const currentIncome = computeTotal(current, "credit");
    const previousIncome = computeTotal(previous, "credit");

    const spendChange =
      previousSpend > 0
        ? ((currentSpend - previousSpend) / previousSpend) * 100
        : 0;

    const incomeChange =
      previousIncome > 0
        ? ((currentIncome - previousIncome) / previousIncome) * 100
        : 0;

    return {
      currentSpend,
      previousSpend,
      spendChange: Math.round(spendChange * 100) / 100,
      currentIncome,
      previousIncome,
      incomeChange: Math.round(incomeChange * 100) / 100,
    };
  }

  // ─── Money Leak Detection ───────────────────────────────────────────────────

  detectMoneyLeaks(
    current: NormalizedTransaction[],
    previous: NormalizedTransaction[]
  ): Array<{
    category: string;
    currentAmount: number;
    previousAmount: number;
    changePercent: number;
    potentialSavingMonthly: number;
    potentialSavingAnnual: number;
  }> {
    const currentByCategory = this.groupByCategory(current);
    const previousByCategory = this.groupByCategory(previous);
    const leaks = [];

    for (const [cat, currentAmount] of currentByCategory) {
      if (cat === "Income") continue;

      const previousAmount = previousByCategory.get(cat) || 0;
      if (previousAmount === 0 || currentAmount < 1000) continue;

      const changePercent =
        ((currentAmount - previousAmount) / previousAmount) * 100;

      if (changePercent >= 15) {
        const suggestion = 0.25; // Suggest 25% reduction
        const potentialSavingMonthly = currentAmount * suggestion;
        const potentialSavingAnnual = potentialSavingMonthly * 12;

        leaks.push({
          category: cat,
          currentAmount,
          previousAmount,
          changePercent: Math.round(changePercent * 10) / 10,
          potentialSavingMonthly: Math.round(potentialSavingMonthly),
          potentialSavingAnnual: Math.round(potentialSavingAnnual),
        });
      }
    }

    return leaks.sort((a, b) => b.changePercent - a.changePercent);
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
}

export const analyticsEngine = new AnalyticsEngine();
