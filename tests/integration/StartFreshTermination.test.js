const request = require('supertest');
const { io } = require('socket.io-client');
const { app, server } = require('../../backend/index'); // Adjust path
const db = require('../../backend/db');

// Helper to create a socket client
function createClient(port, token) {
  return io(`http://localhost:${port}`, {
    path: '/socket.io/',
    transports: ['websocket'],
    reconnection: false,
    auth: { token } // if needed
  });
}

describe('Start Fresh Termination Logic', () => {
  let port;
  let session;
  let tokenA, tokenB;
  let clientA, clientB;
  let participantIdA, participantIdB;

  beforeAll(async () => {
    // Start server on random port
    server.listen(0);
    port = server.address().port;
    
    // Create Dual Session
    const res = await request(app).post('/sessions').send({
      table_token: 'TEST_TABLE_TERM',
      mode: 'dual-phone',
      context: 'Exploring'
    });
    session = res.body;
    tokenA = session.participant_token; // raw token
    participantIdA = session.participant_id;

    // Join with B
    const joinRes = await request(app).post('/sessions/join-dual').send({
      table_token: 'TEST_TABLE_TERM',
      session_id: session.session_id
    });
    tokenB = joinRes.body.participant_token;
    participantIdB = joinRes.body.participant_id;
  });

  afterAll(async () => {
    if (clientA) clientA.disconnect();
    if (clientB) clientB.disconnect();
    server.close();
    await db.query('DELETE FROM sessions WHERE session_id = $1', [session.session_id]);
    await db.query('DELETE FROM session_participants WHERE session_id = $1', [session.session_id]);
  });

  test('Phone B Start Fresh -> Leaves -> Returns (Resume)', async () => {
    // 1. Connect B
    clientB = createClient(port);
    
    await new Promise((resolve) => {
        clientB.emit('join_session', { session_id: session.session_id, participant_id: participantIdB });
        clientB.on('partner_status', () => resolve());
    });

    // 2. B sends fresh_intent
    clientB.emit('fresh_intent');
    await new Promise(r => setTimeout(r, 100)); // wait for processing

    // Verify DB flag
    const dbRes1 = await db.query('SELECT fresh_intent_b FROM sessions WHERE session_id = $1', [session.session_id]);
    expect(dbRes1.rows[0].fresh_intent_b).toBe(true);

    // 3. B disconnects (simulating navigation)
    clientB.disconnect();

    // 4. B Reconnects (simulating scan -> resume -> join)
    clientB = createClient(port);
    clientB.emit('join_session', { session_id: session.session_id, participant_id: participantIdB });
    
    await new Promise(r => setTimeout(r, 100));

    // Verify DB flag CLEARED
    const dbRes2 = await db.query('SELECT fresh_intent_b FROM sessions WHERE session_id = $1', [session.session_id]);
    expect(dbRes2.rows[0].fresh_intent_b).toBe(false);
  });

  test('Both Start Fresh -> Termination', async () => {
    // 1. Connect A and B
    clientA = createClient(port);
    clientA.emit('join_session', { session_id: session.session_id, participant_id: participantIdA });
    
    // B is already connected from previous test, let's ensure
    if (!clientB.connected) {
        clientB = createClient(port);
        clientB.emit('join_session', { session_id: session.session_id, participant_id: participantIdB });
    }

    await new Promise(r => setTimeout(r, 100));

    // 2. B sends fresh_intent -> Disconnects
    clientB.emit('fresh_intent');
    await new Promise(r => setTimeout(r, 100));
    clientB.disconnect();

    const dbRes1 = await db.query('SELECT fresh_intent_b, dual_status FROM sessions WHERE session_id = $1', [session.session_id]);
    expect(dbRes1.rows[0].fresh_intent_b).toBe(true);
    expect(dbRes1.rows[0].dual_status).not.toBe('ended');

    // 3. A sends fresh_intent
    clientA.emit('fresh_intent');
    
    // Wait for termination event or DB update
    await new Promise(r => setTimeout(r, 200));

    // 4. Verify Termination
    const dbRes2 = await db.query('SELECT dual_status, expires_at FROM sessions WHERE session_id = $1', [session.session_id]);
    expect(dbRes2.rows[0].dual_status).toBe('ended');
    // Check if expired
    const expiresAt = new Date(dbRes2.rows[0].expires_at);
    const now = new Date();
    expect(expiresAt.getTime()).toBeLessThanOrEqual(now.getTime() + 1000); // Should be NOW()
  });
});
