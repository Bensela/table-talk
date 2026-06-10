-- Migration: Add Admin Dashboards Support

-- 1. Alter questions table
ALTER TABLE questions 
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Ensure questions.restaurant_id is nullable (remove any potential default constraints)
ALTER TABLE questions ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE questions ALTER COLUMN restaurant_id DROP NOT NULL;

-- 2. Alter restaurants table to add billing_status
ALTER TABLE restaurants 
  ADD COLUMN IF NOT EXISTS billing_status VARCHAR(50) DEFAULT 'active';

-- 3. Create restaurant_tables table
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_number VARCHAR(100) NOT NULL,
  qr_code_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(restaurant_id, table_number)
);

-- 4. Create users table for admin authentication
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) CHECK (role IN ('SUPER_ADMIN', 'RESTAURANT_ADMIN')) NOT NULL,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed default super admin
-- Password hash corresponds to 'superadmin123' hashed with pbkdf2 using salt 'salt123'
-- Salt: 'salt123', Key: 'superadmin123', Iterations: 1000, Length: 64, Digest: sha512
-- Hash: 3dd344d4cccc43ac3573926235b0c2abbd24e6f6c2c56188933fbd8048daf4679b3b817af24b0487b650214c3bee4dd30f49af7a77e636cc1f4807b36ef1373e
INSERT INTO users (email, password_hash, role, restaurant_id)
VALUES (
  'superadmin@tabletalk.app',
  'salt123.1000.3dd344d4cccc43ac3573926235b0c2abbd24e6f6c2c56188933fbd8048daf4679b3b817af24b0487b650214c3bee4dd30f49af7a77e636cc1f4807b36ef1373e',
  'SUPER_ADMIN',
  NULL
)
ON CONFLICT (email) DO NOTHING;
