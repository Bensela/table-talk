const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not defined in environment variables');
  process.exit(1);
}

const init = async () => {
  console.log('🔄 Starting database migration...');

  const caCert = process.env.DB_CA_CERT
    ? process.env.DB_CA_CERT
        .replace(/\\n/g, '\n')
        .replace(/\r/g, '')
        .trim()
        .replace(/^"+|"+$/g, '')
    : null;

  const isLocal =
    DATABASE_URL.includes('localhost') ||
    DATABASE_URL.includes('127.0.0.1');

  const useSSL =
    process.env.DB_SSL === 'true' ||
    (!isLocal && process.env.NODE_ENV === 'production');

  const strictSSL = process.env.DB_SSL_STRICT === 'true';

  const sanitizedDatabaseUrl = useSSL
    ? DATABASE_URL
        .replace(/([?&])sslmode=[^&]+(&?)/i, '$1')
        .replace(/[?&]$/, '')
        .replace(/\?&/, '?')
    : DATABASE_URL;

  const dbClient = new Client({
    connectionString: sanitizedDatabaseUrl,
    ssl: useSSL
      ? caCert
        ? strictSSL
          ? {
              ca: caCert,
              rejectUnauthorized: true
            }
          : {
              ca: caCert,
              rejectUnauthorized: false
            }
        : {
            rejectUnauthorized: false
          }
      : false
  });

  try {
    await dbClient.connect();
    console.log('📡 Connected to database successfully.');

    // Create a tracking table if it doesn't exist
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const runMigration = async (fileName, filePath) => {
      // Check if this specific migration has already been run
      const result = await dbClient.query(
        'SELECT 1 FROM schema_migrations WHERE migration_name = $1',
        [fileName]
      );

      if (result.rowCount > 0) {
        console.log(`ℹ️ Skipping ${fileName} (already applied).`);
        return;
      }

      console.log(`📜 Running ${fileName}...`);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      try {
        await dbClient.query('BEGIN'); // Run in a transaction
        await dbClient.query(sql);
        await dbClient.query(
          'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
          [fileName]
        );
        await dbClient.query('COMMIT');
        console.log(`✅ ${fileName} applied successfully.`);
      } catch (err) {
        await dbClient.query('ROLLBACK');
        
        // Handle the "already exists" case gracefully
        if (err.message.includes('already exists')) {
          console.log(`⚠️  Relation in ${fileName} already exists. Marking as completed in tracking table.`);
          await dbClient.query(
            'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
            [fileName]
          );
          return; // Move to the next migration instead of crashing
        }

        console.error(`❌ Error in ${fileName}:`, err.message);
        throw err; // Re-throw for any other type of error (syntax, connection, etc.)
      }
    };

    // 1. Run Base Init
    await runMigration('init.sql', path.join(__dirname, '../database/init.sql'));

    // 2. Define Migration Folder
    const migrationsDir = path.join(__dirname, '../database/migrations');
    const migrationFiles = [
      '001_phase1_upgrade.sql',
      '002_restrict_contexts.sql',
      '003_enable_mature_context.sql',
      '004_v1_2_upgrade.sql',
      '005_v1_3_dual_security.sql',
      '006_fix_missing_hints.sql',
      '007_add_session_lifecycle_fields.sql'
    ];

    // 3. Execute Migration Files
    for (const file of migrationFiles) {
      await runMigration(file, path.join(migrationsDir, file));
    }

    console.log('✅ All schema upgrades complete.');

    // 4. Seed Questions (Already has its own check)
    console.log('🌱 Checking seed data...');
    const checkQuestions = await dbClient.query('SELECT COUNT(*) FROM questions');
    if (parseInt(checkQuestions.rows[0].count) === 0) {
       const seedSql = fs.readFileSync(path.join(__dirname, '../database/seeds/questions.sql'), 'utf8');
       await dbClient.query(seedSql);
       console.log('✅ Seed data inserted.');
    } else {
       console.log('ℹ️ Questions table already populated.');
    }

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await dbClient.end();
  }

  console.log('🚀 Database setup complete!');
};

init();
