-- Phase 1.2 Schema Upgrade

-- 1. Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Update sessions table
ALTER TABLE sessions 
  ADD COLUMN IF NOT EXISTS session_group_id UUID,
  ADD COLUMN IF NOT EXISTS pairing_code_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS pairing_expires_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS dual_status VARCHAR(20) CHECK (dual_status IN ('waiting', 'paired', 'ended')),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP DEFAULT NOW();

-- Backfill session_group_id
UPDATE sessions SET session_group_id = gen_random_uuid() WHERE session_group_id IS NULL;
ALTER TABLE sessions ALTER COLUMN session_group_id SET NOT NULL;

-- Indexes for sessions
CREATE INDEX IF NOT EXISTS idx_table_token ON sessions (table_token);
CREATE INDEX IF NOT EXISTS idx_expires_at ON sessions (expires_at);

-- 3. Create session_participants table
CREATE TABLE IF NOT EXISTS session_participants (
  participant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  role VARCHAR(1) CHECK (role IN ('A', 'B')),
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW(),
  disconnected_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_session_participant ON session_participants (session_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_last_seen ON session_participants (last_seen_at);

-- 4. Update deck_sessions table (Handle existing table from 001)
ALTER TABLE deck_sessions
  ADD COLUMN IF NOT EXISTS session_group_id UUID;

-- Backfill deck_sessions (generate random UUID for existing rows to avoid constraint violations, or delete them)
-- Since deck_sessions are transient/cache, deleting old ones is safe for MVP upgrade.
DELETE FROM deck_sessions WHERE session_group_id IS NULL;

ALTER TABLE deck_sessions ALTER COLUMN session_group_id SET NOT NULL;

-- Update Unique Constraint on deck_sessions
-- First drop old constraint if exists (name might vary, so we try to drop unique index or constraint)
-- Note: 001 created UNIQUE (restaurant_id, table_token, relationship_context, service_day)
-- We want UNIQUE (restaurant_id, table_token, relationship_context, service_day, session_group_id)

ALTER TABLE deck_sessions DROP CONSTRAINT IF EXISTS deck_sessions_restaurant_id_table_token_relationship_context__key;
ALTER TABLE deck_sessions DROP CONSTRAINT IF EXISTS deck_sessions_restaurant_id_table_token_relationship_contex_key;

-- Also try dropping by guessed name if standard naming wasn't used or explicit name wasn't given
-- In 001 it was: UNIQUE (restaurant_id, table_token, relationship_context, service_day)
-- Postgres usually names it deck_sessions_restaurant_id_table_token_relatio_key or similar.
-- A safe way is to ignore if we can't drop, but adding new unique constraint is fine.

ALTER TABLE deck_sessions DROP CONSTRAINT IF EXISTS deck_sessions_unique_group;

ALTER TABLE deck_sessions 
  ADD CONSTRAINT deck_sessions_unique_group 
  UNIQUE (restaurant_id, table_token, relationship_context, service_day, session_group_id);

-- 5. Ensure analytics_events table exists (Safety check)
CREATE TABLE IF NOT EXISTS analytics_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_session_id ON analytics_events(session_id);
