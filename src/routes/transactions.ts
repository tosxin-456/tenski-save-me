import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { transactions, categories, userCorrections, entities } from "../db/schema";
import { eq, and, desc, gte, lte, ilike, or, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const router = Router();

// ─── GET /api/transactions ────────────────────────────────────────────────────

router.get("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const QuerySchema = z.object({
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(500).default(50),
      search: z.string().optional(),
      category: z.string().optional(),
      type: z.enum(["debit", "credit", "transfer"]).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      accountId: z.string().uuid().optional(),
      statementId: z.string().uuid().optional(),
      minAmount: z.coerce.number().optional(),
      maxAmount: z.coerce.number().optional(),
      isRecurring: z.coerce.boolean().optional(),
      isSubscription: z.coerce.boolean().optional(),
    });

    const query = QuerySchema.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    const conditions = [
      eq(transactions.userId, req.user!.userId),
      eq(transactions.isDuplicate, false),
    ];

    if (query.search) {
      conditions.push(
        ilike(transactions.description, `%${query.search}%`)
      );
    }
    if (query.type) conditions.push(eq(transactions.type, query.type));
    if (query.from) conditions.push(gte(transactions.date, new Date(query.from)));
    if (query.to) conditions.push(lte(transactions.date, new Date(query.to)));
    if (query.accountId) conditions.push(eq(transactions.accountId, query.accountId));
    if (query.statementId) conditions.push(eq(transactions.statementId, query.statementId));
    if (query.isRecurring !== undefined) conditions.push(eq(transactions.isRecurring, query.isRecurring));
    if (query.isSubscription !== undefined) conditions.push(eq(transactions.isSubscription, query.isSubscription));

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(transactions)
        .where(and(...conditions))
        .orderBy(desc(transactions.date))
        .limit(query.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(and(...conditions)),
    ]);

    const total = Number(countResult[0]?.count || 0);

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/transactions/:id — update classification ─────────────────────

router.patch("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const UpdateSchema = z.object({
      categoryId: z.string().uuid().optional(),
      subcategory: z.string().max(100).optional(),
      merchant: z.string().max(300).optional(),
      entityId: z.string().uuid().optional(),
      isRecurring: z.boolean().optional(),
      isSubscription: z.boolean().optional(),
      applyToSimilar: z.boolean().optional().default(false),
    });

    const body = UpdateSchema.parse(req.body);

    // Ensure transaction belongs to user
    const [existing] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, req.params.id),
          eq(transactions.userId, req.user!.userId)
        )
      )
      .limit(1);

    if (!existing) {
      throw new AppError(404, "Transaction not found");
    }

    // Update transaction
    const { applyToSimilar, ...updateData } = body;
    const [updated] = await db
      .update(transactions)
      .set({ ...updateData, userVerified: true })
      .where(eq(transactions.id, req.params.id))
      .returning();

    // Store correction for ML training data
    await db.insert(userCorrections).values({
      userId: req.user!.userId,
      transactionId: req.params.id,
      rawDescription: existing.rawDescription,
      predictedCategory: existing.subcategory,
      correctedCategoryId: body.categoryId || undefined,
      correctedSubcategory: body.subcategory || undefined,
      correctedEntity: undefined,
      correctedMerchant: body.merchant || undefined,
      applyToSimilar: applyToSimilar || false,
    });

    // Apply correction to similar transactions if requested
    if (applyToSimilar && body.categoryId) {
      const descNorm = existing.description.toLowerCase().slice(0, 30);
      await db
        .update(transactions)
        .set({ categoryId: body.categoryId, subcategory: body.subcategory, userVerified: true })
        .where(
          and(
            eq(transactions.userId, req.user!.userId),
            ilike(transactions.description, `%${descNorm}%`)
          )
        );
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/transactions/categories ────────────────────────────────────────

router.get("/meta/categories", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const cats = await db
      .select()
      .from(categories)
      .where(
        or(
          eq(categories.isSystem, true),
          eq(categories.userId, req.user!.userId)
        )
      )
      .orderBy(categories.name);

    res.json({ success: true, data: cats });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/transactions/uncertain ─────────────────────────────────────────

router.get("/meta/uncertain", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const uncertain = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, req.user!.userId),
          eq(transactions.isUncertain, true),
          eq(transactions.userVerified, false)
        )
      )
      .orderBy(desc(transactions.amount))
      .limit(20);

    res.json({ success: true, data: uncertain });
  } catch (err) {
    next(err);
  }
});

export default router;
