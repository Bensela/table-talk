-- Migration: expand analytics_events for dense session funnel logging
-- Adds top-level denormalized columns (participant_id, restaurant_id, table_token, anonymous_id)
-- plus a JSONB GIN index on event_data to speed up reporting queries over arbitrary nested fields.
-- All inserts remain append-only; this file never UPDATEs or DELETEs rows.
--
-- Also rewires the session_id FK to ON DELETE SET NULL (was ON DELETE CASCADE) so
-- that expiring or deleting a session row never destroys its historical analytics data.

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS participant_id UUID;

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL;

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS table_token VARCHAR(100);

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS anonymous_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_analytics_participant_id
  ON analytics_events(participant_id);

CREATE INDEX IF NOT EXISTS idx_analytics_restaurant_id
  ON analytics_events(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_analytics_table_token
  ON analytics_events(table_token);

CREATE INDEX IF NOT EXISTS idx_analytics_anonymous_id
  ON analytics_events(anonymous_id);

CREATE INDEX IF NOT EXISTS idx_analytics_event_data_gin
  ON analytics_events USING GIN (event_data jsonb_path_ops);

DO $$
BEGIN
  -- Drop the existing CASCADE constraint (if present) and recreate as SET NULL.
  -- Using a DO block with exception handling because Postgres has no
  -- ALTER CONSTRAINT ... IF EXISTS and we don't know the auto-assigned name.
  DECLARE
    fk_name text;
  BEGIN
    SELECT tc.constraint_name INTO fk_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
    WHERE tc.table_name = 'analytics_events'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'session_id'
    LIMIT 1;

    IF fk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE analytics_events DROP CONSTRAINT %I', fk_name);
      ALTER TABLE analytics_events
        ADD CONSTRAINT analytics_events_session_id_fkey_setnull
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE SET NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not rewire analytics_events.session_id FK: %', SQLERRM;
  END;
END $$;
