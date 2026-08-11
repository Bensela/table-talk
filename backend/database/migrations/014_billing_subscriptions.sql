-- 014_billing_subscriptions.sql
-- Expands restaurants table for multi-tier billing (Trial, Starter, Premium, Enterprise)
-- and adds basic Stripe / manual billing audit tables.

BEGIN;

-- Ensure the `plan` column exists before we ALTER or reference it (fresh DBs may not have any prior plan column at all).
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS plan VARCHAR(32);

-- Expand plan enum on restaurants (legacy values 'free' / 'pro' / 'enterprise' still allowed).
DO $$
BEGIN
  -- Ensure CHECK constraint accepts new canonical tier values.
  IF EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  table_name = 'restaurants'
    AND    constraint_type = 'CHECK'
    AND    constraint_name LIKE '%restaurants_plan_check%'
  ) THEN
    ALTER TABLE restaurants DROP CONSTRAINT restaurants_plan_check;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE restaurants
  ALTER COLUMN plan TYPE VARCHAR(32),
  ALTER COLUMN plan SET DEFAULT 'starter';

ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_plan_check
  CHECK (plan IN ('free','pro','enterprise','trial','starter','premium'));

-- Default all existing rows to a safe canonical tier if not already set.
UPDATE restaurants
SET    plan = 'starter'
WHERE  plan IS NULL OR plan NOT IN ('trial','starter','premium','enterprise','free','pro');

ALTER TABLE restaurants
  ALTER COLUMN plan SET NOT NULL;

-- Lifecycle + billing fields (additive; existing code safe).
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS trial_started_by_super_admin_id UUID;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(64);

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(64);

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS stripe_default_payment_method_id VARCHAR(64);

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(64);

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS billing_provider VARCHAR(16) NOT NULL DEFAULT 'manual'
  CHECK (billing_provider IN ('stripe','manual'));

-- Feature limits (stored as integer capacity; NULL = unlimited).
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS max_tables INTEGER;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS max_monthly_sessions INTEGER;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS can_generate_qr BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS can_export_analytics BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS can_use_custom_qr_branding BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS can_use_dual_phone_sessions BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS can_access_support BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS support_tier VARCHAR(32) NOT NULL DEFAULT 'standard'
  CHECK (support_tier IN ('community','standard','priority','dedicated'));

-- Backfill entitlements for rows with no plan/limits set yet:
--   trial      -> Starter-like limits, but QR generation blocked until Super Admin manually seeds tables/QR (runtime policy overrides can_generate_qr)
--   starter    -> 20 tables, 5000 sessions/month, standard analytics export
--   premium    -> 200 tables, unlimited sessions, custom branding, priority support
--   enterprise -> unlimited, dedicated support
UPDATE restaurants
SET
  max_tables = CASE
    WHEN plan IN ('enterprise','pro') THEN NULL
    WHEN plan = 'premium'                    THEN 200
    WHEN plan IN ('starter','free')          THEN 20
    WHEN plan = 'trial'                      THEN 10
    ELSE 20
  END,
  max_monthly_sessions = CASE
    WHEN plan IN ('enterprise','premium','pro') THEN NULL
    WHEN plan IN ('starter','free')             THEN 5000
    WHEN plan = 'trial'                         THEN 300
    ELSE 5000
  END,
  can_generate_qr = CASE
    WHEN plan IN ('starter','premium','enterprise','pro','free') THEN TRUE
    ELSE FALSE -- Trial QRs are provisioned explicitly by Super Admin via API
  END,
  can_export_analytics = CASE
    WHEN plan IN ('starter','premium','enterprise','pro','free') THEN TRUE
    ELSE FALSE
  END,
  can_use_custom_qr_branding = CASE
    WHEN plan IN ('premium','enterprise','pro') THEN TRUE
    ELSE FALSE
  END,
  support_tier = CASE
    WHEN plan = 'enterprise' THEN 'dedicated'
    WHEN plan IN ('premium','pro') THEN 'priority'
    ELSE 'standard'
  END,
  can_use_dual_phone_sessions = TRUE,
  can_access_support = TRUE
WHERE
  max_tables IS NULL
  AND max_monthly_sessions IS NULL;

-- Ensure active rows with non-trial plan always have generate+export flags on.
UPDATE restaurants
SET can_generate_qr = TRUE,
    can_export_analytics = TRUE
WHERE billing_status = 'active'
  AND plan IN ('starter','premium','enterprise','pro','free')
  AND (NOT can_generate_qr OR NOT can_export_analytics);

-- ── Stripe event / invoice audit tables ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id        VARCHAR(96) PRIMARY KEY,
  event_type      VARCHAR(128) NOT NULL,
  restaurant_id   UUID REFERENCES restaurants(id) ON DELETE SET NULL,
  payload         JSONB NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_error TEXT
);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  invoice_id              VARCHAR(96) PRIMARY KEY,
  restaurant_id           UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  billing_provider        VARCHAR(16) NOT NULL CHECK (billing_provider IN ('stripe','manual')),
  provider_invoice_number VARCHAR(128),
  plan                    VARCHAR(32) NOT NULL,
  amount_cents            INTEGER NOT NULL,
  currency                VARCHAR(8) NOT NULL DEFAULT 'usd',
  status                  VARCHAR(32) NOT NULL CHECK (status IN ('draft','open','paid','void','uncollectible')),
  period_start            TIMESTAMPTZ,
  period_end              TIMESTAMPTZ,
  paid_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_restaurant_period
  ON subscription_invoices (restaurant_id, period_start DESC NULLS LAST);

-- Helpers: ensure existing trial-like pending rows keep billing_status='pending' unless
-- explicitly activated, but make their plan='trial' for consistency.
UPDATE restaurants
SET plan = 'trial'
WHERE billing_status = 'pending'
  AND plan NOT IN ('trial','starter','premium','enterprise');

-- Extend restaurant_tables to audit trial QR provisioning.
ALTER TABLE restaurant_tables
  ADD COLUMN IF NOT EXISTS provisioned_by_super_admin_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE restaurant_tables
  ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMIT;
