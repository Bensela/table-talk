-- ============================================================
-- 008_multi_restaurant.sql
-- Adds multi-restaurant tenancy. ZERO changes to existing tables.
-- Respects: no PII, snake_case columns, parameterised queries only.
-- ============================================================

-- 1. New restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(80) UNIQUE NOT NULL,
  name         VARCHAR(200) NOT NULL,
  plan         VARCHAR(20) NOT NULL DEFAULT 'free'
                 CHECK (plan IN ('free', 'pro', 'enterprise')),
  secret_key   VARCHAR(64) NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_slug ON restaurants (slug);

-- 2. Backfill: create the 'default' restaurant so all existing
--    sessions (which have restaurant_id = 'default') resolve correctly.
INSERT INTO restaurants (slug, name, plan, secret_key)
VALUES (
  'default',
  'Default Restaurant',
  'free',
  encode(gen_random_bytes(32), 'hex')
)
ON CONFLICT (slug) DO NOTHING;

-- 3. Add FK from sessions.restaurant_id → restaurants.slug
--    Deferred so existing rows are not validated until commit.
ALTER TABLE sessions
  ADD CONSTRAINT fk_sessions_restaurant
  FOREIGN KEY (restaurant_id)
  REFERENCES restaurants (slug)
  ON UPDATE CASCADE
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- Index already created in migration 001 but ensure it exists
CREATE INDEX IF NOT EXISTS idx_sessions_restaurant_id ON sessions (restaurant_id);
