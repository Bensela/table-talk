ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_password_reset_token_hash ON users(password_reset_token_hash);
