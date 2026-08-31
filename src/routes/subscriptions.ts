import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { subscriptions, subscriptionOccurrences } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const router = Router();

// GET /api/subscriptions
router.get("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const subs = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, req.user!.userId),
          eq(subscriptions.isActive, true)
        )
      )
      .orderBy(desc(subscriptions.amount));

    const totalMonthly = subs.reduce((s, sub) => {
      const amount = parseFloat(String(sub.amount));
      switch (sub.frequency) {
        case "daily": return s + amount * 30.44;
        case "weekly": return s + amount * 4.33;
        case "monthly": return s + amount;
        case "quarterly": return s + amount / 3;
        case "annual": return s + amount / 12;
        default: return s + amount;
      }
    }, 0);

    res.json({
      success: true,
      data: {
        subscriptions: subs,
        summary: {
          count: subs.length,
          totalMonthly: Math.round(totalMonthly),
          totalAnnual: Math.round(totalMonthly * 12),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/subscriptions — manually add a subscription
router.post("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const CreateSchema = z.object({
      name: z.string().min(1).max(200),
      amount: z.number().positive(),
      currency: z.string().default("NGN"),
      frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual"]).default("monthly"),
      subcategory: z.string().optional(),
      isActive: z.boolean().default(true),
    });

    const body = CreateSchema.parse(req.body);

    const [sub] = await db
      .insert(subscriptions)
      .values({
        userId: req.user!.userId,
        name: body.name,
        merchant: body.name,
        amount: String(body.amount),
        currency: body.currency,
        frequency: body.frequency,
        subcategory: body.subcategory,
        isActive: body.isActive,
        isUserAdded: true,
        isAutoDetected: false,
        confidence: "1",
      })
      .returning();

    res.status(201).json({ success: true, data: sub });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/subscriptions/:id
router.patch("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.id, req.params.id),
          eq(subscriptions.userId, req.user!.userId)
        )
      )
      .limit(1);

    if (!existing) throw new AppError(404, "Subscription not found");

    const UpdateSchema = z.object({
      name: z.string().max(200).optional(),
      amount: z.number().positive().optional(),
      frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual"]).optional(),
      isActive: z.boolean().optional(),
    });

    const body = UpdateSchema.parse(req.body);

    const [updated] = await db
      .update(subscriptions)
      .set({
        ...body,
        amount: body.amount ? String(body.amount) : undefined,
      })
      .where(eq(subscriptions.id, req.params.id))
      .returning();

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/subscriptions/:id
router.delete("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.id, req.params.id),
          eq(subscriptions.userId, req.user!.userId)
        )
      )
      .limit(1);

    if (!existing) throw new AppError(404, "Subscription not found");

    await db
      .update(subscriptions)
      .set({ isActive: false })
      .where(eq(subscriptions.id, req.params.id));

    res.json({ success: true, message: "Subscription deactivated" });
  } catch (err) {
    next(err);
  }
});

export default router;
