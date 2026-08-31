import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { transactions } from "../db/schema";
import { eq, and, gte, lte, ilike, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { classifyIntent } from "../services/nlg/templates";
import { analyticsEngine } from "../services/analytics/engine";
import type { NormalizedTransaction } from "../types";

const router = Router();

const fmt = (n: number) =>
  `₦${new Intl.NumberFormat("en-NG").format(Math.round(n))}`;

function toNormalized(row: typeof transactions.$inferSelect): NormalizedTransaction {
  return {
    date: row.date,
    amount: parseFloat(String(row.amount)),
    currency: row.currency,
    type: row.type as "debit" | "credit" | "transfer",
    description: row.description,
    rawDescription: row.rawDescription,
    merchant: row.merchant || undefined,
    entity: undefined,
    category: undefined,
    subcategory: row.subcategory || undefined,
    isRecurring: row.isRecurring,
    isSubscription: row.isSubscription,
    isBankCharge: row.isBankCharge,
    isDuplicate: row.isDuplicate,
  };
}

// POST /api/assistant/ask
router.post("/ask", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const Schema = z.object({
      question: z.string().min(1).max(500),
      dateRange: z
        .object({
          from: z.string().optional(),
          to: z.string().optional(),
        })
        .optional(),
    });

    const body = Schema.parse(req.body);
    const { question, dateRange } = body;

    const intent = classifyIntent(question);
    const now = new Date();
    const from = dateRange?.from
      ? new Date(dateRange.from)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = dateRange?.to ? new Date(dateRange.to) : now;

    let answer = "";
    let data: Record<string, unknown> = {};

    const baseConditions = [
      eq(transactions.userId, req.user!.userId),
      eq(transactions.isDuplicate, false),
      gte(transactions.date, from),
      lte(transactions.date, to),
    ];

    switch (intent.intent) {
      case "TOTAL_SPENDING": {
        const rows = await db
          .select()
          .from(transactions)
          .where(and(...baseConditions, eq(transactions.type, "debit")));
        const total = rows.reduce(
          (s, t) => s + parseFloat(String(t.amount)),
          0
        );
        answer = `You spent a total of ${fmt(total)} between ${from.toLocaleDateString("en-NG")} and ${to.toLocaleDateString("en-NG")} across ${rows.length} transactions.`;
        data = { total, count: rows.length };
        break;
      }

      case "INCOME_TOTAL": {
        const rows = await db
          .select()
          .from(transactions)
          .where(and(...baseConditions, eq(transactions.type, "credit")));
        const total = rows.reduce(
          (s, t) => s + parseFloat(String(t.amount)),
          0
        );
        answer = `You received ${fmt(total)} in income/credits during this period across ${rows.length} transactions.`;
        data = { total, count: rows.length };
        break;
      }

      case "CATEGORY_SPENDING": {
        const rows = await db
          .select()
          .from(transactions)
          .where(and(...baseConditions, eq(transactions.type, "debit")));
        const normalized = rows.map(toNormalized);
        const analytics = analyticsEngine.compute(normalized);
        const cat = analytics.byCategory.find(
          (c) =>
            c.category.toLowerCase() === intent.category?.toLowerCase()
        );
        if (cat) {
          answer = `You spent ${fmt(cat.amount)} on ${cat.category} during this period — that's ${Math.round(cat.percentage)}% of your total spending.`;
          data = cat;
        } else {
          answer = `No significant ${intent.category || "category"} spending found in this period.`;
        }
        break;
      }

      case "PERSON_SPENDING": {
        const name = intent.entity || "";
        const rows = await db
          .select()
          .from(transactions)
          .where(
            and(
              ...baseConditions,
              ilike(transactions.description, `%${name}%`)
            )
          );
        const total = rows
          .filter((r) => r.type === "debit")
          .reduce((s, t) => s + parseFloat(String(t.amount)), 0);
        const received = rows
          .filter((r) => r.type === "credit")
          .reduce((s, t) => s + parseFloat(String(t.amount)), 0);
        answer =
          total > 0
            ? `You sent ${fmt(total)} to ${name} across ${rows.filter((r) => r.type === "debit").length} transaction(s) this period.${received > 0 ? ` They also sent you ${fmt(received)}.` : ""}`
            : `No transactions found for "${name}" in this period.`;
        data = { sent: total, received, count: rows.length };
        break;
      }

      case "SUBSCRIPTION_LIST": {
        const rows = await db
          .select()
          .from(transactions)
          .where(and(...baseConditions, eq(transactions.isSubscription, true)));
        const total = rows.reduce(
          (s, t) => s + parseFloat(String(t.amount)),
          0
        );
        answer = `You have ${rows.length} subscription payment(s) totaling ${fmt(total)} during this period. Annually, that's approximately ${fmt(total * 12)} if the same subscriptions continue.`;
        data = {
          count: rows.length,
          total,
          items: rows.map((r) => ({
            merchant: r.merchant || r.description,
            amount: parseFloat(String(r.amount)),
          })),
        };
        break;
      }

      case "SAVINGS_OPPORTUNITIES": {
        const rows = await db
          .select()
          .from(transactions)
          .where(and(...baseConditions, eq(transactions.type, "debit")));
        const normalized = rows.map(toNormalized);
        const analytics = analyticsEngine.compute(normalized);
        const top = analytics.byCategory.slice(0, 3);
        const potentialSaving = top.reduce(
          (s, c) => s + c.amount * 0.2,
          0
        );
        answer = `Based on your spending pattern, your top categories are: ${top.map((c) => `${c.category} (${fmt(c.amount)})`).join(", ")}. If you reduced each by 20%, you could potentially save ${fmt(potentialSaving)}/month — that's ${fmt(potentialSaving * 12)}/year.`;
        data = { topCategories: top, potentialSaving };
        break;
      }

      case "LARGEST_TRANSACTION": {
        const [row] = await db
          .select()
          .from(transactions)
          .where(and(...baseConditions))
          .orderBy(desc(transactions.amount))
          .limit(1);
        if (row) {
          answer = `Your largest transaction was ${fmt(parseFloat(String(row.amount)))} — "${row.description}" on ${new Date(row.date).toLocaleDateString("en-NG")}.`;
          data = { amount: parseFloat(String(row.amount)), description: row.description, date: row.date };
        } else {
          answer = "No transactions found in this period.";
        }
        break;
      }

      case "COMPARE_PERIODS": {
        const prevFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1);
        const prevTo = new Date(from.getFullYear(), from.getMonth(), 0);

        const [curr, prev] = await Promise.all([
          db.select().from(transactions).where(and(...baseConditions, eq(transactions.type, "debit"))),
          db.select().from(transactions).where(
            and(
              eq(transactions.userId, req.user!.userId),
              eq(transactions.isDuplicate, false),
              eq(transactions.type, "debit"),
              gte(transactions.date, prevFrom),
              lte(transactions.date, prevTo)
            )
          ),
        ]);

        const currTotal = curr.reduce((s, t) => s + parseFloat(String(t.amount)), 0);
        const prevTotal = prev.reduce((s, t) => s + parseFloat(String(t.amount)), 0);
        const change = prevTotal > 0 ? ((currTotal - prevTotal) / prevTotal) * 100 : 0;
        const dir = change > 0 ? "increased" : "decreased";

        answer = `This period spending: ${fmt(currTotal)}. Previous period: ${fmt(prevTotal)}. Spending ${dir} by ${Math.abs(Math.round(change))}%.`;
        data = { currTotal, prevTotal, changePercent: Math.round(change) };
        break;
      }

      default:
        answer =
          "I can answer questions like: 'How much did I spend on food?', 'How much did I send to Yuanna?', 'What are my subscriptions?', 'Compare this month with last month', or 'Where can I save money?'";
        data = { intent: "UNKNOWN", suggestions: true };
    }

    res.json({
      success: true,
      data: {
        question,
        answer,
        intent: intent.intent,
        context: data,
        period: {
          from: from.toISOString(),
          to: to.toISOString(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
