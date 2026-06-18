-- Ensure the default restaurant and super admin always exist.
-- This migration is idempotent and safe to re-run.

-- Default restaurant
INSERT INTO restaurants (id, name, slug, billing_status)
VALUES (
  'd0000000-0000-0000-0000-000000000000',
  'Default Restaurant',
  'default',
  'active'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  billing_status = 'active';

-- Default super admin
-- Email: superadmin@tabletalk.app
-- Password: superadmin123
INSERT INTO users (email, password_hash, role, restaurant_id)
VALUES (
  'superadmin@tabletalk.app',
  'salt123.1000.3dd344d4cccc43ac3573926235b0c2abbd24e6f6c2c56188933fbd8048daf4679b3b817af24b0487b650214c3bee4dd30f49af7a77e636cc1f4807b36ef1373e',
  'SUPER_ADMIN',
  NULL
)
ON CONFLICT (email) DO UPDATE
SET
  role = 'SUPER_ADMIN',
  restaurant_id = NULL;
