import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { accounts } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const router = Router();

router.get("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, req.user!.userId));

    res.json({ success: true, data: userAccounts });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const Schema = z.object({
      name: z.string().min(1).max(200),
      bankName: z.string().max(200).optional(),
      accountNumberMasked: z.string().max(50).optional(),
      currency: z.string().default("NGN"),
      color: z.string().max(20).optional(),
      isDefault: z.boolean().default(false),
    });

    const body = Schema.parse(req.body);

    const [account] = await db
      .insert(accounts)
      .values({ userId: req.user!.userId, ...body })
      .returning();

    res.status(201).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [existing] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.user!.userId)))
      .limit(1);

    if (!existing) throw new AppError(404, "Account not found");

    const Schema = z.object({
      name: z.string().max(200).optional(),
      bankName: z.string().max(200).optional(),
      color: z.string().max(20).optional(),
      isDefault: z.boolean().optional(),
    });

    const body = Schema.parse(req.body);
    const [updated] = await db
      .update(accounts)
      .set(body)
      .where(eq(accounts.id, req.params.id))
      .returning();

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await db.delete(accounts).where(
      and(eq(accounts.id, req.params.id), eq(accounts.userId, req.user!.userId))
    );
    res.json({ success: true, message: "Account deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
