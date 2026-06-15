-- ============================================================
-- 009_restaurant_profile.sql
-- Adds contact, address, manager, and geolocation fields to restaurants.
-- No PII beyond what's required for restaurant operations.
-- ============================================================

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 7);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS manager_name VARCHAR(255);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_restaurants_lat_lng ON restaurants (latitude, longitude);
