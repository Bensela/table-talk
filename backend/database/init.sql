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
  session_id UUID REFERENCES sessions(session_id) ON DELETE SET NULL,
  participant_id UUID,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
  table_token VARCHAR(100),
  anonymous_id VARCHAR(100),
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_session_id ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_participant_id ON analytics_events(participant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_restaurant_id ON analytics_events(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_table_token ON analytics_events(table_token);
CREATE INDEX IF NOT EXISTS idx_analytics_anonymous_id ON analytics_events(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_analytics_event_data_gin ON analytics_events USING GIN (event_data jsonb_path_ops);
