import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { generateToken, requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const router = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/register
router.post("/register", async (req, res, next) => {
  try {
    const body = RegisterSchema.parse(req.body);

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      throw new AppError(409, "An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const [user] = await db
      .insert(users)
      .values({
        email: body.email.toLowerCase(),
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
      })
      .returning({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        currency: users.currency,
        preferredTone: users.preferredTone,
        createdAt: users.createdAt,
      });

    const token = generateToken({ userId: user.id, email: user.email });

    res.status(201).json({
      success: true,
      data: { user, token },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const body = LoginSchema.parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);

    if (!user) {
      throw new AppError(401, "Invalid email or password");
    }

    if (user.deletedAt) {
      throw new AppError(401, "Account not found");
    }

    const passwordValid = await bcrypt.compare(body.password, user.passwordHash);
    if (!passwordValid) {
      throw new AppError(401, "Invalid email or password");
    }

    const token = generateToken({ userId: user.id, email: user.email });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          currency: user.currency,
          preferredTone: user.preferredTone,
          playfulLanguage: user.playfulLanguage,
        },
        token,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        currency: users.currency,
        preferredTone: users.preferredTone,
        playfulLanguage: users.playfulLanguage,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, req.user!.userId))
      .limit(1);

    if (!user) {
      throw new AppError(404, "User not found");
    }

    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/me
router.patch("/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const UpdateSchema = z.object({
      firstName: z.string().min(1).max(100).optional(),
      lastName: z.string().min(1).max(100).optional(),
      currency: z.string().max(10).optional(),
      preferredTone: z.enum(["professional", "friendly", "minimal", "genz", "playful", "brutally_honest"]).optional(),
      playfulLanguage: z.boolean().optional(),
    });

    const body = UpdateSchema.parse(req.body);

    const [updated] = await db
      .update(users)
      .set(body)
      .where(eq(users.id, req.user!.userId))
      .returning({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        currency: users.currency,
        preferredTone: users.preferredTone,
        playfulLanguage: users.playfulLanguage,
      });

    res.json({ success: true, data: { user: updated } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/account - delete all user data
router.delete("/account", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, req.user!.userId));

    res.json({ success: true, message: "Account scheduled for deletion. All data will be removed within 30 days." });
  } catch (err) {
    next(err);
  }
});

export default router;
