-- Restrict contexts to only 'Exploring' and 'Established'
-- (Removing 'Mature')

-- 0. Cleanup invalid data first
DELETE FROM sessions WHERE context = 'Mature';
DELETE FROM deck_sessions WHERE relationship_context = 'Mature';
DELETE FROM questions WHERE context = 'Mature';

-- 1. Sessions table
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_context_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_context_check CHECK (context IN ('Exploring', 'Established'));

-- 2. Questions table
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_context_check;
ALTER TABLE questions ADD CONSTRAINT questions_context_check CHECK (context IN ('Exploring', 'Established'));

-- 3. Deck Sessions (if enforced at DB level, though schema definition in prompt implies it)
-- The prompt didn't explicitly ask for a check constraint on deck_sessions but usually good practice.
-- However, deck_sessions has a unique constraint including relationship_context.
-- If we want to be safe:
-- ALTER TABLE deck_sessions ADD CONSTRAINT deck_sessions_context_check CHECK (relationship_context IN ('Exploring', 'Established'));
