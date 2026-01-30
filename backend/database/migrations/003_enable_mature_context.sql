-- Re-enable 'Mature' context for Phase 2

-- 1. Sessions table
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_context_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_context_check CHECK (context IN ('Exploring', 'Established', 'Mature'));

-- 2. Questions table
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_context_check;
ALTER TABLE questions ADD CONSTRAINT questions_context_check CHECK (context IN ('Exploring', 'Established', 'Mature'));

-- 3. Deck Sessions (implicit check on relationship_context via unique constraint, but good to be safe if we added check)
-- No explicit check was added to deck_sessions in migration 002, so we are good.
