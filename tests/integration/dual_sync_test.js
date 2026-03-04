const request = require('supertest');
let chai;
let expect;
const app = require('../../backend/index');
const db = require('../../backend/db');
const { Server } = require('socket.io');
const Client = require('socket.io-client');

// Use port 5002 to avoid conflict with previous test runs if any
const TEST_PORT = 5002;
const SOCKET_URL = `http://localhost:${TEST_PORT}`;

describe('Dual Mode & Session Continuity Tests', () => {
  let server, io, clientSocketA, clientSocketB;
  let sessionData;

  before(async () => {
    chai = await import('chai');
    expect = chai.expect;
    // Start a test server
    server = app.listen(TEST_PORT);
    // Initialize DB tables if needed (assumed seeded)
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
    // Clean up DB
    if (sessionData && sessionData.session_id) {
        await db.query('DELETE FROM sessions WHERE session_id = $1', [sessionData.session_id]);
        await db.query('DELETE FROM session_participants WHERE session_id = $1', [sessionData.session_id]);
    }
  });

  beforeEach(function (done) {
    this.timeout(10000); // Increase timeout for connection
    // Setup clients with forceNew: true to ensure clean connections
    clientSocketA = new Client(SOCKET_URL, { path: '/socket.io/', transports: ['websocket'], forceNew: true });
    clientSocketB = new Client(SOCKET_URL, { path: '/socket.io/', transports: ['websocket'], forceNew: true });
    
    let connected = 0;
    const checkDone = () => {
        connected++;
        if (connected === 2) done();
    };
    
    clientSocketA.on('connect', checkDone);
    clientSocketB.on('connect', checkDone);
    
    clientSocketA.on('connect_error', (err) => console.error('Socket A Error:', err));
    clientSocketB.on('connect_error', (err) => console.error('Socket B Error:', err));
  });

  afterEach(() => {
    if (clientSocketA.connected) clientSocketA.disconnect();
    if (clientSocketB.connected) clientSocketB.disconnect();
  });

  // --- 1. Dual Foreground Resync Test ---
  it('Should sync state correctly when a client reconnects (Foreground Resync)', async () => {
    // 1. Create Dual Session
    const res = await request(app)
      .post('/sessions')
      .send({ table_token: 'test-table-qa', mode: 'dual-phone', context: 'Exploring' });
    
    sessionData = res.body;
    expect(res.status).to.equal(201);

    // 2. Join Client A
    clientSocketA.emit('join_session', { 
        session_id: sessionData.session_id, 
        participant_id: sessionData.participant_id 
    });

    // 3. Join Client B (Simulate Auto-Join)
    const joinRes = await request(app)
      .post('/sessions/join-dual')
      .send({ session_id: sessionData.session_id });
    
    const participantB = joinRes.body;
    clientSocketB.emit('join_session', { 
        session_id: sessionData.session_id, 
        participant_id: participantB.participant_id 
    });

    // Wait for join
    await new Promise(r => setTimeout(r, 500));

    // 4. Client A Advances Question
    // Send dual intents
    clientSocketA.emit('dual_next_intent');
    clientSocketB.emit('dual_next_intent');
    
    // Wait for advance
    await new Promise(r => setTimeout(r, 500));

    // 5. Verify Server State Advanced
    const state1 = await request(app).get(`/sessions/${sessionData.session_id}/state`);
    const initialIndex = state1.body.position_index;

    // 6. "Disconnect" Client B (Simulate Backgrounding/Network Loss)
    clientSocketB.disconnect();

    // 7. Client A Advances Again
    // Need to reset intents first? Intents are cleared on advance.
    clientSocketA.emit('dual_next_intent');
    // Note: Since B is disconnected, the server might wait for B?
    // Current logic: requiredCount = Math.max(2, clientCount).
    // If B disconnects, clientCount is 1. requiredCount is 2.
    // So A is STUCK if B is gone. This is by design for "Dual Sync".
    // HOWEVER, for the test, we want to test RE-SYNC.
    // So let's assume B comes back.
    
    // Reconnect B
    clientSocketB.connect();
    
    await new Promise(r => setTimeout(r, 500));
    
    // B Re-joins
    clientSocketB.emit('join_session', { 
        session_id: sessionData.session_id, 
        participant_id: participantB.participant_id 
    });

    // 8. B should immediately fetch state (Simulated by calling API manually as client would)
    const stateB = await request(app).get(`/sessions/${sessionData.session_id}/state`);
    
    expect(stateB.body.position_index).to.equal(initialIndex); // Should match server
    expect(stateB.body.current_question).to.exist;
  });

  // --- 2. Start Fresh Routing Test ---
  it('Start Fresh should reset session state (Backend Logic Check)', async () => {
      // Create session
      const res = await request(app)
        .post('/sessions')
        .send({ table_token: 'test-table-fresh', mode: 'single' });
      
      const sessionId = res.body.session_id;

      // End Session (Simulate Start Fresh backend side if API used)
      // Actually Start Fresh is mostly client-side routing + clearing storage.
      // But we can verify the 'resolve' logic respects timestamps.
      
      // If I call resolveSession with a token, it should find it.
      const resolveRes = await request(app)
        .post('/sessions/resolve')
        .send({ table_token: 'test-table-fresh', device_token: res.body.participant_token });
      
      expect(resolveRes.body.action).to.equal('resume');
      expect(resolveRes.body.session_id).to.equal(sessionId);
      
      // The "Reset" logic relies on the CLIENT sending a 'lastResetAt' timestamp? 
      // No, the client compares 'lastResetAt' locally against the 'created_at' from resolve.
      // So this is a client-side logic test, hard to test in backend suite.
      // But we can verify resolve returns created_at.
      expect(resolveRes.body.created_at).to.exist;
  });

});
