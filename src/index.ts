import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";

import { config } from "./config";
import { errorHandler, notFound } from "./middleware/errorHandler";

import authRouter from "./routes/auth";
import statementsRouter from "./routes/statements";
import transactionsRouter from "./routes/transactions";
import analyticsRouter from "./routes/analytics";
import subscriptionsRouter from "./routes/subscriptions";
import goalsRouter from "./routes/goals";
import assistantRouter from "./routes/assistant";
import accountsRouter from "./routes/accounts";

const app = express();

// ─── Ensure upload directory exists ───────────────────────────────────────────
if (!fs.existsSync(config.upload.uploadDir)) {
  fs.mkdirSync(config.upload.uploadDir, { recursive: true });
}

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: config.isDev
      ? [config.frontend.url, "http://localhost:3000", "http://localhost:3001"]
      : config.frontend.url,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { success: false, error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", limiter);

// Upload rate limit (stricter)
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { success: false, error: "Too many uploads, please wait before trying again." },
});

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    service: "Finance Intelligence Platform API",
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/statements", uploadLimiter, statementsRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/goals", goalsRouter);
app.use("/api/assistant", assistantRouter);

// ─── Demo data endpoint ───────────────────────────────────────────────────────
app.get("/api/demo/overview", (req, res) => {
  res.json({
    success: true,
    data: getDemoData(),
    isDemo: true,
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║  Finance Intelligence Platform API                ║
║  Running on http://localhost:${config.port}               ║
║  Environment: ${config.nodeEnv.padEnd(34)} ║
╚═══════════════════════════════════════════════════╝
  `);
});

// ─── Demo Data ────────────────────────────────────────────────────────────────
function getDemoData() {
  return {
    analytics: {
      totalIncome: 500000,
      totalExpenditure: 431200,
      netCashFlow: 68800,
      savingsRate: 13.76,
      avgDailySpending: 13909.68,
      avgWeeklySpending: 97363.78,
      avgMonthlySpending: 431200,
      largestTransaction: 85000,
      transactionCount: 127,
      bankChargesTotal: 3250,
      subscriptionTotal: 24500,
      recurringTotal: 32800,
      byCategory: [
        { category: "People", amount: 210000, count: 28, percentage: 48.7 },
        { category: "Food", amount: 82000, count: 41, percentage: 19.0 },
        { category: "Bills", amount: 54000, count: 18, percentage: 12.5 },
        { category: "Subscriptions", amount: 24500, count: 6, percentage: 5.7 },
        { category: "Transport", amount: 31200, count: 24, percentage: 7.2 },
        { category: "Shopping", amount: 18500, count: 8, percentage: 4.3 },
        { category: "Financial", amount: 7750, count: 5, percentage: 1.8 },
        { category: "Other", amount: 3250, count: 3, percentage: 0.8 },
      ],
      byEntity: [
        { entity: "Yuanna", totalSent: 85000, totalReceived: 20000, netAmount: -65000, count: 14, averageAmount: 6071.43, largestTransaction: 25000 },
        { entity: "Mum", totalSent: 60000, totalReceived: 0, netAmount: -60000, count: 4, averageAmount: 15000, largestTransaction: 20000 },
        { entity: "David", totalSent: 40000, totalReceived: 10000, netAmount: -30000, count: 6, averageAmount: 6666.67, largestTransaction: 15000 },
        { entity: "John", totalSent: 25000, totalReceived: 0, netAmount: -25000, count: 3, averageAmount: 8333.33, largestTransaction: 12000 },
      ],
      byMerchant: [
        { merchant: "MTN", amount: 18400, count: 9, percentage: 4.3, category: "Bills" },
        { merchant: "Uber", amount: 21500, count: 18, percentage: 5.0, category: "Transport" },
        { merchant: "Netflix", amount: 8000, count: 1, percentage: 1.9, category: "Subscriptions" },
        { merchant: "Shoprite", amount: 24200, count: 6, percentage: 5.6, category: "Food" },
        { merchant: "EKEDC", amount: 15000, count: 2, percentage: 3.5, category: "Bills" },
      ],
      byDay: [],
      byMonth: [
        { period: "2024-07", income: 500000, expenditure: 431200, savings: 68800, count: 127 },
      ],
      byWeek: [],
    },
    subscriptions: [
      { name: "Netflix", amount: 8000, frequency: "monthly", annualCost: 96000, subcategory: "Streaming", confidence: 0.99 },
      { name: "Spotify", amount: 4500, frequency: "monthly", annualCost: 54000, subcategory: "Music", confidence: 0.99 },
      { name: "Amazon Prime", amount: 12000, frequency: "monthly", annualCost: 144000, subcategory: "Streaming", confidence: 0.97 },
    ],
    moneyLeaks: [
      { category: "Mobile Data", currentAmount: 18400, previousAmount: 13939, changePercent: 32.0, potentialSavingMonthly: 4600, potentialSavingAnnual: 55200 },
      { category: "Restaurants", currentAmount: 42000, previousAmount: 33071, changePercent: 27.0, potentialSavingMonthly: 10500, potentialSavingAnnual: 126000 },
      { category: "Subscriptions", currentAmount: 24500, previousAmount: 16555, changePercent: 48.0, potentialSavingMonthly: 6125, potentialSavingAnnual: 73500 },
    ],
  };
}

export default app;
