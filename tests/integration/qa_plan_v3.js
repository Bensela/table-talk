
const axios = require('axios');
const crypto = require('crypto');
const assert = require('assert');

// Config
const API_URL = process.env.API_URL || 'http://localhost:5000/api';
const TABLE_TOKEN = 'test-table-qa-' + Date.now();
const RESTAURANT_ID = 'default';

// Helpers
const createDeviceToken = () => crypto.randomBytes(32).toString('hex');

async function runTest() {
  console.log('🧪 Starting Automated QA Plan: Session Resolution V3');
  console.log(`📍 Table Token: ${TABLE_TOKEN}`);

  // =================================================================
  // SCENARIO 1: Single Mode Isolation
  // =================================================================
  console.log('\n--- Scenario 1: Single Mode Isolation ---');
  
  const deviceA = createDeviceToken();
  const deviceB = createDeviceToken();

  // 1. Phone A scans -> Should Start New
  console.log('1. Phone A scans (First time)...');
  let res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: TABLE_TOKEN,
    device_token: deviceA
  });
  assert.strictEqual(res.data.action, 'start_new', 'Phone A should start new session');
  
  // Simulate Phone A creating a Single Session
  console.log('   Phone A creates Single Session...');
  let sessionA = await axios.post(`${API_URL}/sessions`, {
    table_token: TABLE_TOKEN,
    restaurant_id: RESTAURANT_ID,
    mode: 'single-phone',
    context: 'Exploring'
  });
  const sessionA_Id = sessionA.data.session_id;
  const tokenA = sessionA.data.participant_token; // This becomes Device A's persistent token

  // 2. Phone B scans -> Should Start New (Not see A's session)
  console.log('2. Phone B scans (Same QR)...');
  res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: TABLE_TOKEN,
    device_token: deviceB
  });
  assert.strictEqual(res.data.action, 'start_new', 'Phone B should start new session (Single Mode is isolated)');

  // Simulate Phone B creating their own session
  console.log('   Phone B creates Single Session...');
  let sessionB = await axios.post(`${API_URL}/sessions`, {
    table_token: TABLE_TOKEN,
    restaurant_id: RESTAURANT_ID,
    mode: 'single-phone',
    context: 'Exploring'
  });
  const tokenB = sessionB.data.participant_token;

  // 3. Phone A returns -> Should Resume Session A
  console.log('3. Phone A returns (Resume)...');
  res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: TABLE_TOKEN,
    device_token: tokenA
  });
  assert.strictEqual(res.data.action, 'resume', 'Phone A should resume');
  assert.strictEqual(res.data.session_id, sessionA_Id, 'Phone A should resume Session A');

  // 4. Phone B returns -> Should Resume Session B
  console.log('4. Phone B returns (Resume)...');
  res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: TABLE_TOKEN,
    device_token: tokenB
  });
  assert.strictEqual(res.data.action, 'resume', 'Phone B should resume');
  assert.strictEqual(res.data.session_id, sessionB.data.session_id, 'Phone B should resume Session B');

  console.log('✅ Scenario 1 Passed');


  // =================================================================
  // SCENARIO 2: Dual Mode Auto-Join
  // =================================================================
  console.log('\n--- Scenario 2: Dual Mode Auto-Join ---');
  
  const deviceC = createDeviceToken(); // Phone A for Dual
  const deviceD = createDeviceToken(); // Phone B for Dual
  const deviceE = createDeviceToken(); // Phone C (Third Wheel)
  const DUAL_TABLE = 'dual-table-' + Date.now();

  // 1. Phone C starts Dual Session
  console.log('1. Phone C starts Dual Session...');
  let sessionDual = await axios.post(`${API_URL}/sessions`, {
    table_token: DUAL_TABLE,
    restaurant_id: RESTAURANT_ID,
    mode: 'dual-phone',
    context: 'Exploring'
  });
  const dualSessionId = sessionDual.data.session_id;
  const tokenC = sessionDual.data.participant_token;

  // Verify waiting status
  assert.strictEqual(sessionDual.data.dual_status, 'waiting', 'Dual session should be waiting');

  // 2. Phone D scans -> Should Join Dual
  console.log('2. Phone D scans...');
  res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: DUAL_TABLE,
    device_token: deviceD // New device
  });
  assert.strictEqual(res.data.action, 'join_dual', 'Phone D should be prompted to join');
  assert.strictEqual(res.data.session_id, dualSessionId, 'Phone D should join C\'s session');

  // Phone D performs the join
  console.log('   Phone D performs join...');
  let joinRes = await axios.post(`${API_URL}/sessions/join-dual`, {
    table_token: DUAL_TABLE,
    restaurant_id: RESTAURANT_ID,
    session_id: dualSessionId
  });
  const tokenD = joinRes.data.participant_token;
  assert.strictEqual(joinRes.data.dual_status, 'paired', 'Session should be paired now');

  // 3. Phone E scans -> Should Start New (Dual is Full)
  console.log('3. Phone E scans (Third Wheel)...');
  res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: DUAL_TABLE,
    device_token: deviceE
  });
  assert.strictEqual(res.data.action, 'start_new', 'Phone E should start new session (Dual is full)');

  // 4. Phone C returns -> Resume as Role A
  console.log('4. Phone C returns...');
  res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: DUAL_TABLE,
    device_token: tokenC
  });
  assert.strictEqual(res.data.action, 'resume', 'Phone C should resume');
  assert.strictEqual(res.data.role, 'A', 'Phone C is Role A');

  // 5. Phone D returns -> Resume as Role B
  console.log('5. Phone D returns...');
  res = await axios.post(`${API_URL}/sessions/resolve`, {
    restaurant_id: RESTAURANT_ID,
    table_token: DUAL_TABLE,
    device_token: tokenD
  });
  assert.strictEqual(res.data.action, 'resume', 'Phone D should resume');
  assert.strictEqual(res.data.role, 'B', 'Phone D is Role B');

  console.log('✅ Scenario 2 Passed');

  console.log('\n🎉 ALL QA TESTS PASSED SUCCESSFULLY');
}

runTest().catch(err => {
  console.error('❌ Test Failed:', err.message);
  if (err.response) {
      console.error('Response Data:', err.response.data);
  }
  process.exit(1);
});
