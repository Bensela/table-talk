
const { io } = require("socket.io-client");
const axios = require("axios");
const crypto = require("crypto");
const assert = require("assert");

// Config
const API_URL = process.env.API_URL || "http://localhost:5000";
const SOCKET_URL = process.env.SOCKET_URL || "http://localhost:5000";
const SOCKET_PATH = "/socket.io/"; // Dev path
const TABLE_TOKEN = "test-dual-gating-" + Date.now();
const RESTAURANT_ID = "default";

// Helper to create client
function createClient(name) {
  const socket = io(SOCKET_URL, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    reconnection: false,
  });
  return { name, socket, events: [] };
}

// Helper to wait for event
function waitForEvent(client, eventName, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${client.name} timed out waiting for ${eventName}`));
    }, timeout);

    client.socket.on(eventName, (data) => {
      clearTimeout(timer);
      client.events.push({ event: eventName, data });
      resolve(data);
    });
  });
}

async function runTest() {
  console.log("🧪 Starting Automated QA: Dual Mode Next Intent Gating");
  console.log(`📍 Table Token: ${TABLE_TOKEN}`);

  // 1. Create Dual Session
  console.log("\n--- Step 1: Create Dual Session ---");
  const sessionRes = await axios.post(`${API_URL}/sessions`, {
    table_token: TABLE_TOKEN,
    restaurant_id: RESTAURANT_ID,
    mode: "dual-phone",
    context: "Exploring",
  });
  const sessionId = sessionRes.data.session_id;
  const tokenA = sessionRes.data.participant_token;
  const participantIdA = sessionRes.data.participant_id;
  console.log(`Session created: ${sessionId}`);

  // 2. Join Partner (Role B)
  console.log("\n--- Step 2: Join Partner (Role B) ---");
  // Simulate B scanning QR -> Resolving -> Joining
  // We'll just call join-dual directly for test speed, simulating the resolver logic
  // First, verify session is waiting
  const getRes = await axios.get(
    `${API_URL}/sessions/by-table/${TABLE_TOKEN}`
  );
  // Note: getSessionByTable only returns waiting sessions per previous changes
  assert.strictEqual(
    getRes.data.dual_status,
    "waiting",
    "Session should be waiting"
  );

  const joinRes = await axios.post(`${API_URL}/sessions/join-dual`, {
    session_id: sessionId,
    table_token: TABLE_TOKEN,
  });
  const tokenB = joinRes.data.participant_token;
  const participantIdB = joinRes.data.participant_id;
  console.log("Partner joined successfully");

  // 3. Connect Sockets
  console.log("\n--- Step 3: Connect Sockets ---");
  const clientA = createClient("Client A");
  const clientB = createClient("Client B");

  clientA.socket.emit("join_session", {
    session_id: sessionId,
    participant_id: participantIdA,
  });
  clientB.socket.emit("join_session", {
    session_id: sessionId,
    participant_id: participantIdB,
  });

  // Wait for connection
  await new Promise((r) => setTimeout(r, 1000));
  console.log("Sockets connected");

  // 4. Test Gating: A presses first
  console.log("\n--- Step 4: Gating Logic (A presses first) ---");
  // Get initial question ID
  const q1 = await axios.get(`${API_URL}/sessions/${sessionId}/questions/current`);
  const initialQId = q1.data.question_id;
  console.log(`Initial Question ID: ${initialQId}`);

  // Client A presses "Next Question" (sends intent)
  console.log("Client A sending 'dual_next_intent'...");
  clientA.socket.emit("dual_next_intent");

  // Verify NO advance yet (wait 1s)
  await new Promise((r) => setTimeout(r, 1000));
  const qCheck = await axios.get(`${API_URL}/sessions/${sessionId}/questions/current`);
  assert.strictEqual(qCheck.data.question_id, initialQId, "Question should NOT advance yet");
  console.log("✅ Verified: No advance with single intent");

  // Client A presses AGAIN (Idempotency check)
  console.log("Client A sending 'dual_next_intent' again (spam)...");
  clientA.socket.emit("dual_next_intent");
  await new Promise((r) => setTimeout(r, 500));
  
  // Both clients should receive 'advance_question'
  console.log("Setting up listeners for 'advance_question'...");
  const pA = waitForEvent(clientA, "advance_question");
  const pB = waitForEvent(clientB, "advance_question");
  
  // Now emit B's intent
  console.log("Client B sending 'dual_next_intent'...");
  clientB.socket.emit("dual_next_intent");

  // Wait with generous timeout
  await Promise.all([pA, pB]);
  console.log("✅ Verified: Both clients received advance event");

  // Verify new question
  const q2 = await axios.get(`${API_URL}/sessions/${sessionId}/questions/current`);
  assert.notStrictEqual(q2.data.question_id, initialQId, "Question should have advanced");
  console.log(`New Question ID: ${q2.data.question_id}`);

  // 5. Test Gating: B presses first
  console.log("\n--- Step 5: Gating Logic (B presses first) ---");
  const currentQId = q2.data.question_id;
  
  console.log("Client B sending 'dual_next_intent'...");
  clientB.socket.emit("dual_next_intent");
  
  await new Promise((r) => setTimeout(r, 1000));
  const qCheck2 = await axios.get(`${API_URL}/sessions/${sessionId}/questions/current`);
  assert.strictEqual(qCheck2.data.question_id, currentQId, "Question should NOT advance yet");
  console.log("✅ Verified: No advance with single intent (B)");

  console.log("Setting up listeners...");
  const pA2 = waitForEvent(clientA, "advance_question");
  const pB2 = waitForEvent(clientB, "advance_question");

  console.log("Client A sending 'dual_next_intent'...");
  clientA.socket.emit("dual_next_intent");

  await Promise.all([pA2, pB2]);
  console.log("✅ Verified: Advanced after second intent");

  // 6. Test Disconnect Persistence
  console.log("\n--- Step 6: Disconnect Persistence ---");
  
  // Client A sends intent then disconnects
  console.log("Client A sending intent...");
  clientA.socket.emit("dual_next_intent");
  await new Promise((r) => setTimeout(r, 500));
  
  console.log("Client A disconnecting...");
  clientA.socket.disconnect();
  
  // Client B sends intent
  console.log("Client B sending intent...");
  console.log("Setting up listener for B...");
  const pB3 = waitForEvent(clientB, "advance_question");
  
  clientB.socket.emit("dual_next_intent");
  
  await pB3;
  console.log("✅ Verified: Advance occurred despite A disconnecting");

  console.log("\n🎉 ALL DUAL GATING TESTS PASSED");
  
  clientB.socket.disconnect();
}

runTest().catch((err) => {
  console.error("❌ Test Failed:", err.message);
  if (err.response) {
    console.error("Response Data:", err.response.data);
  }
  process.exit(1);
});
