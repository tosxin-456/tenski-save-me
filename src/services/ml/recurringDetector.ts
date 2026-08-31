import type { DetectedSubscription, NormalizedTransaction } from "../../types";

interface TransactionGroup {
  description: string;
  merchant?: string;
  transactions: NormalizedTransaction[];
  amounts: number[];
  dates: Date[];
}

export class RecurringDetector {
  private readonly MIN_OCCURRENCES = 2;
  private readonly AMOUNT_VARIANCE_THRESHOLD = 0.1; // 10%
  private readonly MAX_INTERVAL_VARIANCE_DAYS = 5;

  // ─── Known Subscription Merchants ─────────────────────────────────────────
  private readonly KNOWN_SUBSCRIPTIONS = new Map<string, {
    name: string;
    category: string;
    subcategory: string;
    frequency: DetectedSubscription["frequency"];
  }>([
    ["netflix", { name: "Netflix", category: "Subscriptions", subcategory: "Streaming", frequency: "monthly" }],
    ["spotify", { name: "Spotify", category: "Subscriptions", subcategory: "Music", frequency: "monthly" }],
    ["youtube premium", { name: "YouTube Premium", category: "Subscriptions", subcategory: "Streaming", frequency: "monthly" }],
    ["amazon prime", { name: "Amazon Prime", category: "Subscriptions", subcategory: "Streaming", frequency: "monthly" }],
    ["apple music", { name: "Apple Music", category: "Subscriptions", subcategory: "Music", frequency: "monthly" }],
    ["icloud", { name: "iCloud", category: "Subscriptions", subcategory: "Cloud Services", frequency: "monthly" }],
    ["showmax", { name: "Showmax", category: "Subscriptions", subcategory: "Streaming", frequency: "monthly" }],
    ["dstv", { name: "DSTV", category: "Bills", subcategory: "Cable TV", frequency: "monthly" }],
    ["gotv", { name: "GOTV", category: "Bills", subcategory: "Cable TV", frequency: "monthly" }],
    ["microsoft 365", { name: "Microsoft 365", category: "Subscriptions", subcategory: "Software", frequency: "monthly" }],
    ["office 365", { name: "Microsoft 365", category: "Subscriptions", subcategory: "Software", frequency: "monthly" }],
    ["google one", { name: "Google One", category: "Subscriptions", subcategory: "Cloud Services", frequency: "monthly" }],
    ["dropbox", { name: "Dropbox", category: "Subscriptions", subcategory: "Cloud Services", frequency: "monthly" }],
    ["adobe", { name: "Adobe", category: "Subscriptions", subcategory: "Software", frequency: "monthly" }],
    ["canva", { name: "Canva Pro", category: "Subscriptions", subcategory: "Software", frequency: "monthly" }],
    ["coursera", { name: "Coursera", category: "Subscriptions", subcategory: "Education", frequency: "monthly" }],
    ["audible", { name: "Audible", category: "Subscriptions", subcategory: "Education", frequency: "monthly" }],
    ["chatgpt", { name: "ChatGPT Plus", category: "Subscriptions", subcategory: "Software", frequency: "monthly" }],
    ["nordvpn", { name: "NordVPN", category: "Subscriptions", subcategory: "Software", frequency: "monthly" }],
    ["expressvpn", { name: "ExpressVPN", category: "Subscriptions", subcategory: "Software", frequency: "monthly" }],
  ]);

  detect(transactions: NormalizedTransaction[]): DetectedSubscription[] {
    const subscriptions: DetectedSubscription[] = [];

    // Step 1: Check for known subscription merchants
    const knownSubs = this.detectKnownSubscriptions(transactions);
    subscriptions.push(...knownSubs);

    // Step 2: Detect recurring patterns by grouping similar transactions
    const recurringPatterns = this.detectRecurringPatterns(transactions, knownSubs);
    subscriptions.push(...recurringPatterns);

    return this.deduplicateSubscriptions(subscriptions);
  }

  private detectKnownSubscriptions(transactions: NormalizedTransaction[]): DetectedSubscription[] {
    const result: DetectedSubscription[] = [];
    const groupedByMerchant = new Map<string, NormalizedTransaction[]>();

    for (const tx of transactions) {
      const desc = (tx.description || "").toLowerCase();
      const merchant = (tx.merchant || "").toLowerCase();
      const combined = `${desc} ${merchant}`;

      for (const [key, info] of this.KNOWN_SUBSCRIPTIONS) {
        if (combined.includes(key)) {
          const existing = groupedByMerchant.get(key) || [];
          existing.push(tx);
          groupedByMerchant.set(key, existing);
          break;
        }
      }
    }

    for (const [key, txs] of groupedByMerchant) {
      if (txs.length < 1) continue;

      const info = this.KNOWN_SUBSCRIPTIONS.get(key)!;
      const amounts = txs.map((t) => t.amount);
      const dates = txs.map((t) => t.date).sort((a, b) => a.getTime() - b.getTime());
      const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;

      const sub: DetectedSubscription = {
        name: info.name,
        merchant: info.name,
        amount: avgAmount,
        currency: txs[0].currency || "NGN",
        frequency: info.frequency,
        occurrences: dates,
        firstSeen: dates[0],
        lastSeen: dates[dates.length - 1],
        nextExpected: this.predictNextDate(dates, info.frequency),
        confidence: txs.length >= 2 ? 0.97 : 0.85,
        category: info.category,
        subcategory: info.subcategory,
        annualCost: this.calculateAnnualCost(avgAmount, info.frequency),
      };

      result.push(sub);
    }

    return result;
  }

  private detectRecurringPatterns(
    transactions: NormalizedTransaction[],
    alreadyFound: DetectedSubscription[]
  ): DetectedSubscription[] {
    const result: DetectedSubscription[] = [];
    const foundMerchants = new Set(alreadyFound.map((s) => s.merchant.toLowerCase()));

    // Group transactions by normalized description
    const groups = new Map<string, NormalizedTransaction[]>();

    for (const tx of transactions) {
      if (tx.type !== "debit") continue;

      const key = this.normalizeDescription(tx.description);
      if (key.length < 3) continue;
      if (foundMerchants.has(key)) continue;

      const existing = groups.get(key) || [];
      existing.push(tx);
      groups.set(key, existing);
    }

    for (const [key, txs] of groups) {
      if (txs.length < this.MIN_OCCURRENCES) continue;

      const amounts = txs.map((t) => t.amount);
      const dates = txs.map((t) => t.date).sort((a, b) => a.getTime() - b.getTime());

      if (!this.hasConsistentAmounts(amounts)) continue;

      const frequency = this.detectFrequency(dates);
      if (!frequency) continue;

      const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;

      result.push({
        name: this.toTitleCase(key),
        merchant: this.toTitleCase(key),
        amount: avgAmount,
        currency: txs[0].currency || "NGN",
        frequency,
        occurrences: dates,
        firstSeen: dates[0],
        lastSeen: dates[dates.length - 1],
        nextExpected: this.predictNextDate(dates, frequency),
        confidence: Math.min(0.5 + txs.length * 0.1, 0.9),
        category: txs[0].category || "Subscriptions",
        subcategory: txs[0].subcategory,
        annualCost: this.calculateAnnualCost(avgAmount, frequency),
      });
    }

    return result;
  }

  private normalizeDescription(description: string): string {
    return description
      .toLowerCase()
      .replace(/\d+/g, "")
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 30);
  }

  private hasConsistentAmounts(amounts: number[]): boolean {
    if (amounts.length < 2) return false;
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const maxVariance = avg * this.AMOUNT_VARIANCE_THRESHOLD;
    return amounts.every((a) => Math.abs(a - avg) <= maxVariance);
  }

  private detectFrequency(dates: Date[]): DetectedSubscription["frequency"] | null {
    if (dates.length < 2) return null;

    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const diffDays =
        (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
      intervals.push(diffDays);
    }

    const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length;
    const variance =
      intervals.reduce((s, d) => s + Math.abs(d - avgInterval), 0) /
      intervals.length;

    if (variance > this.MAX_INTERVAL_VARIANCE_DAYS) return null;

    if (avgInterval <= 2) return "daily";
    if (avgInterval >= 5 && avgInterval <= 10) return "weekly";
    if (avgInterval >= 25 && avgInterval <= 35) return "monthly";
    if (avgInterval >= 85 && avgInterval <= 95) return "quarterly";
    if (avgInterval >= 355 && avgInterval <= 375) return "annual";

    return null;
  }

  private predictNextDate(
    dates: Date[],
    frequency: DetectedSubscription["frequency"]
  ): Date | undefined {
    if (dates.length === 0) return undefined;
    const last = dates[dates.length - 1];
    const next = new Date(last);

    switch (frequency) {
      case "daily":
        next.setDate(next.getDate() + 1);
        break;
      case "weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
      case "quarterly":
        next.setMonth(next.getMonth() + 3);
        break;
      case "annual":
        next.setFullYear(next.getFullYear() + 1);
        break;
    }

    return next;
  }

  private calculateAnnualCost(
    amount: number,
    frequency: DetectedSubscription["frequency"]
  ): number {
    switch (frequency) {
      case "daily":
        return amount * 365;
      case "weekly":
        return amount * 52;
      case "monthly":
        return amount * 12;
      case "quarterly":
        return amount * 4;
      case "annual":
        return amount;
      default:
        return amount * 12;
    }
  }

  private deduplicateSubscriptions(subs: DetectedSubscription[]): DetectedSubscription[] {
    const seen = new Set<string>();
    return subs.filter((s) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private toTitleCase(str: string): string {
    return str
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
}

export const recurringDetector = new RecurringDetector();
