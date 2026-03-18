const db = require('./backend/db');

async function run() {
    try {
        console.log("Adding fresh_intent_at to sessions...");
        await db.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS fresh_intent_at TIMESTAMPTZ;");
        console.log("Done!");
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();