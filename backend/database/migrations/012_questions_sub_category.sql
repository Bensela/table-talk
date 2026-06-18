-- Migration: Add optional question sub-category support

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS sub_category VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_questions_category_sub_category
  ON questions (category, sub_category);
