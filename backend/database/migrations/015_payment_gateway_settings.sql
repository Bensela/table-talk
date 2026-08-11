-- 015_payment_gateway_settings.sql
-- Idempotent upgrade: adds platform_settings so Stripe keys/webhook secret/frontend URL
-- and test/live mode toggles can be managed from the Super Admin portal without server restarts.
-- Existing process.env values always remain as fallbacks if a DB-set value is empty.

BEGIN;

CREATE TABLE IF NOT EXISTS platform_settings (
    setting_key     VARCHAR(128) PRIMARY KEY,
    setting_value   TEXT,
    value_kind      VARCHAR(32) NOT NULL DEFAULT 'string',
    is_secret       BOOLEAN NOT NULL DEFAULT FALSE,
    source          VARCHAR(32) NOT NULL DEFAULT 'db',
    updated_by      UUID,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_settings_source ON platform_settings(source);

-- Backfill default public/payment-gateway rows if missing (idempotent).
INSERT INTO platform_settings (setting_key, setting_value, value_kind, is_secret, source, updated_at)
VALUES
    ('payment_gateway.provider', 'stripe', 'string', FALSE, 'default', NOW())
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, value_kind, is_secret, source, updated_at)
VALUES
    ('payment_gateway.mode', 'live', 'string', FALSE, 'default', NOW())
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, value_kind, is_secret, source, updated_at)
VALUES
    ('payment_gateway.stripe_publishable_key', '', 'string', FALSE, 'default', NOW())
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, value_kind, is_secret, source, updated_at)
VALUES
    ('payment_gateway.stripe_secret_key', '', 'secret', TRUE, 'default', NOW())
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, value_kind, is_secret, source, updated_at)
VALUES
    ('payment_gateway.stripe_webhook_secret', '', 'secret', TRUE, 'default', NOW())
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value, value_kind, is_secret, source, updated_at)
VALUES
    ('payment_gateway.frontend_url', '', 'string', FALSE, 'default', NOW())
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
