const db = require('../db');

const migrate = async () => {
  try {
    console.log('Starting v1.2 Database Migration...');

    // 1. Enable pgcrypto for UUID generation
    await db.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    console.log('✅ Extension "pgcrypto" enabled.');

    // 2. Update sessions table
    console.log('Updating "sessions" table...');
    
    // Add columns one by one to avoid errors if they exist
    const sessionColumns = [
      'ADD COLUMN IF NOT EXISTS session_group_id UUID',
      'ADD COLUMN IF NOT EXISTS pairing_code_hash VARCHAR(64)',
      'ADD COLUMN IF NOT EXISTS pairing_expires_at TIMESTAMP',
      'ADD COLUMN IF NOT EXISTS dual_status VARCHAR(20) CHECK (dual_status IN (\'waiting\', \'paired\', \'ended\'))',
      'ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP DEFAULT NOW()'
    ];

    for (const col of sessionColumns) {
      await db.query(`ALTER TABLE sessions ${col};`);
    }
    
    // Backfill session_group_id for existing rows
    await db.query('UPDATE sessions SET session_group_id = gen_random_uuid() WHERE session_group_id IS NULL;');
    
    // Enforce NOT NULL on session_group_id
    await db.query('ALTER TABLE sessions ALTER COLUMN session_group_id SET NOT NULL;');
    
    // Create Indexes
    await db.query('CREATE INDEX IF NOT EXISTS idx_table_token ON sessions (table_token);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_expires_at ON sessions (expires_at);');
    // Conditional indexes might fail if not supported by this PG version or syntax, simplified for now:
    // await db.query('CREATE INDEX IF NOT EXISTS idx_active_group ON sessions (table_token, context, session_group_id);'); 
    
    console.log('✅ "sessions" table updated.');

    // 3. Create session_participants table
    console.log('Creating "session_participants" table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS session_participants (
        participant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        role VARCHAR(1) CHECK (role IN ('A', 'B')),
        created_at TIMESTAMP DEFAULT NOW(),
        last_seen_at TIMESTAMP DEFAULT NOW(),
        disconnected_at TIMESTAMP
      );
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_session_participant ON session_participants (session_id, participant_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_last_seen ON session_participants (last_seen_at);');
    console.log('✅ "session_participants" table created.');

    // 4. Create deck_sessions table
    console.log('Creating "deck_sessions" table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS deck_sessions (
        deck_context_id VARCHAR(64) PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        table_token VARCHAR(100) NOT NULL,
        relationship_context VARCHAR(20) NOT NULL CHECK (relationship_context IN ('Exploring', 'Established')),
        service_day DATE NOT NULL,
        session_group_id UUID NOT NULL,
        seed VARCHAR(64) NOT NULL,
        position_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        UNIQUE (restaurant_id, table_token, relationship_context, service_day, session_group_id)
      );
    `);
    console.log('✅ "deck_sessions" table created.');

    console.log('🎉 Migration v1.2 completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
