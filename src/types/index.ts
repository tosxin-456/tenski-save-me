// ─── Transaction Types ────────────────────────────────────────────────────────

export interface RawTransaction {
  date: string;
  time?: string;
  description: string;
  debit?: number;
  credit?: number;
  amount?: number;
  balance?: number;
  reference?: string;
  type?: "debit" | "credit" | "transfer";
}

export interface NormalizedTransaction {
  date: Date;
  time?: string;
  amount: number;
  currency: string;
  type: "debit" | "credit" | "transfer";
  description: string;
  rawDescription: string;
  rawDate?: string;
  rawAmount?: string;
  rawBalance?: string;
  balance?: number;
  reference?: string;
  merchant?: string;
  entity?: string;
  category?: string;
  subcategory?: string;
  confidence?: number;
  isRecurring?: boolean;
  isSubscription?: boolean;
  isBankCharge?: boolean;
  transactionHash?: string;
}

// ─── Classification ───────────────────────────────────────────────────────────

export interface ClassificationResult {
  category: string;
  subcategory?: string;
  merchant?: string;
  entity?: string;
  entityType?: "person" | "merchant" | "bank" | "government" | "utility" | "subscription" | "unknown";
  confidence: number;
  isRecurring?: boolean;
  isSubscription?: boolean;
  isBankCharge?: boolean;
  classifiedBy: "rule" | "ml" | "user";
}

export interface ClassificationPattern {
  pattern: RegExp | string;
  category: string;
  subcategory?: string;
  merchant?: string;
  entityType?: string;
  confidence: number;
  isSubscription?: boolean;
  isBankCharge?: boolean;
  isRecurring?: boolean;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface SpendingAnalytics {
  totalIncome: number;
  totalExpenditure: number;
  netCashFlow: number;
  savingsRate: number;
  avgDailySpending: number;
  avgWeeklySpending: number;
  avgMonthlySpending: number;
  largestTransaction: number;
  transactionCount: number;
  byCategory: CategoryBreakdown[];
  byMerchant: MerchantBreakdown[];
  byEntity: EntityBreakdown[];
  byDay: DayBreakdown[];
  byWeek: PeriodBreakdown[];
  byMonth: PeriodBreakdown[];
  recurringTotal: number;
  subscriptionTotal: number;
  bankChargesTotal: number;
}

export interface CategoryBreakdown {
  category: string;
  subcategory?: string;
  amount: number;
  count: number;
  percentage: number;
  icon?: string;
  color?: string;
  previousAmount?: number;
  changePercent?: number;
}

export interface MerchantBreakdown {
  merchant: string;
  amount: number;
  count: number;
  percentage: number;
  category?: string;
}

export interface EntityBreakdown {
  entity: string;
  entityId?: string;
  type?: string;
  totalSent: number;
  totalReceived: number;
  netAmount: number;
  count: number;
  averageAmount: number;
  largestTransaction: number;
}

export interface DayBreakdown {
  date: string;
  income: number;
  expenditure: number;
  count: number;
}

export interface PeriodBreakdown {
  period: string;
  income: number;
  expenditure: number;
  savings: number;
  count: number;
}

// ─── Extraction ────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  transactions: RawTransaction[];
  openingBalance?: number;
  closingBalance?: number;
  periodStart?: Date;
  periodEnd?: Date;
  currency?: string;
  accountNumber?: string;
  bankName?: string;
  warnings: string[];
  errors: string[];
}

// ─── Entity Resolution ────────────────────────────────────────────────────────

export interface ResolvedEntity {
  canonicalName: string;
  type: "person" | "merchant" | "bank" | "government" | "utility" | "subscription" | "unknown";
  aliases: string[];
  accountNumber?: string;
  confidence: number;
}

// ─── Subscription Detection ───────────────────────────────────────────────────

export interface DetectedSubscription {
  name: string;
  merchant: string;
  amount: number;
  currency: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  occurrences: Date[];
  firstSeen: Date;
  lastSeen: Date;
  nextExpected?: Date;
  confidence: number;
  category: string;
  subcategory?: string;
  annualCost: number;
}

// ─── NLQ / Assistant ─────────────────────────────────────────────────────────

export interface ParsedIntent {
  intent:
    | "TOTAL_SPENDING"
    | "CATEGORY_SPENDING"
    | "PERSON_SPENDING"
    | "MERCHANT_SPENDING"
    | "COMPARE_PERIODS"
    | "SUBSCRIPTION_LIST"
    | "SAVINGS_OPPORTUNITIES"
    | "LARGEST_TRANSACTION"
    | "INCOME_TOTAL"
    | "UNKNOWN";
  entity?: string;
  category?: string;
  merchant?: string;
  dateRange?: DateRange;
}

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

// ─── Insights ─────────────────────────────────────────────────────────────────

export interface GeneratedInsight {
  type: string;
  title: string;
  body: string;
  icon: string;
  severity: "info" | "warning" | "success" | "danger";
  data: Record<string, unknown>;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export interface GeneratedRecommendation {
  type: string;
  title: string;
  description: string;
  currentSpend: number;
  suggestedReduction: number;
  potentialSavingMonthly: number;
  potentialSavingAnnual: number;
  priority: number;
  data: Record<string, unknown>;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Express.Request {
  user?: JwtPayload;
}

// ─── Processing Job ───────────────────────────────────────────────────────────

export interface ProcessingJob {
  statementId: string;
  userId: string;
  fileId: string;
  filePath: string;
  fileType: string;
  accountId?: string;
}

export type Tone = "professional" | "friendly" | "minimal" | "genz" | "playful" | "brutally_honest";
