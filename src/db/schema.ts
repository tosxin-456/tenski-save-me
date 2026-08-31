import {
  pgTable,
  text,
  varchar,
  integer,
  bigint,
  numeric,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const transactionTypeEnum = pgEnum("transaction_type", [
  "debit",
  "credit",
  "transfer",
]);

export const statementStatusEnum = pgEnum("statement_status", [
  "uploaded",
  "processing",
  "extracted",
  "classified",
  "completed",
  "failed",
]);

export const entityTypeEnum = pgEnum("entity_type", [
  "person",
  "merchant",
  "bank",
  "government",
  "utility",
  "subscription",
  "unknown",
]);

export const goalStatusEnum = pgEnum("goal_status", [
  "active",
  "completed",
  "paused",
  "cancelled",
]);

export const toneEnum = pgEnum("tone", [
  "professional",
  "friendly",
  "minimal",
  "genz",
  "playful",
  "brutally_honest",
]);

export const fileTypeEnum = pgEnum("file_type", [
  "pdf",
  "xlsx",
  "csv",
  "jpg",
  "jpeg",
  "png",
  "scanned_pdf",
]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    currency: varchar("currency", { length: 10 }).notNull().default("NGN"),
    preferredTone: toneEnum("preferred_tone").notNull().default("friendly"),
    playfulLanguage: boolean("playful_language").notNull().default(true),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)]
);

// ─── Accounts ─────────────────────────────────────────────────────────────────

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    bankName: varchar("bank_name", { length: 200 }),
    accountNumberMasked: varchar("account_number_masked", { length: 50 }),
    currency: varchar("currency", { length: 10 }).notNull().default("NGN"),
    color: varchar("color", { length: 20 }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)]
);

// ─── Uploaded Files ────────────────────────────────────────────────────────────

export const uploadedFiles = pgTable(
  "uploaded_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    originalName: varchar("original_name", { length: 500 }).notNull(),
    storagePath: text("storage_path").notNull(),
    fileType: fileTypeEnum("file_type").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }),
    checksum: varchar("checksum", { length: 64 }),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("uploaded_files_user_id_idx").on(t.userId)]
);

// ─── Statements ───────────────────────────────────────────────────────────────

export const statements = pgTable(
  "statements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id),
    uploadedFileId: uuid("uploaded_file_id").references(() => uploadedFiles.id),
    status: statementStatusEnum("status").notNull().default("uploaded"),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }),
    closingBalance: numeric("closing_balance", { precision: 18, scale: 2 }),
    currency: varchar("currency", { length: 10 }).notNull().default("NGN"),
    transactionCount: integer("transaction_count").default(0),
    extractedCount: integer("extracted_count").default(0),
    balanceValidated: boolean("balance_validated"),
    validationNotes: text("validation_notes"),
    extractionWarnings: jsonb("extraction_warnings").default([]),
    processingError: text("processing_error"),
    processingStartedAt: timestamp("processing_started_at"),
    processingCompletedAt: timestamp("processing_completed_at"),
    rawMetadata: jsonb("raw_metadata").default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("statements_user_id_idx").on(t.userId),
    index("statements_account_id_idx").on(t.accountId),
    index("statements_status_idx").on(t.status),
  ]
);

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 100 }).notNull(),
    parentId: uuid("parent_id"),
    icon: varchar("icon", { length: 10 }),
    color: varchar("color", { length: 20 }),
    isSystem: boolean("is_system").notNull().default(false),
    isCustom: boolean("is_custom").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("categories_user_id_idx").on(t.userId),
    index("categories_parent_id_idx").on(t.parentId),
  ]
);

// ─── Entities ─────────────────────────────────────────────────────────────────

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canonicalName: varchar("canonical_name", { length: 300 }).notNull(),
    type: entityTypeEnum("type").notNull().default("unknown"),
    categoryId: uuid("category_id").references(() => categories.id),
    subcategory: varchar("subcategory", { length: 100 }),
    accountNumber: varchar("account_number", { length: 50 }),
    userNotes: text("user_notes"),
    userVerified: boolean("user_verified").notNull().default(false),
    totalSent: numeric("total_sent", { precision: 18, scale: 2 }).default("0"),
    totalReceived: numeric("total_received", {
      precision: 18,
      scale: 2,
    }).default("0"),
    transactionCount: integer("transaction_count").default(0),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("entities_user_id_idx").on(t.userId),
    index("entities_canonical_name_idx").on(t.canonicalName),
    index("entities_type_idx").on(t.type),
  ]
);

// ─── Entity Aliases ───────────────────────────────────────────────────────────

export const entityAliases = pgTable(
  "entity_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    alias: varchar("alias", { length: 300 }).notNull(),
    source: varchar("source", { length: 50 }).default("auto"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("entity_aliases_entity_id_idx").on(t.entityId),
    index("entity_aliases_user_id_idx").on(t.userId),
    index("entity_aliases_alias_idx").on(t.alias),
  ]
);

// ─── Transactions ─────────────────────────────────────────────────────────────

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id").references(() => statements.id),
    accountId: uuid("account_id").references(() => accounts.id),
    entityId: uuid("entity_id").references(() => entities.id),
    categoryId: uuid("category_id").references(() => categories.id),

    // Raw extracted data - never destroyed
    rawDescription: text("raw_description").notNull(),
    rawDate: varchar("raw_date", { length: 50 }),
    rawAmount: varchar("raw_amount", { length: 50 }),
    rawBalance: varchar("raw_balance", { length: 50 }),

    // Normalized fields
    date: timestamp("date").notNull(),
    time: varchar("time", { length: 20 }),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull().default("NGN"),
    type: transactionTypeEnum("type").notNull(),
    description: text("description").notNull(),
    balance: numeric("balance", { precision: 18, scale: 2 }),
    reference: varchar("reference", { length: 200 }),

    // Classification
    merchant: varchar("merchant", { length: 300 }),
    subcategory: varchar("subcategory", { length: 100 }),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).default(
      "0"
    ),
    classifiedBy: varchar("classified_by", { length: 50 }).default("rule"),

    // Flags
    isRecurring: boolean("is_recurring").notNull().default(false),
    isSubscription: boolean("is_subscription").notNull().default(false),
    isBankCharge: boolean("is_bank_charge").notNull().default(false),
    isDuplicate: boolean("is_duplicate").notNull().default(false),
    isUncertain: boolean("is_uncertain").notNull().default(false),
    userVerified: boolean("user_verified").notNull().default(false),

    // Deduplication
    transactionHash: varchar("transaction_hash", { length: 64 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("transactions_user_id_idx").on(t.userId),
    index("transactions_statement_id_idx").on(t.statementId),
    index("transactions_account_id_idx").on(t.accountId),
    index("transactions_date_idx").on(t.date),
    index("transactions_category_id_idx").on(t.categoryId),
    index("transactions_entity_id_idx").on(t.entityId),
    index("transactions_merchant_idx").on(t.merchant),
    index("transactions_type_idx").on(t.type),
    index("transactions_hash_idx").on(t.transactionHash),
  ]
);

// ─── Subscriptions ────────────────────────────────────────────────────────────

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id").references(() => entities.id),
    categoryId: uuid("category_id").references(() => categories.id),

    name: varchar("name", { length: 200 }).notNull(),
    merchant: varchar("merchant", { length: 200 }),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull().default("NGN"),
    frequency: varchar("frequency", { length: 50 }).notNull().default("monthly"),
    subcategory: varchar("subcategory", { length: 100 }),

    isActive: boolean("is_active").notNull().default(true),
    isAutoDetected: boolean("is_auto_detected").notNull().default(true),
    isUserAdded: boolean("is_user_added").notNull().default(false),

    firstSeenAt: timestamp("first_seen_at"),
    lastSeenAt: timestamp("last_seen_at"),
    nextExpectedAt: timestamp("next_expected_at"),

    confidence: numeric("confidence", { precision: 5, scale: 4 }).default("0"),
    occurrenceCount: integer("occurrence_count").default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_user_id_idx").on(t.userId),
    index("subscriptions_entity_id_idx").on(t.entityId),
  ]
);

// ─── Subscription Occurrences ─────────────────────────────────────────────────

export const subscriptionOccurrences = pgTable(
  "subscription_occurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: timestamp("date").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("sub_occurrences_sub_id_idx").on(t.subscriptionId),
    index("sub_occurrences_user_id_idx").on(t.userId),
  ]
);

// ─── Financial Insights ───────────────────────────────────────────────────────

export const financialInsights = pgTable(
  "financial_insights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 100 }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    icon: varchar("icon", { length: 10 }),
    severity: varchar("severity", { length: 20 }).default("info"),
    data: jsonb("data").default({}),
    isRead: boolean("is_read").notNull().default(false),
    isDismissed: boolean("is_dismissed").notNull().default(false),
    generatedFor: timestamp("generated_for"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("insights_user_id_idx").on(t.userId),
    index("insights_type_idx").on(t.type),
    index("insights_created_at_idx").on(t.createdAt),
  ]
);

// ─── Recommendations ──────────────────────────────────────────────────────────

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id),
    type: varchar("type", { length: 100 }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    currentSpend: numeric("current_spend", { precision: 18, scale: 2 }),
    suggestedReduction: numeric("suggested_reduction", {
      precision: 5,
      scale: 4,
    }),
    potentialSavingMonthly: numeric("potential_saving_monthly", {
      precision: 18,
      scale: 2,
    }),
    potentialSavingAnnual: numeric("potential_saving_annual", {
      precision: 18,
      scale: 2,
    }),
    isActedOn: boolean("is_acted_on").notNull().default(false),
    isDismissed: boolean("is_dismissed").notNull().default(false),
    priority: integer("priority").default(5),
    data: jsonb("data").default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    index("recommendations_user_id_idx").on(t.userId),
    index("recommendations_type_idx").on(t.type),
  ]
);

// ─── Savings Goals ────────────────────────────────────────────────────────────

export const savingsGoals = pgTable(
  "savings_goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    icon: varchar("icon", { length: 10 }),
    targetAmount: numeric("target_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    currentAmount: numeric("current_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    currency: varchar("currency", { length: 10 }).notNull().default("NGN"),
    targetDate: timestamp("target_date"),
    status: goalStatusEnum("status").notNull().default("active"),
    monthlyContribution: numeric("monthly_contribution", {
      precision: 18,
      scale: 2,
    }),
    estimatedMonthsToComplete: integer("estimated_months_to_complete"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("goals_user_id_idx").on(t.userId)]
);

// ─── User Corrections ─────────────────────────────────────────────────────────

export const userCorrections = pgTable(
  "user_corrections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    rawDescription: text("raw_description").notNull(),
    predictedCategory: varchar("predicted_category", { length: 100 }),
    predictedSubcategory: varchar("predicted_subcategory", { length: 100 }),
    predictedEntity: varchar("predicted_entity", { length: 300 }),
    predictedMerchant: varchar("predicted_merchant", { length: 300 }),
    correctedCategoryId: uuid("corrected_category_id").references(
      () => categories.id
    ),
    correctedSubcategory: varchar("corrected_subcategory", { length: 100 }),
    correctedEntity: varchar("corrected_entity", { length: 300 }),
    correctedMerchant: varchar("corrected_merchant", { length: 300 }),
    applyToSimilar: boolean("apply_to_similar").notNull().default(false),
    isTrainingData: boolean("is_training_data").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("corrections_user_id_idx").on(t.userId),
    index("corrections_transaction_id_idx").on(t.transactionId),
  ]
);

// ─── Model Predictions ────────────────────────────────────────────────────────

export const modelPredictions = pgTable(
  "model_predictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modelName: varchar("model_name", { length: 100 }).notNull(),
    modelVersion: varchar("model_version", { length: 50 }),
    inputText: text("input_text").notNull(),
    predictedCategory: varchar("predicted_category", { length: 100 }),
    predictedSubcategory: varchar("predicted_subcategory", { length: 100 }),
    predictedEntity: varchar("predicted_entity", { length: 300 }),
    predictedMerchant: varchar("predicted_merchant", { length: 300 }),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    rawOutput: jsonb("raw_output").default({}),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("predictions_transaction_id_idx").on(t.transactionId),
    index("predictions_user_id_idx").on(t.userId),
  ]
);

// ─── Unknown Accounts ─────────────────────────────────────────────────────────

export const unknownAccounts = pgTable(
  "unknown_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountNumber: varchar("account_number", { length: 50 }).notNull(),
    totalSent: numeric("total_sent", { precision: 18, scale: 2 }).default("0"),
    totalReceived: numeric("total_received", {
      precision: 18,
      scale: 2,
    }).default("0"),
    transactionCount: integer("transaction_count").default(0),
    resolvedEntityId: uuid("resolved_entity_id").references(() => entities.id),
    resolvedLabel: varchar("resolved_label", { length: 200 }),
    resolvedCategory: varchar("resolved_category", { length: 100 }),
    isResolved: boolean("is_resolved").notNull().default(false),
    askedUser: boolean("asked_user").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("unknown_accounts_user_id_idx").on(t.userId),
    uniqueIndex("unknown_accounts_user_account_idx").on(
      t.userId,
      t.accountNumber
    ),
  ]
);

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 100 }),
    resourceId: uuid("resource_id"),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_user_id_idx").on(t.userId),
    index("audit_logs_created_at_idx").on(t.createdAt),
    index("audit_logs_action_idx").on(t.action),
  ]
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  statements: many(statements),
  transactions: many(transactions),
  entities: many(entities),
  subscriptions: many(subscriptions),
  savingsGoals: many(savingsGoals),
  userCorrections: many(userCorrections),
  financialInsights: many(financialInsights),
  recommendations: many(recommendations),
  unknownAccounts: many(unknownAccounts),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
  statements: many(statements),
  transactions: many(transactions),
}));

export const statementsRelations = relations(statements, ({ one, many }) => ({
  user: one(users, { fields: [statements.userId], references: [users.id] }),
  account: one(accounts, {
    fields: [statements.accountId],
    references: [accounts.id],
  }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
  statement: one(statements, {
    fields: [transactions.statementId],
    references: [statements.id],
  }),
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  entity: one(entities, {
    fields: [transactions.entityId],
    references: [entities.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  user: one(users, { fields: [entities.userId], references: [users.id] }),
  aliases: many(entityAliases),
  transactions: many(transactions),
  category: one(categories, {
    fields: [entities.categoryId],
    references: [categories.id],
  }),
}));

export const subscriptionsRelations = relations(
  subscriptions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [subscriptions.userId],
      references: [users.id],
    }),
    occurrences: many(subscriptionOccurrences),
  })
);
