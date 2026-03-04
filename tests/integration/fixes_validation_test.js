const request = require('supertest');
let chai;
let expect;
const app = require('../../backend/index');
const db = require('../../backend/db');
const { Server } = require('socket.io');
const Client = require('socket.io-client');

// Use port 5004 to avoid conflict
const TEST_PORT = 5004;
const SOCKET_URL = `http://localhost:${TEST_PORT}`;

describe('Dual Mode Sync & UI Fixes Validation', () => {
  let server, io, clientSocketA, clientSocketB;
  let sessionData;

  before(async () => {
    chai = await import('chai');
    expect = chai.expect;
    // Start a test server
    server = app.listen(TEST_PORT);
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
    // Setup clients with forceNew to ensure clean state
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

  // --- 1. Dual Sync Survival Test ---
  it('Should maintain sync and room membership after "simulated" menu usage', async () => {
    // 1. Create Dual Session
    const res = await request(app)
      .post('/sessions')
      .send({ table_token: 'test-table-sync', mode: 'dual-phone', context: 'Established' });
    
    sessionData = res.body;
    
    // 2. Join Client A & B
    clientSocketA.emit('join_session', { session_id: sessionData.session_id, participant_id: sessionData.participant_id });
    
    const joinRes = await request(app).post('/sessions/join-dual').send({ session_id: sessionData.session_id });
    const participantB = joinRes.body;
    clientSocketB.emit('join_session', { session_id: sessionData.session_id, participant_id: participantB.participant_id });

    await new Promise(r => setTimeout(r, 500));

    // 3. Simulate Menu Interaction (Client A "reconnects" or "re-joins" without full disconnect)
    // In real app, socket persists, but let's test re-assertion of join
    clientSocketA.emit('join_session', { session_id: sessionData.session_id, participant_id: sessionData.participant_id });
    
    await new Promise(r => setTimeout(r, 200));

    // 4. Verify both still receive updates
    let updateCount = 0;
    clientSocketA.on('advance_question', () => updateCount++);
    clientSocketB.on('advance_question', () => updateCount++);

    // Trigger advance
    clientSocketA.emit('dual_next_intent');
    clientSocketB.emit('dual_next_intent');

    await new Promise(r => setTimeout(r, 1000));
    
    // Both should have received the event
    expect(updateCount).to.be.at.least(2);
  });

  // --- 2. Popup Instruction Test ---
  it('Should emit next_intent_update to partner when one user clicks ready', async () => {
    // 1. Setup Listeners
    let popupTriggered = false;
    clientSocketB.on('next_intent_update', (data) => {
        if (data.count >= 1) popupTriggered = true;
    });

    // 2. Client A clicks Ready
    clientSocketA.emit('dual_next_intent');

    await new Promise(r => setTimeout(r, 500));

    // 3. Verify B received the signal
    expect(popupTriggered).to.be.true;
  });

  // --- 3. Start Fresh Routing (Backend Check) ---
  // Since routing is client-side, we verify the backend supports the "Fresh" state
  it('Should allow resolving a fresh session after reset', async () => {
      // Create session
      const res = await request(app)
        .post('/sessions')
        .send({ table_token: 'test-table-fresh-2', mode: 'single' });
      
      // Simulate "Start Fresh" behavior: Client clears storage.
      // Next request to resolveSession should create NEW or Resume based on timestamps.
      // Since we can't easily mock the timestamp logic here without client code,
      // we just verify the endpoint is healthy.
      const resolveRes = await request(app)
        .post('/sessions/resolve')
        .send({ table_token: 'test-table-fresh-2' }); // No device token = New
      
      expect(resolveRes.body.action).to.equal('new');
  });

});
