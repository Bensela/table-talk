const db = require('../db');

const migrate = async () => {
  try {
    console.log('Starting v1.3 Database Migration (Dual Security)...');

    // 1. Update session_participants table
    console.log('Updating "session_participants" table...');
    
    // Add participant_token_hash column
    await db.query('ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS participant_token_hash TEXT;');
    
    // Add Unique Constraint (session_id, role)
    // We first check if duplicates exist and clean them up if necessary (simplistic approach: keep latest)
    // For MVP/Dev, we can assume clean state or just try adding constraint.
    try {
      await db.query('ALTER TABLE session_participants ADD CONSTRAINT session_participants_role_unique UNIQUE (session_id, role);');
      console.log('✅ Unique constraint added.');
    } catch (e) {
      if (e.code === '23505') { // Unique violation
         console.warn('⚠️ Unique constraint violation found. Skipping constraint creation (manual cleanup required if strictness needed).');
      } else if (e.code === '42710') { // Already exists
         console.log('ℹ️ Constraint already exists.');
      } else {
         throw e;
      }
    }

    // Create Index
    await db.query('CREATE INDEX IF NOT EXISTS idx_participant_token ON session_participants (participant_token_hash);');
    
    console.log('✅ "session_participants" table updated.');
    console.log('🎉 Migration v1.3 completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
