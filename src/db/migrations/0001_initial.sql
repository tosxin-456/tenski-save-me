-- Finance Intelligence Platform - Initial Schema
-- Run this on your Neon PostgreSQL database

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('debit', 'credit', 'transfer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE statement_status AS ENUM ('uploaded', 'processing', 'extracted', 'classified', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE entity_type AS ENUM ('person', 'merchant', 'bank', 'government', 'utility', 'subscription', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE goal_status AS ENUM ('active', 'completed', 'paused', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE tone AS ENUM ('professional', 'friendly', 'minimal', 'genz', 'playful', 'brutally_honest');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE file_type AS ENUM ('pdf', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'scanned_pdf');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  preferred_tone tone NOT NULL DEFAULT 'friendly',
  playful_language BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);

-- ─── Accounts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  bank_name VARCHAR(200),
  account_number_masked VARCHAR(50),
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  color VARCHAR(20),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);

-- ─── Uploaded Files ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name VARCHAR(500) NOT NULL,
  storage_path TEXT NOT NULL,
  file_type file_type NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  mime_type VARCHAR(100),
  checksum VARCHAR(64),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS uploaded_files_user_id_idx ON uploaded_files(user_id);

-- ─── Statements ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id),
  uploaded_file_id UUID REFERENCES uploaded_files(id),
  status statement_status NOT NULL DEFAULT 'uploaded',
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  opening_balance NUMERIC(18,2),
  closing_balance NUMERIC(18,2),
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  transaction_count INTEGER DEFAULT 0,
  extracted_count INTEGER DEFAULT 0,
  balance_validated BOOLEAN,
  validation_notes TEXT,
  extraction_warnings JSONB DEFAULT '[]',
  processing_error TEXT,
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  raw_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS statements_user_id_idx ON statements(user_id);
CREATE INDEX IF NOT EXISTS statements_account_id_idx ON statements(account_id);
CREATE INDEX IF NOT EXISTS statements_status_idx ON statements(status);

-- ─── Categories ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  parent_id UUID,
  icon VARCHAR(10),
  color VARCHAR(20),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS categories_user_id_idx ON categories(user_id);
CREATE INDEX IF NOT EXISTS categories_parent_id_idx ON categories(parent_id);

-- ─── Entities ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_name VARCHAR(300) NOT NULL,
  type entity_type NOT NULL DEFAULT 'unknown',
  category_id UUID REFERENCES categories(id),
  subcategory VARCHAR(100),
  account_number VARCHAR(50),
  user_notes TEXT,
  user_verified BOOLEAN NOT NULL DEFAULT FALSE,
  total_sent NUMERIC(18,2) DEFAULT 0,
  total_received NUMERIC(18,2) DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entities_user_id_idx ON entities(user_id);
CREATE INDEX IF NOT EXISTS entities_canonical_name_idx ON entities(canonical_name);
CREATE INDEX IF NOT EXISTS entities_type_idx ON entities(type);

-- ─── Entity Aliases ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias VARCHAR(300) NOT NULL,
  source VARCHAR(50) DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_aliases_entity_id_idx ON entity_aliases(entity_id);
CREATE INDEX IF NOT EXISTS entity_aliases_user_id_idx ON entity_aliases(user_id);
CREATE INDEX IF NOT EXISTS entity_aliases_alias_idx ON entity_aliases(alias);

-- ─── Transactions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statement_id UUID REFERENCES statements(id),
  account_id UUID REFERENCES accounts(id),
  entity_id UUID REFERENCES entities(id),
  category_id UUID REFERENCES categories(id),

  -- Raw extracted data preserved forever
  raw_description TEXT NOT NULL,
  raw_date VARCHAR(50),
  raw_amount VARCHAR(50),
  raw_balance VARCHAR(50),

  -- Normalized
  date TIMESTAMPTZ NOT NULL,
  time VARCHAR(20),
  amount NUMERIC(18,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  type transaction_type NOT NULL,
  description TEXT NOT NULL,
  balance NUMERIC(18,2),
  reference VARCHAR(200),

  -- Classification
  merchant VARCHAR(300),
  subcategory VARCHAR(100),
  confidence NUMERIC(5,4) DEFAULT 0,
  classified_by VARCHAR(50) DEFAULT 'rule',

  -- Flags
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  is_subscription BOOLEAN NOT NULL DEFAULT FALSE,
  is_bank_charge BOOLEAN NOT NULL DEFAULT FALSE,
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  is_uncertain BOOLEAN NOT NULL DEFAULT FALSE,
  user_verified BOOLEAN NOT NULL DEFAULT FALSE,

  -- Deduplication
  transaction_hash VARCHAR(64),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_user_id_idx ON transactions(user_id);
CREATE INDEX IF NOT EXISTS transactions_statement_id_idx ON transactions(statement_id);
CREATE INDEX IF NOT EXISTS transactions_account_id_idx ON transactions(account_id);
CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date);
CREATE INDEX IF NOT EXISTS transactions_category_id_idx ON transactions(category_id);
CREATE INDEX IF NOT EXISTS transactions_entity_id_idx ON transactions(entity_id);
CREATE INDEX IF NOT EXISTS transactions_merchant_idx ON transactions(merchant);
CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions(type);
CREATE INDEX IF NOT EXISTS transactions_hash_idx ON transactions(transaction_hash);

-- ─── Subscriptions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id),
  category_id UUID REFERENCES categories(id),
  name VARCHAR(200) NOT NULL,
  merchant VARCHAR(200),
  amount NUMERIC(18,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  frequency VARCHAR(50) NOT NULL DEFAULT 'monthly',
  subcategory VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_auto_detected BOOLEAN NOT NULL DEFAULT TRUE,
  is_user_added BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  next_expected_at TIMESTAMPTZ,
  confidence NUMERIC(5,4) DEFAULT 0,
  occurrence_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS subscriptions_entity_id_idx ON subscriptions(entity_id);

-- ─── Subscription Occurrences ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sub_occurrences_sub_id_idx ON subscription_occurrences(subscription_id);
CREATE INDEX IF NOT EXISTS sub_occurrences_user_id_idx ON subscription_occurrences(user_id);

-- ─── Financial Insights ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  icon VARCHAR(10),
  severity VARCHAR(20) DEFAULT 'info',
  data JSONB DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  generated_for TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS insights_user_id_idx ON financial_insights(user_id);
CREATE INDEX IF NOT EXISTS insights_type_idx ON financial_insights(type);
CREATE INDEX IF NOT EXISTS insights_created_at_idx ON financial_insights(created_at);

-- ─── Recommendations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id),
  type VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  current_spend NUMERIC(18,2),
  suggested_reduction NUMERIC(5,4),
  potential_saving_monthly NUMERIC(18,2),
  potential_saving_annual NUMERIC(18,2),
  is_acted_on BOOLEAN NOT NULL DEFAULT FALSE,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER DEFAULT 5,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS recommendations_user_id_idx ON recommendations(user_id);
CREATE INDEX IF NOT EXISTS recommendations_type_idx ON recommendations(type);

-- ─── Savings Goals ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  icon VARCHAR(10),
  target_amount NUMERIC(18,2) NOT NULL,
  current_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  target_date TIMESTAMPTZ,
  status goal_status NOT NULL DEFAULT 'active',
  monthly_contribution NUMERIC(18,2),
  estimated_months_to_complete INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS goals_user_id_idx ON savings_goals(user_id);

-- ─── User Corrections ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id),
  raw_description TEXT NOT NULL,
  predicted_category VARCHAR(100),
  predicted_subcategory VARCHAR(100),
  predicted_entity VARCHAR(300),
  predicted_merchant VARCHAR(300),
  corrected_category_id UUID REFERENCES categories(id),
  corrected_subcategory VARCHAR(100),
  corrected_entity VARCHAR(300),
  corrected_merchant VARCHAR(300),
  apply_to_similar BOOLEAN NOT NULL DEFAULT FALSE,
  is_training_data BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS corrections_user_id_idx ON user_corrections(user_id);
CREATE INDEX IF NOT EXISTS corrections_transaction_id_idx ON user_corrections(transaction_id);

-- ─── Model Predictions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(50),
  input_text TEXT NOT NULL,
  predicted_category VARCHAR(100),
  predicted_subcategory VARCHAR(100),
  predicted_entity VARCHAR(300),
  predicted_merchant VARCHAR(300),
  confidence NUMERIC(5,4),
  raw_output JSONB DEFAULT '{}',
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS predictions_transaction_id_idx ON model_predictions(transaction_id);
CREATE INDEX IF NOT EXISTS predictions_user_id_idx ON model_predictions(user_id);

-- ─── Unknown Accounts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unknown_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_number VARCHAR(50) NOT NULL,
  total_sent NUMERIC(18,2) DEFAULT 0,
  total_received NUMERIC(18,2) DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,
  resolved_entity_id UUID REFERENCES entities(id),
  resolved_label VARCHAR(200),
  resolved_category VARCHAR(100),
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  asked_user BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS unknown_accounts_user_id_idx ON unknown_accounts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS unknown_accounts_user_account_idx ON unknown_accounts(user_id, account_number);

-- ─── Audit Logs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100),
  resource_id UUID,
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);

-- ─── System Categories Seed ───────────────────────────────────────────────────
INSERT INTO categories (id, name, parent_id, icon, color, is_system) VALUES
  -- Parent categories
  (gen_random_uuid(), 'Income', NULL, '💰', '#22c55e', TRUE),
  (gen_random_uuid(), 'Food', NULL, '🍔', '#f97316', TRUE),
  (gen_random_uuid(), 'Bills', NULL, '📄', '#6366f1', TRUE),
  (gen_random_uuid(), 'Transport', NULL, '🚗', '#3b82f6', TRUE),
  (gen_random_uuid(), 'Shopping', NULL, '🛍️', '#ec4899', TRUE),
  (gen_random_uuid(), 'People', NULL, '👥', '#8b5cf6', TRUE),
  (gen_random_uuid(), 'Housing', NULL, '🏠', '#14b8a6', TRUE),
  (gen_random_uuid(), 'Entertainment', NULL, '🎬', '#f59e0b', TRUE),
  (gen_random_uuid(), 'Financial', NULL, '🏦', '#64748b', TRUE),
  (gen_random_uuid(), 'Subscriptions', NULL, '🔄', '#a855f7', TRUE),
  (gen_random_uuid(), 'Health', NULL, '💊', '#ef4444', TRUE),
  (gen_random_uuid(), 'Education', NULL, '📚', '#0ea5e9', TRUE),
  (gen_random_uuid(), 'Savings', NULL, '🏦', '#10b981', TRUE),
  (gen_random_uuid(), 'Other', NULL, '📦', '#94a3b8', TRUE)
ON CONFLICT DO NOTHING;

-- ─── Trigger: update updated_at ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['users', 'accounts', 'statements', 'entities', 'transactions', 'subscriptions', 'savings_goals', 'unknown_accounts']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      tbl, tbl
    );
  END LOOP;
END $$;
