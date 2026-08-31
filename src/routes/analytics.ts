import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { transactions } from "../db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { analyticsEngine } from "../services/analytics/engine";
import { insightsGenerator } from "../services/analytics/insights";
import { recommendationEngine } from "../services/analytics/recommendations";
import type { NormalizedTransaction } from "../types";

const router = Router();

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
    confidence: row.confidence ? parseFloat(String(row.confidence)) : undefined,
    isRecurring: row.isRecurring,
    isSubscription: row.isSubscription,
    isBankCharge: row.isBankCharge,
    isDuplicate: row.isDuplicate,
  };
}

// ─── GET /api/analytics/overview ─────────────────────────────────────────────

router.get("/overview", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const QuerySchema = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      accountId: z.string().uuid().optional(),
    });

    const query = QuerySchema.parse(req.query);

    const conditions = [
      eq(transactions.userId, req.user!.userId),
      eq(transactions.isDuplicate, false),
    ];

    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? new Date(query.to) : now;

    conditions.push(gte(transactions.date, from));
    conditions.push(lte(transactions.date, to));
    if (query.accountId) conditions.push(eq(transactions.accountId, query.accountId));

    const rows = await db
      .select()
      .from(transactions)
      .where(and(...conditions));

    // Previous period (same length, before current period)
    const periodLength = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - periodLength);
    const prevTo = new Date(from.getTime() - 1);

    const prevRows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, req.user!.userId),
          eq(transactions.isDuplicate, false),
          gte(transactions.date, prevFrom),
          lte(transactions.date, prevTo)
        )
      );

    const normalized = rows.map(toNormalized);
    const prevNormalized = prevRows.map(toNormalized);

    const analytics = analyticsEngine.compute(normalized);
    const comparison = analyticsEngine.compareMonths(normalized, prevNormalized);
    const moneyLeaks = analyticsEngine.detectMoneyLeaks(normalized, prevNormalized);

    res.json({
      success: true,
      data: {
        analytics,
        comparison,
        moneyLeaks,
        period: { from: from.toISOString(), to: to.toISOString() },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/analytics/insights ─────────────────────────────────────────────

router.get("/insights", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const QuerySchema = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
    });

    const query = QuerySchema.parse(req.query);
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? new Date(query.to) : now;

    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, req.user!.userId),
          eq(transactions.isDuplicate, false),
          gte(transactions.date, from),
          lte(transactions.date, to)
        )
      );

    const normalized = rows.map(toNormalized);
    const analytics = analyticsEngine.compute(normalized);
    const insights = insightsGenerator.generate(normalized, analytics);

    res.json({ success: true, data: insights });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/analytics/recommendations ──────────────────────────────────────

router.get("/recommendations", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);

    const [current, previous] = await Promise.all([
      db.select().from(transactions).where(
        and(
          eq(transactions.userId, req.user!.userId),
          eq(transactions.isDuplicate, false),
          gte(transactions.date, from)
        )
      ),
      db.select().from(transactions).where(
        and(
          eq(transactions.userId, req.user!.userId),
          eq(transactions.isDuplicate, false),
          gte(transactions.date, new Date(now.getFullYear(), now.getMonth() - 1, 1)),
          lte(transactions.date, new Date(now.getFullYear(), now.getMonth(), 0))
        )
      ),
    ]);

    const currentN = current.map(toNormalized);
    const previousN = previous.map(toNormalized);
    const analytics = analyticsEngine.compute(currentN);
    const subTotal = currentN
      .filter((t) => t.isSubscription && t.type === "debit")
      .reduce((s, t) => s + t.amount, 0);

    const recs = recommendationEngine.generate(currentN, previousN, analytics, subTotal);

    res.json({ success: true, data: recs });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/analytics/people ────────────────────────────────────────────────

router.get("/people", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const now = new Date();
    const QuerySchema = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
    });

    const query = QuerySchema.parse(req.query);
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), 0, 1);
    const to = query.to ? new Date(query.to) : now;

    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, req.user!.userId),
          eq(transactions.isDuplicate, false),
          gte(transactions.date, from),
          lte(transactions.date, to)
        )
      );

    const normalized = rows.map(toNormalized);
    const analytics = analyticsEngine.compute(normalized);

    res.json({ success: true, data: analytics.byEntity });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/analytics/money-leaks ──────────────────────────────────────────

router.get("/money-leaks", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const now = new Date();
    const currentFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevTo = new Date(now.getFullYear(), now.getMonth(), 0);

    const [current, previous] = await Promise.all([
      db.select().from(transactions).where(
        and(
          eq(transactions.userId, req.user!.userId),
          eq(transactions.isDuplicate, false),
          gte(transactions.date, currentFrom)
        )
      ),
      db.select().from(transactions).where(
        and(
          eq(transactions.userId, req.user!.userId),
          eq(transactions.isDuplicate, false),
          gte(transactions.date, prevFrom),
          lte(transactions.date, prevTo)
        )
      ),
    ]);

    const leaks = analyticsEngine.detectMoneyLeaks(
      current.map(toNormalized),
      previous.map(toNormalized)
    );

    res.json({ success: true, data: leaks });
  } catch (err) {
    next(err);
  }
});

export default router;
