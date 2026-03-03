
const axios = require('axios');
const crypto = require('crypto');
const assert = require('assert');

// Config
const API_URL = process.env.API_URL || 'http://localhost:5000';
const TABLE_TOKEN = 'test-table-menu-' + Date.now();
const RESTAURANT_ID = 'default';

async function runTest() {
  console.log('🧪 Starting Automated QA Plan: Menu & Reset V4');
  console.log(`📍 Table Token: ${TABLE_TOKEN}`);

  // =================================================================
  // SCENARIO 3: Menu Reset & Mode Switch
  // =================================================================
  console.log('\n--- Scenario 3: Menu Reset & Mode Switch ---');
  
  // 1. Start Initial Session (Single)
  console.log('1. User starts Single Session...');
  let session1 = await axios.post(`${API_URL}/sessions`, {
    table_token: TABLE_TOKEN,
    restaurant_id: RESTAURANT_ID,
    mode: 'single-phone',
    context: 'Exploring'
  });
  
  const token1 = session1.data.participant_token;
  const sessionId1 = session1.data.session_id;
  const createdAt1 = new Date(session1.data.created_at);
  
  console.log(`   Session 1 created: ${sessionId1} at ${createdAt1.toISOString()}`);

  // 2. Verify Resume Works Initially
  console.log('2. Verify Resume works before reset...');
  let res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: TABLE_TOKEN,
    device_token: token1
  });
  assert.strictEqual(res.data.action, 'resume', 'Should resume session 1');
  assert.strictEqual(res.data.session_id, sessionId1, 'Should match session 1');

  // 3. Simulate "Start Fresh" (Client Side Logic Simulation)
  console.log('3. User clicks "Start Fresh" (Simulating Client Logic)...');
  // Client sets last_reset_at = NOW
  // Then client calls createSession
  const lastResetAt = new Date();
  await new Promise(r => setTimeout(r, 1000)); // Ensure time diff

  let session2 = await axios.post(`${API_URL}/sessions`, {
    table_token: TABLE_TOKEN,
    restaurant_id: RESTAURANT_ID,
    mode: 'dual-phone', // Switch mode
    context: 'Established' // Switch context
  });
  
  const token2 = session2.data.participant_token;
  const sessionId2 = session2.data.session_id;
  
  console.log(`   Session 2 created: ${sessionId2} (Dual Mode)`);
  assert.notStrictEqual(sessionId1, sessionId2, 'Session IDs must differ');
  assert.strictEqual(session2.data.mode, 'dual-phone', 'New session should be Dual');

  // 4. Verify Old Session is IGNORED if scan happens with old token + reset timestamp
  // NOTE: This logic is partially client-side (sessionResolver.js), but we can verify the API returns the data needed.
  
  console.log('4. Verify Resolve API returns created_at for client-side check...');
  res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: TABLE_TOKEN,
    device_token: token1 // Old token
  });
  
  // The API will still say "resume" because it doesn't know about client-side lastResetAt
  // BUT we must verify it returns created_at so the client CAN reject it.
  assert.strictEqual(res.data.action, 'resume', 'Backend still finds old session (expected)');
  assert.ok(res.data.created_at, 'Response must include created_at');
  
  const resolvedCreatedAt = new Date(res.data.created_at);
  assert.ok(resolvedCreatedAt < lastResetAt, 'Old session created_at must be older than reset time');
  console.log('   ✅ API provides data for client-side rejection of old session');

  // 5. Verify New Session Resumes Correctly
  console.log('5. Verify New Session Resumes...');
  res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: TABLE_TOKEN,
    device_token: token2
  });
  assert.strictEqual(res.data.action, 'resume', 'Should resume session 2');
  assert.strictEqual(res.data.session_id, sessionId2, 'Should match session 2');
  
  console.log('✅ Scenario 3 Passed');
  console.log('\n🎉 ALL MENU/RESET TESTS PASSED');
}

runTest().catch(err => {
  console.error('❌ Test Failed:', err.message);
  if (err.response) {
      console.error('Response Data:', err.response.data);
  }
  process.exit(1);
});
