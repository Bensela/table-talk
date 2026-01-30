-- Phase 1 Schema Upgrade

-- 1. Upgrade SESSIONS table
ALTER TABLE sessions 
  ADD COLUMN IF NOT EXISTS table_token VARCHAR(100),
  ADD COLUMN IF NOT EXISTS restaurant_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS context VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE;

-- Update existing data to migrate table_id to table_token
UPDATE sessions SET table_token = table_id WHERE table_token IS NULL;

-- Update constraints
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_mode_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_mode_check CHECK (mode IN ('single', 'dual', 'single-phone', 'dual-phone'));

-- Add context check
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_context_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_context_check CHECK (context IN ('Exploring', 'Established', 'Mature'));

-- Create Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_table_token ON sessions(table_token);
CREATE INDEX IF NOT EXISTS idx_sessions_restaurant_id ON sessions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);


-- 2. Create DECK_SESSIONS table
CREATE TABLE IF NOT EXISTS deck_sessions (
  deck_context_id VARCHAR(64) PRIMARY KEY,
  restaurant_id VARCHAR(100),
  table_token VARCHAR(100),
  relationship_context VARCHAR(20),
  service_day DATE,
  seed VARCHAR(64),
  position_index INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (restaurant_id, table_token, relationship_context, service_day)
);


-- 3. Upgrade QUESTIONS table
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS question_type VARCHAR(20) DEFAULT 'open-ended',
  ADD COLUMN IF NOT EXISTS context VARCHAR(20),
  ADD COLUMN IF NOT EXISTS options JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Update constraints
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_question_type_check CHECK (question_type IN ('open-ended', 'multiple-choice'));

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_context_check;
ALTER TABLE questions ADD CONSTRAINT questions_context_check CHECK (context IN ('Exploring', 'Established', 'Mature'));

-- Create Index
CREATE INDEX IF NOT EXISTS idx_questions_context_active ON questions(context, active);

-- 4. Analytics Events (Ensure structure)
-- (Already exists, but ensuring indexes)
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics_events(timestamp);
