import type { Tone } from "../../types";

// ─── Natural Language Generation — deterministic template-based ───────────────
// The wording layer NEVER calculates numbers. It only verbalizes pre-calculated results.

interface SpendingContext {
  category: string;
  current: number;
  previous?: number;
  changePercent?: number;
  tone?: Tone;
}

interface InsightContext {
  type: string;
  data: Record<string, unknown>;
  tone?: Tone;
}

const formatNGN = (amount: number): string =>
  `₦${new Intl.NumberFormat("en-NG").format(Math.round(amount))}`;

// ─── Category spending verbalization ─────────────────────────────────────────

export function verbalizeCategorySpending(ctx: SpendingContext): string {
  const { category, current, previous, changePercent, tone = "friendly" } = ctx;
  const formatted = formatNGN(current);

  if (changePercent === undefined || previous === undefined) {
    switch (tone) {
      case "genz":
      case "playful":
        return `${category} took ${formatted} from you this period. The nerve.`;
      case "brutally_honest":
        return `You spent ${formatted} on ${category}.`;
      case "minimal":
        return `${category}: ${formatted}`;
      default:
        return `You spent ${formatted} on ${category} this period.`;
    }
  }

  const direction = changePercent > 0 ? "increased" : "decreased";
  const absChange = Math.abs(Math.round(changePercent));

  switch (tone) {
    case "genz":
      if (changePercent > 30)
        return `Bestie, ${category} spending said NO CHILL — up ${absChange}% to ${formatted} this period.`;
      if (changePercent > 0)
        return `${category} spending went up ${absChange}% (${formatNGN(previous)} → ${formatted}). Not ideal fr.`;
      return `${category} spending down ${absChange}%! That's a W.`;

    case "playful":
      if (changePercent > 20)
        return `Whoa! ${category} spending ${direction} by ${absChange}% this period (now ${formatted}). Time to check that.`;
      return `${category} spending ${direction} by ${absChange}% — ${formatted} this period.`;

    case "brutally_honest":
      if (changePercent > 20)
        return `${category} spending is up ${absChange}%. You went from ${formatNGN(previous)} to ${formatted}. That's a significant jump.`;
      return `${category}: ${formatted} (${direction} ${absChange}% from ${formatNGN(previous)}).`;

    case "professional":
      return `${category} expenditure ${direction} by ${absChange}% period-over-period, from ${formatNGN(previous)} to ${formatted}.`;

    case "minimal":
      return `${category} ${direction} ${absChange}%: ${formatted}`;

    default: // friendly
      if (changePercent > 20)
        return `${category} was your biggest spending increase — ${direction} by ${absChange}% to ${formatted} this period.`;
      return `${category} spending ${direction} by ${absChange}% compared with last period (now ${formatted}).`;
  }
}

// ─── Savings verbalization ────────────────────────────────────────────────────

export function verbalizeSavingsRate(savingsRate: number, tone: Tone = "friendly"): string {
  const pct = Math.round(savingsRate * 10) / 10;

  if (pct <= 0) {
    switch (tone) {
      case "genz": return `You spent everything and then some. Financially dangerous era, no cap.`;
      case "brutally_honest": return `You had no savings this period. Spending exceeded income.`;
      case "playful": return `The budget said goodbye this period — you spent everything.`;
      default: return `Your spending matched or exceeded your income this period — no savings to report.`;
    }
  }

  if (pct < 10) {
    switch (tone) {
      case "genz": return `${pct}% savings rate — it's something, but we can do better bestie.`;
      case "brutally_honest": return `${pct}% savings rate. Below the 20% benchmark. Room for improvement.`;
      default: return `You saved ${pct}% of your income this period. Small wins count — let's grow this.`;
    }
  }

  if (pct < 20) {
    switch (tone) {
      case "genz": return `${pct}% savings rate — respectable! Getting there.`;
      default: return `You saved ${pct}% of your income this period. That's solid progress.`;
    }
  }

  switch (tone) {
    case "genz": return `${pct}% savings rate? You're built different. Financially responsible era confirmed.`;
    case "brutally_honest": return `${pct}% savings rate. Good. Keep it above 20%.`;
    case "playful": return `${pct}% savings rate! Your future self is sending you a thank-you note.`;
    default: return `Excellent! You saved ${pct}% of your income this period. That's well above average.`;
  }
}

// ─── Subscription verbalization ───────────────────────────────────────────────

export function verbalizeSubscriptions(
  monthly: number,
  annual: number,
  count: number,
  tone: Tone = "friendly"
): string {
  const m = formatNGN(monthly);
  const a = formatNGN(annual);

  switch (tone) {
    case "genz":
      return `You're paying ${m}/month just to exist digitally. That's ${a}/year on ${count} subscription${count !== 1 ? "s" : ""}. The apps are eating well.`;
    case "brutally_honest":
      return `${count} subscription${count !== 1 ? "s" : ""}: ${m}/month. Annual cost: ${a}. Review which ones you actually use.`;
    case "playful":
      return `${count} subscription${count !== 1 ? "s" : ""} are quietly billing you ${m}/month — adding up to ${a} per year.`;
    case "minimal":
      return `Subscriptions: ${m}/month · ${a}/year`;
    default:
      return `Your ${count} active subscription${count !== 1 ? "s" : ""} cost ${m}/month — that's ${a} per year.`;
  }
}

// ─── Money leak verbalization ─────────────────────────────────────────────────

export function verbalizeMoneyLeak(
  category: string,
  amount: number,
  changePercent: number,
  potentialSaving: number,
  tone: Tone = "friendly"
): string {
  const a = formatNGN(amount);
  const s = formatNGN(potentialSaving);
  const pct = Math.round(changePercent);

  switch (tone) {
    case "genz":
      return `${category} is up ${pct}% to ${a}. Based on your pattern, trimming 25% could save you ${s}/month. Do with that what you will.`;
    case "brutally_honest":
      return `${category}: ${a} (↑${pct}%). At this rate, cutting 25% saves ${s}/month. That's ${formatNGN(potentialSaving * 12)}/year.`;
    case "minimal":
      return `${category} ↑${pct}% → ${a}. Potential saving: ${s}/month`;
    default:
      return `Your ${category} spending increased ${pct}% to ${a}. Based on your pattern, you could potentially save ${s}/month by reducing spend in this area by 25%.`;
  }
}

// ─── Goal verbalization ───────────────────────────────────────────────────────

export function verbalizeGoalProgress(
  goalName: string,
  current: number,
  target: number,
  monthsLeft: number,
  tone: Tone = "friendly"
): string {
  const pct = Math.round((current / target) * 100);
  const c = formatNGN(current);
  const t = formatNGN(target);

  switch (tone) {
    case "genz":
      if (pct >= 75) return `${goalName} at ${pct}% — you're literally almost there. Keep that same energy.`;
      if (pct >= 50) return `${goalName} is halfway done — ${c} of ${t}. Doing the most (in a good way).`;
      return `${goalName} at ${pct}% — ${c} of ${t} saved. About ${monthsLeft} month${monthsLeft !== 1 ? "s" : ""} away.`;
    case "minimal":
      return `${goalName}: ${c}/${t} (${pct}%) · ~${monthsLeft}mo`;
    default:
      return `You've saved ${c} toward your ${goalName} goal (${pct}% of ${t}). At your current rate, you could reach it in approximately ${monthsLeft} month${monthsLeft !== 1 ? "s" : ""}.`;
  }
}

// ─── Personality labels ───────────────────────────────────────────────────────

export function getSpendingPersonality(
  savingsRate: number,
  topCategory: string,
  tone: Tone = "friendly"
): string {
  if (tone === "minimal" || tone === "professional") return "";
  if (tone === "brutally_honest") {
    if (savingsRate <= 0) return "Negative Savings";
    if (savingsRate < 10) return "Below Average Saver";
    if (savingsRate < 20) return "Average Saver";
    return "Strong Saver";
  }

  if (savingsRate <= 0) return "Financially Dangerous";
  if (savingsRate < 5) return "Odogwu Spender";
  if (savingsRate < 10) return "Soft Life Department";
  if (savingsRate < 20) return "Serious Spender";
  if (savingsRate < 35) return "Balanced";
  return "Frugal King";
}

// ─── Intent classifier for NLQ assistant ─────────────────────────────────────

export function classifyIntent(question: string): {
  intent: string;
  entity?: string;
  category?: string;
  merchant?: string;
} {
  const q = question.toLowerCase();

  // Person spending
  const personMatch = q.match(
    /(?:how much|what|spend|sent|transfer).*?(?:to|on)\s+([a-z][a-z\s]{2,30}?)(?:\?|$)/
  );

  if (q.includes("subscription") || q.includes("recurring")) {
    return { intent: "SUBSCRIPTION_LIST" };
  }

  if (q.includes("save") || q.includes("cut") || q.includes("reduce") || q.includes("leak")) {
    return { intent: "SAVINGS_OPPORTUNITIES" };
  }

  if (q.includes("compare") || q.includes("last month") || q.includes("previous")) {
    return { intent: "COMPARE_PERIODS" };
  }

  if (q.includes("biggest") || q.includes("largest") || q.includes("most expensive")) {
    return { intent: "LARGEST_TRANSACTION" };
  }

  if (q.includes("income") || q.includes("earn") || q.includes("salary") || q.includes("received")) {
    return { intent: "INCOME_TOTAL" };
  }

  if (
    q.includes("food") || q.includes("transport") || q.includes("bills") ||
    q.includes("shopping") || q.includes("entertainment")
  ) {
    const catMatch = q.match(/(?:food|transport|bills|shopping|entertainment|housing|subscriptions)/);
    return {
      intent: "CATEGORY_SPENDING",
      category: catMatch ? catMatch[0].charAt(0).toUpperCase() + catMatch[0].slice(1) : undefined,
    };
  }

  if (personMatch) {
    const name = personMatch[1].trim();
    return {
      intent: "PERSON_SPENDING",
      entity: name.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
    };
  }

  if (q.includes("spend") || q.includes("spent") || q.includes("total") || q.includes("much")) {
    return { intent: "TOTAL_SPENDING" };
  }

  return { intent: "UNKNOWN" };
}
