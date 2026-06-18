-- Migration: Invite-based restaurant onboarding

CREATE TABLE IF NOT EXISTS restaurant_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  invite_email VARCHAR(255) NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_restaurant_invites_restaurant_id
  ON restaurant_invites (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_restaurant_invites_email
  ON restaurant_invites (invite_email);

CREATE INDEX IF NOT EXISTS idx_restaurant_invites_active_lookup
  ON restaurant_invites (token_hash, expires_at, consumed_at);
