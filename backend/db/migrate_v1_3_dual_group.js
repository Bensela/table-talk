const db = require('../db');

const migrate = async () => {
  try {
    console.log('Starting v1.3 Dual Group Migration...');

    // 1. Add dual_group_id to sessions table
    console.log('Adding dual_group_id to "sessions" table...');
    await db.query(`
      ALTER TABLE sessions 
      ADD COLUMN IF NOT EXISTS dual_group_id UUID;
    `);
    
    // Create index for fast lookups
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_dual_group_id ON sessions (dual_group_id);
    `);
    console.log('✅ "sessions" table updated.');

    // 2. Create dual_groups table (for explicit group management if needed)
    console.log('Creating "dual_groups" table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS dual_groups (
        dual_group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id VARCHAR(100) NOT NULL,
        table_token VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        terminated_at TIMESTAMP,
        active_context_id VARCHAR(64),
        active_session_id UUID REFERENCES sessions(session_id)
      );
    `);
    
    // Index for quick lookup by table
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_dual_groups_table ON dual_groups (table_token, restaurant_id);
    `);
    console.log('✅ "dual_groups" table created.');

    console.log('🎉 Migration v1.3 completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();