import { expect } from 'chai';
import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = 'http://localhost:5000';
const SOCKET_URL = 'http://localhost:5000';

// Helper to create client
const createClient = (token) => {
    return axios.create({
        baseURL: API_URL,
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
};

// Helper to connect socket
const connectSocket = (sessionId, participantId) => {
    return new Promise((resolve, reject) => {
        const socket = io(SOCKET_URL, {
            path: '/socket.io/',
            transports: ['websocket'],
            forceNew: true
        });
        
        socket.on('connect', () => {
            socket.emit('join_session', { session_id: sessionId, participant_id: participantId });
            resolve(socket);
        });
        
        socket.on('connect_error', (err) => reject(err));
    });
};

describe('Dual Mode Context & Sync Flow', function() {
    this.timeout(10000); // Allow time for async ops

    let tableToken = 'TableTestIntegration';
    let sessionA = null;
    let sessionB = null;
    let socketA = null;
    let socketB = null;
    let client = createClient();

    // Setup: Create Dual Session
    it('Should create a Dual Mode session (Phone A)', async () => {
        const res = await client.post('/sessions', {
            table_token: tableToken,
            mode: 'dual-phone',
            context: 'Exploring'
        });
        
        expect(res.status).to.equal(201);
        sessionA = res.data;
        expect(sessionA.mode).to.equal('dual-phone');
        expect(sessionA.context).to.equal('Exploring');
        
        // Connect Socket A
        socketA = await connectSocket(sessionA.session_id, sessionA.participant_id);
    });

    it('Should join the Dual Mode session (Phone B)', async () => {
        const res = await client.post('/sessions/join-dual', {
            table_token: tableToken
        });
        
        expect(res.status).to.equal(200);
        sessionB = res.data;
        expect(sessionB.session_id).to.equal(sessionA.session_id); // Same session
        expect(sessionB.dual_status).to.equal('paired');
        
        // Connect Socket B
        socketB = await connectSocket(sessionB.session_id, sessionB.participant_id);
    });

    // TEST 1: Context Switch Convergence
    it('Should handle mutual Context Switch to Established', (done) => {
        let aUpdated = false;
        let bUpdated = false;

        // Listen for final update
        const checkDone = () => {
            if (aUpdated && bUpdated) done();
        };

        const onUpdateA = (data) => {
            if (data.context === 'Established') aUpdated = true;
            checkDone();
        };

        const onUpdateB = (data) => {
            if (data.context === 'Established') bUpdated = true;
            checkDone();
        };

        socketA.once('session_updated', onUpdateA);
        socketB.once('session_updated', onUpdateB);

        // A intends switch
        socketA.emit('context_switch_intent', { context: 'Established' });
        
        // Wait briefly then B intends switch
        setTimeout(() => {
            socketB.emit('context_switch_intent', { context: 'Established' });
        }, 500);
    });

    it('Should verify both clients are now in Established context', async () => {
        // Check API state for A
        const stateA = await client.get(`/sessions/${sessionA.session_id}/state`);
        expect(stateA.data.context).to.equal('Established');
        
        // Check API state for B (same session)
        const stateB = await client.get(`/sessions/${sessionB.session_id}/state`);
        expect(stateB.data.context).to.equal('Established');
    });

    // TEST 1.5: No Echo Popup Check
    it('Should NOT echo partner_context_intent to initiator when partner confirms (Switch back to Exploring)', (done) => {
        let aReceivedRequest = false;
        let bReceivedRequest = false;
        let aReceivedUpdate = false;
        let bReceivedUpdate = false;

        // Listener for A: Should NOT receive 'partner_context_intent' (Echo)
        // We use .once() or .on(), but we need to ensure we don't catch previous events.
        // Since we are switching to 'Exploring', it's a new event.
        
        const onPartnerContextIntentA = (data) => {
            console.log('[Test] A received partner_context_intent:', data);
            aReceivedRequest = true;
        };
        socketA.on('partner_context_intent', onPartnerContextIntentA);

        // Listener for B: Should receive 'partner_context_intent'
        const onPartnerContextIntentB = (data) => {
            console.log('[Test] B received partner_context_intent:', data);
            bReceivedRequest = true;
            
            // Simulate B confirming (sending matching intent)
            setTimeout(() => {
                socketB.emit('context_switch_intent', { context: 'Exploring' });
            }, 100);
        };
        socketB.on('partner_context_intent', onPartnerContextIntentB);

        // Listen for completion
        const checkDone = () => {
            if (aReceivedUpdate && bReceivedUpdate) {
                // Clean up listeners
                socketA.off('partner_context_intent', onPartnerContextIntentA);
                socketB.off('partner_context_intent', onPartnerContextIntentB);
                
                try {
                    expect(bReceivedRequest).to.be.true; // B should see request
                    expect(aReceivedRequest).to.be.false; // A should NOT see request (echo)
                    done();
                } catch (e) {
                    done(e);
                }
            }
        };

        socketA.once('session_updated', () => {
            aReceivedUpdate = true;
            checkDone();
        });

        socketB.once('session_updated', () => {
            bReceivedUpdate = true;
            checkDone();
        });

        // A initiates switch to Exploring
        socketA.emit('context_switch_intent', { context: 'Exploring' });
    });

    // TEST 2: Resume/Rejoin
    it('Should allow Phone B to quit and rejoin same session', async () => {
        // Simulate B quitting (disconnect socket)
        socketB.disconnect();
        
        // Simulate "Rescan" by calling resolveSession
        // We simulate B lost local storage, so no device_token
        // BUT wait, if B lost storage, they are a NEW user (Phone C).
        // The rule says: "B quits browser, scans QR again within 24h, rejoins same context session".
        // If B CLEARED storage (Start Fresh), they are blocked (as tested later).
        // If B just closed browser but KEPT storage, they send device_token.
        
        // Scenario A: B kept storage (Browser Restart)
        const res = await client.post('/sessions/resolve', {
            table_token: tableToken,
            device_token: sessionB.participant_token
        });
        
        expect(res.data.action).to.equal('resume');
        expect(res.data.session_id).to.equal(sessionA.session_id);
        expect(res.data.context).to.equal('Exploring'); // Maintained context (Switched back in Test 1.5)
    });

    // TEST 3: Start Fresh Handshake (One-sided)
    it('Should allow Phone B to Start Fresh (Leave) without ending session', async () => {
        // Reconnect B for this test
        socketB = await connectSocket(sessionB.session_id, sessionB.participant_id);
        
        // Wait for connection to be fully established before emitting
        await new Promise(r => setTimeout(r, 100));

        // B sends fresh intent
        socketB.emit('fresh_intent');
        
        // Wait for processing
        await new Promise(r => setTimeout(r, 100));
        
        // Verify session is NOT ended immediately
        const state = await client.get(`/sessions/${sessionA.session_id}`);
        expect(state.data.dual_status).to.not.equal('ended');
    });

    // TEST 4: Start Fresh Handshake (Mutual)
    it('Should terminate session when Phone A also Starts Fresh', (done) => {
        // A sends fresh intent
        // Need to wrap in promise or ensure listener is active
        
        let received = false;
        
        // Re-setup listener since previous test might have consumed it? No, event fires once.
        socketA.once('dual_group_terminated', () => {
             received = true;
             done();
        });

        // A sends fresh intent
        socketA.emit('fresh_intent');
        
        // Note: Socket B already sent fresh intent in TEST 3.
        // Server state should persist "B: true".
        // Sending A now should trigger completion.
    });

    it('Should verify session is ended in DB', async () => {
        const state = await client.get(`/sessions/${sessionA.session_id}`);
        expect(state.data.dual_status).to.equal('ended');
    });

    it('Should prevent rejoining the ended session', async () => {
        const res = await client.post('/sessions/resolve', {
            table_token: tableToken,
            device_token: sessionA.participant_token
        });
        
        // Should NOT resume. Should Start New.
        // Resolve logic: if resume found but expired/ended? 
        // The query checks `expires_at > NOW()`.
        // We set `expires_at = NOW()` on termination.
        // So it should fail to find active session.
        // Then it falls through to Start New.
        
        expect(res.data.action).to.equal('start_new');
    });
});
