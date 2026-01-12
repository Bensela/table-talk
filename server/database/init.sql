CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS sessions (
  session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id VARCHAR(255) NOT NULL,
  mode VARCHAR(20) CHECK (mode IN ('single', 'dual')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  current_question_index INTEGER DEFAULT 0,
  deck_seed VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_sessions_table_id ON sessions(table_id);

CREATE TABLE IF NOT EXISTS questions (
  question_id SERIAL PRIMARY KEY,
  question_text TEXT NOT NULL,
  answer_text TEXT,
  category VARCHAR(100),
  difficulty VARCHAR(20) CHECK (difficulty IN ('easy', 'medium', 'deep'))
);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_session_id ON analytics_events(session_id);
