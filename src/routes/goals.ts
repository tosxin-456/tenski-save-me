import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { savingsGoals } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const router = Router();

// GET /api/goals
router.get("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const goals = await db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.userId, req.user!.userId))
      .orderBy(savingsGoals.createdAt);

    res.json({ success: true, data: goals });
  } catch (err) {
    next(err);
  }
});

// POST /api/goals
router.post("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const CreateSchema = z.object({
      name: z.string().min(1).max(200),
      icon: z.string().max(10).optional(),
      targetAmount: z.number().positive(),
      currentAmount: z.number().min(0).default(0),
      currency: z.string().default("NGN"),
      targetDate: z.string().optional(),
      monthlyContribution: z.number().positive().optional(),
      notes: z.string().optional(),
    });

    const body = CreateSchema.parse(req.body);

    // Calculate estimated months to complete
    let estimatedMonths: number | undefined;
    if (body.monthlyContribution && body.monthlyContribution > 0) {
      const remaining = body.targetAmount - body.currentAmount;
      estimatedMonths = Math.ceil(remaining / body.monthlyContribution);
    }

    const [goal] = await db
      .insert(savingsGoals)
      .values({
        userId: req.user!.userId,
        name: body.name,
        icon: body.icon,
        targetAmount: String(body.targetAmount),
        currentAmount: String(body.currentAmount),
        currency: body.currency,
        targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
        monthlyContribution: body.monthlyContribution
          ? String(body.monthlyContribution)
          : undefined,
        estimatedMonthsToComplete: estimatedMonths,
        notes: body.notes,
      })
      .returning();

    res.status(201).json({ success: true, data: goal });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/goals/:id
router.patch("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [existing] = await db
      .select()
      .from(savingsGoals)
      .where(
        and(
          eq(savingsGoals.id, req.params.id),
          eq(savingsGoals.userId, req.user!.userId)
        )
      )
      .limit(1);

    if (!existing) throw new AppError(404, "Goal not found");

    const UpdateSchema = z.object({
      name: z.string().max(200).optional(),
      icon: z.string().max(10).optional(),
      targetAmount: z.number().positive().optional(),
      currentAmount: z.number().min(0).optional(),
      targetDate: z.string().optional(),
      status: z.enum(["active", "completed", "paused", "cancelled"]).optional(),
      monthlyContribution: z.number().positive().optional(),
      notes: z.string().optional(),
    });

    const body = UpdateSchema.parse(req.body);

    const targetAmount = body.targetAmount
      ? body.targetAmount
      : parseFloat(String(existing.targetAmount));
    const currentAmount = body.currentAmount !== undefined
      ? body.currentAmount
      : parseFloat(String(existing.currentAmount));
    const monthly = body.monthlyContribution
      ? body.monthlyContribution
      : existing.monthlyContribution
        ? parseFloat(String(existing.monthlyContribution))
        : undefined;

    let estimatedMonths: number | undefined;
    if (monthly && monthly > 0) {
      const remaining = targetAmount - currentAmount;
      estimatedMonths = Math.ceil(Math.max(remaining, 0) / monthly);
    }

    const [updated] = await db
      .update(savingsGoals)
      .set({
        name: body.name,
        icon: body.icon,
        targetAmount: body.targetAmount ? String(body.targetAmount) : undefined,
        currentAmount: body.currentAmount !== undefined ? String(body.currentAmount) : undefined,
        targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
        status: body.status,
        monthlyContribution: body.monthlyContribution ? String(body.monthlyContribution) : undefined,
        estimatedMonthsToComplete: estimatedMonths,
        notes: body.notes,
      })
      .where(eq(savingsGoals.id, req.params.id))
      .returning();

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/goals/:id
router.delete("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await db
      .delete(savingsGoals)
      .where(
        and(
          eq(savingsGoals.id, req.params.id),
          eq(savingsGoals.userId, req.user!.userId)
        )
      );

    res.json({ success: true, message: "Goal deleted" });
  } catch (err) {
    next(err);
  }
});

// POST /api/goals/what-if — savings calculator
router.post("/what-if", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const WhatIfSchema = z.object({
      currentMonthlyIncome: z.number().positive(),
      reductions: z.array(
        z.object({
          category: z.string(),
          currentAmount: z.number(),
          reductionPercent: z.number().min(0).max(100),
        })
      ),
      goalAmount: z.number().positive().optional(),
    });

    const body = WhatIfSchema.parse(req.body);

    const totalSavingMonthly = body.reductions.reduce((sum, r) => {
      return sum + (r.currentAmount * r.reductionPercent) / 100;
    }, 0);

    const totalSavingAnnual = totalSavingMonthly * 12;
    const monthsToGoal = body.goalAmount
      ? Math.ceil(body.goalAmount / totalSavingMonthly)
      : null;

    res.json({
      success: true,
      data: {
        potentialSavingMonthly: Math.round(totalSavingMonthly),
        potentialSavingAnnual: Math.round(totalSavingAnnual),
        monthsToGoal,
        breakdown: body.reductions.map((r) => ({
          category: r.category,
          currentAmount: r.currentAmount,
          savingAmount: Math.round((r.currentAmount * r.reductionPercent) / 100),
          reductionPercent: r.reductionPercent,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
