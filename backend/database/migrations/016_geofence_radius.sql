-- ============================================================
-- 016_geofence_radius.sql
-- Adds configurable geofence_radius_meters column to restaurants so
-- the QR handsha
-- No PII; snake_case columns; parameterised queries only.
-- ============================================================

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER
  NOT NULL DEFAULT 100
  CHECK (geofence_radius_meters >= 5 AND geofence_radius_meters <= 5000);

-- Ensure index already exists (009_restaurant_profile.sql) for lat/lng lookups.
CREATE INDEX IF NOT EXISTS idx_restaurants_lat_lng ON restaurants (latitude, longitude);
