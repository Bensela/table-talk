-- Migration: Add restaurants and multi-tenancy support

-- 1. Create restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Insert default launch client restaurant
INSERT INTO restaurants (id, name, slug)
VALUES ('d0000000-0000-0000-0000-000000000000', 'Default Restaurant', 'default')
ON CONFLICT (slug) DO NOTHING;

-- 3. Modify sessions table
-- Rename existing VARCHAR column to old_restaurant_id if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sessions' AND column_name = 'restaurant_id'
  ) THEN
    ALTER TABLE sessions RENAME COLUMN restaurant_id TO old_restaurant_id;
  END IF;
END $$;

-- Add new restaurant_id UUID column referencing restaurants.id
ALTER TABLE sessions 
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) DEFAULT 'd0000000-0000-0000-0000-000000000000';

-- Backfill data from old_restaurant_id
UPDATE sessions SET restaurant_id = 'd0000000-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;

-- 4. Modify questions table
ALTER TABLE questions 
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) DEFAULT 'd0000000-0000-0000-0000-000000000000';

-- Backfill questions
UPDATE questions SET restaurant_id = 'd0000000-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;

-- 5. Composite indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_restaurant_composite ON sessions(restaurant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_questions_restaurant_composite ON questions(restaurant_id, question_id);
