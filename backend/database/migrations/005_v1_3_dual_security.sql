-- Phase 2 Upgrade: Secure Dual-Phone Pairing
-- 1. Update session_participants table
-- Add participant_token_hash for secure resume
ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS participant_token_hash TEXT;

-- 2. Add Unique Constraint to prevent 3rd participant
-- Only one 'A' and one 'B' allowed per session
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'session_participants_role_unique'
  ) THEN
    ALTER TABLE session_participants
      ADD CONSTRAINT session_participants_role_unique UNIQUE (session_id, role);
  END IF;
END $$;

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_participant_token ON session_participants (participant_token_hash);
