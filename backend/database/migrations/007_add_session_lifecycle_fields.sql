-- Phase 2/3 Upgrade: Session Lifecycle and Dual Groups
-- Add missing columns for the latest updates to session tracking and termination

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS dual_group_id UUID,
  ADD COLUMN IF NOT EXISTS fresh_intent_a BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fresh_intent_b BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fresh_intent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS dual_groups (
  dual_group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id VARCHAR(100) NOT NULL,
  table_token VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  terminated_at TIMESTAMP,
  active_context_id VARCHAR(64),
  active_session_id UUID REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_dual_group_id ON sessions (dual_group_id);
CREATE INDEX IF NOT EXISTS idx_dual_groups_table ON dual_groups (table_token, restaurant_id);