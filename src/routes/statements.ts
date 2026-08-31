import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { db } from "../db";
import { statements, uploadedFiles, accounts, transactions } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { config } from "../config";
import { processStatement } from "../services/statementProcessor";

const router = Router();

// ─── Multer configuration ─────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = config.upload.uploadDir;
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxFileSizeMb * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!config.upload.allowedExtensions.includes(ext)) {
      cb(new AppError(400, `File type ${ext} is not supported. Supported types: PDF, XLSX, CSV, JPG, PNG`));
      return;
    }
    cb(null, true);
  },
});

// ─── GET /api/statements ──────────────────────────────────────────────────────

router.get("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userStatements = await db
      .select()
      .from(statements)
      .where(eq(statements.userId, req.user!.userId))
      .orderBy(desc(statements.createdAt));

    res.json({ success: true, data: userStatements });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/statements/upload ─────────────────────────────────────────────

router.post(
  "/upload",
  requireAuth,
  upload.single("file"),
  async (req: AuthRequest, res, next) => {
    if (!req.file) {
      return next(new AppError(400, "No file uploaded"));
    }

    try {
      const UploadSchema = z.object({
        accountId: z.string().uuid().optional(),
        accountName: z.string().max(200).optional(),
        bankName: z.string().max(200).optional(),
      });

      const body = UploadSchema.parse(req.body || {});

      // Calculate file checksum
      const fileBuffer = await fs.readFile(req.file.path);
      const checksum = crypto
        .createHash("sha256")
        .update(fileBuffer)
        .digest("hex");

      // Detect file type
      const ext = path.extname(req.file.originalname).toLowerCase().replace(".", "");
      const fileTypeMap: Record<string, string> = {
        pdf: "pdf",
        xlsx: "xlsx",
        xls: "xlsx",
        csv: "csv",
        jpg: "jpg",
        jpeg: "jpeg",
        png: "png",
      };
      const fileType = fileTypeMap[ext] || "pdf";

      // Create or use account
      let accountId = body.accountId;
      if (!accountId && (body.accountName || body.bankName)) {
        const [newAccount] = await db
          .insert(accounts)
          .values({
            userId: req.user!.userId,
            name: body.accountName || body.bankName || "My Account",
            bankName: body.bankName,
          })
          .returning({ id: accounts.id });
        accountId = newAccount.id;
      }

      // Record uploaded file
      const [uploadedFile] = await db
        .insert(uploadedFiles)
        .values({
          userId: req.user!.userId,
          originalName: req.file.originalname,
          storagePath: req.file.path,
          fileType: fileType as any,
          fileSizeBytes: req.file.size,
          mimeType: req.file.mimetype,
          checksum,
        })
        .returning({ id: uploadedFiles.id });

      // Create statement record
      const [statement] = await db
        .insert(statements)
        .values({
          userId: req.user!.userId,
          accountId: accountId || undefined,
          uploadedFileId: uploadedFile.id,
          status: "uploaded",
          currency: "NGN",
        })
        .returning();

      // Process asynchronously (don't block response)
      processStatement({
        statementId: statement.id,
        userId: req.user!.userId,
        fileId: uploadedFile.id,
        filePath: req.file.path,
        fileType,
        accountId,
      }).catch((err) => {
        console.error("Statement processing failed:", err);
      });

      res.status(201).json({
        success: true,
        data: {
          statement,
          message: "Statement uploaded successfully. Processing has begun.",
        },
      });
    } catch (err) {
      // Clean up uploaded file on error
      if (req.file) {
        fs.unlink(req.file.path).catch(() => {});
      }
      next(err);
    }
  }
);

// ─── GET /api/statements/:id ──────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [statement] = await db
      .select()
      .from(statements)
      .where(
        and(
          eq(statements.id, req.params.id),
          eq(statements.userId, req.user!.userId)
        )
      )
      .limit(1);

    if (!statement) {
      throw new AppError(404, "Statement not found");
    }

    res.json({ success: true, data: statement });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/statements/:id ───────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [statement] = await db
      .select()
      .from(statements)
      .where(
        and(
          eq(statements.id, req.params.id),
          eq(statements.userId, req.user!.userId)
        )
      )
      .limit(1);

    if (!statement) {
      throw new AppError(404, "Statement not found");
    }

    // Delete associated transactions
    await db
      .delete(transactions)
      .where(eq(transactions.statementId, req.params.id));

    // Delete statement
    await db
      .delete(statements)
      .where(eq(statements.id, req.params.id));

    res.json({ success: true, message: "Statement and associated transactions deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
