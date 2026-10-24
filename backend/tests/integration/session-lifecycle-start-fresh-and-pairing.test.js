const request = require('supertest');

const backend = require('../../index');
const db = require('../../db');
const { cleanupSessions } = require('../../jobs/cleanup');

const app = backend;
const server = backend.server;

jest.setTimeout(30000);

const RESTAURANT_SLUG = 'default';

async function createDualSession(tableToken) {
  return request(app).post('/api/sessions').send({
    table_token: tableToken,
    mode: 'dual-phone',
    context: 'Exploring',
    restaurant_slug: RESTAURANT_SLUG
  });
}

describe('Catalyst: Start Afresh race + pairing timeout/cancel lifecycle', () => {
  let createdSessionIds = [];

  beforeAll(async () => {
    if (!server.listening) {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    }
  });

  afterEach(async () => {
    for (const id of createdSessionIds) {
      try { await db.query('DELETE FROM session_participants WHERE session_id = $1', [id]); } catch (_) {}
      try { await db.query('DELETE FROM dual_groups WHERE active_session_id = $1', [id]); } catch (_) {}
      try { await db.query('DELETE FROM sessions WHERE session_id = $1', [id]); } catch (_) {}
    }
    createdSessionIds = [];
  });

  afterAll(async () => {
    if (server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('BUG 2: unjoined pairing-code attempt', () => {
    test('backend cron authoritatively expires an unredeemed pairing code at its own 5-minute mark (not the 30-minute waiting rule)', async () => {
      const tableToken = `BUG2_EXPIRE_${Date.now()}`;
      const createRes = await createDualSession(tableToken);
      expect(createRes.status).toBe(201);
      const { session_id } = createRes.body;
      createdSessionIds.push(session_id);

      // Pairing window elapsed, but nowhere near the 30-minute "waiting" cleanup rule.
      await db.query(
        `UPDATE sessions SET pairing_expires_at = NOW() - INTERVAL '1 minute' WHERE session_id = $1`,
        [session_id]
      );

      await cleanupSessions('test');

      const row = (await db.query(
        `SELECT dual_status, pairing_code_hash, pairing_expires_at FROM sessions WHERE session_id = $1`,
        [session_id]
      )).rows[0];

      expect(row.dual_status).toBe('ended');
      expect(row.pairing_code_hash).toBeNull();
    });

    test('resolveSession never resumes a pairing attempt whose 5-minute window has passed, even before the cron tick runs', async () => {
      const tableToken = `BUG2_GAP_${Date.now()}`;
      const createRes = await createDualSession(tableToken);
      const { session_id, participant_token } = createRes.body;
      createdSessionIds.push(session_id);

      // Expired 1 second ago; cron has NOT run yet (dual_status is still 'waiting').
      await db.query(
        `UPDATE sessions SET pairing_expires_at = NOW() - INTERVAL '1 second' WHERE session_id = $1`,
        [session_id]
      );

      const resolveRes = await request(app).post('/api/sessions/resolve').send({
        table_token: tableToken,
        restaurant_slug: RESTAURANT_SLUG,
        device_token: participant_token
      });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.action).not.toBe('resume');
    });

    test('Cancel & Return to Scanner ends an unredeemed pairing attempt immediately', async () => {
      const tableToken = `BUG2_CANCEL_${Date.now()}`;
      const createRes = await createDualSession(tableToken);
      const { session_id, participant_id } = createRes.body;
      createdSessionIds.push(session_id);

      const cancelRes = await request(app)
        .post(`/api/sessions/${session_id}/cancel-pairing`)
        .send({ participant_id });

      expect(cancelRes.status).toBe(200);

      const row = (await db.query(
        `SELECT dual_status, pairing_code_hash FROM sessions WHERE session_id = $1`,
        [session_id]
      )).rows[0];

      expect(row.dual_status).toBe('ended');
      expect(row.pairing_code_hash).toBeNull();
    });

    test('a stale cancel never terminates a session that became paired first', async () => {
      const tableToken = `BUG2_SAFE_${Date.now()}`;
      const createRes = await createDualSession(tableToken);
      const { session_id, participant_id, pairing_code } = createRes.body;
      createdSessionIds.push(session_id);

      const joinRes = await request(app).post('/api/sessions/join-dual').send({
        table_token: tableToken,
        code: pairing_code,
        restaurant_slug: RESTAURANT_SLUG
      });
      expect(joinRes.status).toBe(200);

      const cancelRes = await request(app)
        .post(`/api/sessions/${session_id}/cancel-pairing`)
        .send({ participant_id });

      expect(cancelRes.status).toBe(200);

      const row = (await db.query(
        `SELECT dual_status FROM sessions WHERE session_id = $1`,
        [session_id]
      )).rows[0];

      expect(row.dual_status).toBe('paired');
    });

    test('cancel-pairing is idempotent across duplicate/concurrent requests', async () => {
      const tableToken = `BUG2_IDEMPOTENT_${Date.now()}`;
      const createRes = await createDualSession(tableToken);
      const { session_id, participant_id } = createRes.body;
      createdSessionIds.push(session_id);

      const [first, second] = await Promise.all([
        request(app).post(`/api/sessions/${session_id}/cancel-pairing`).send({ participant_id }),
        request(app).post(`/api/sessions/${session_id}/cancel-pairing`).send({ participant_id })
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const row = (await db.query(
        `SELECT dual_status FROM sessions WHERE session_id = $1`,
        [session_id]
      )).rows[0];
      expect(row.dual_status).toBe('ended');
    });

    test('same-QR re-entry after cancellation starts a genuinely fresh session, not a stale pairing/waiting screen', async () => {
      const tableToken = `BUG2_REENTRY_${Date.now()}`;
      const createRes = await createDualSession(tableToken);
      const { session_id, participant_id } = createRes.body;
      createdSessionIds.push(session_id);

      await request(app).post(`/api/sessions/${session_id}/cancel-pairing`).send({ participant_id });

      const resolveRes = await request(app).post('/api/sessions/resolve').send({
        table_token: tableToken,
        restaurant_slug: RESTAURANT_SLUG
      });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.action).toBe('start_new');
    });
  });

  describe('BUG 1: both phones press Start Afresh', () => {
    async function createPairedDualSession(tableToken) {
      const createRes = await createDualSession(tableToken);
      const { session_id, participant_id: participantA, participant_token: tokenA, pairing_code } = createRes.body;

      const joinRes = await request(app).post('/api/sessions/join-dual').send({
        table_token: tableToken,
        code: pairing_code,
        restaurant_slug: RESTAURANT_SLUG
      });

      return {
        session_id,
        participantA,
        tokenA,
        participantB: joinRes.body.participant_id,
        tokenB: joinRes.body.participant_token
      };
    }

    test('A restarts, B restarts before the 20s window: an immediate rescan by a brand-new device starts fresh', async () => {
      const tableToken = `BUG1_MUTUAL_NEW_${Date.now()}`;
      const { session_id, participantA, participantB } = await createPairedDualSession(tableToken);
      createdSessionIds.push(session_id);

      await request(app).post(`/api/sessions/${session_id}/fresh_intent`).send({ participant_id: participantA });
      await request(app).post(`/api/sessions/${session_id}/fresh_intent`).send({ participant_id: participantB });

      const resolveRes = await request(app).post('/api/sessions/resolve').send({
        table_token: tableToken,
        restaurant_slug: RESTAURANT_SLUG
      });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.action).toBe('start_new');
    });

    test("A restarts, B restarts before the 20s window: Phone A's own device_token does not resume the mutually-ended session", async () => {
      const tableToken = `BUG1_MUTUAL_OWN_${Date.now()}`;
      const { session_id, participantA, participantB, tokenA } = await createPairedDualSession(tableToken);
      createdSessionIds.push(session_id);

      await request(app).post(`/api/sessions/${session_id}/fresh_intent`).send({ participant_id: participantA });
      await request(app).post(`/api/sessions/${session_id}/fresh_intent`).send({ participant_id: participantB });

      const resolveRes = await request(app).post('/api/sessions/resolve').send({
        table_token: tableToken,
        restaurant_slug: RESTAURANT_SLUG,
        device_token: tokenA
      });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.action).not.toBe('resume');
    });

    test('A restarts, B does nothing: within the 20s window A alone still sees the dual session as waiting (existing behavior preserved)', async () => {
      const tableToken = `BUG1_SINGLE_WAIT_${Date.now()}`;
      const { session_id, participantA } = await createPairedDualSession(tableToken);
      createdSessionIds.push(session_id);

      const freshRes = await request(app).post(`/api/sessions/${session_id}/fresh_intent`).send({ participant_id: participantA });
      expect(freshRes.status).toBe(200);
      expect(freshRes.body.terminated).toBe(false);

      const row = (await db.query(
        `SELECT dual_status, fresh_intent_a, fresh_intent_b FROM sessions WHERE session_id = $1`,
        [session_id]
      )).rows[0];

      expect(row.dual_status).toBe('waiting');
      expect(Boolean(row.fresh_intent_a)).not.toBe(Boolean(row.fresh_intent_b));
    });

    test('a one-sided Start Fresh older than 20s (e.g. the server timer missed it) must not be resumed on rescan', async () => {
      const tableToken = `BUG1_STALE_SINGLE_${Date.now()}`;
      const { session_id, participantA, tokenB } = await createPairedDualSession(tableToken);
      createdSessionIds.push(session_id);

      await request(app).post(`/api/sessions/${session_id}/fresh_intent`).send({ participant_id: participantA });

      // Simulate the 20s server-side timer having missed its own window
      // (e.g. a backend restart), exactly as the existing resolveSession
      // comment describes: "backend restart + partner never reconnected
      // within 20s window" should NOT resume as if nothing happened.
      await db.query(
        `UPDATE sessions SET fresh_intent_at = NOW() - INTERVAL '25 seconds' WHERE session_id = $1`,
        [session_id]
      );

      const resolveRes = await request(app).post('/api/sessions/resolve').send({
        table_token: tableToken,
        restaurant_slug: RESTAURANT_SLUG,
        device_token: tokenB
      });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.action).not.toBe('resume');
    });

    test('neither phone restarts: resume-by-device-token still works normally (no regression)', async () => {
      const tableToken = `BUG1_RESUME_NORMAL_${Date.now()}`;
      const { session_id, tokenA } = await createPairedDualSession(tableToken);
      createdSessionIds.push(session_id);

      const resolveRes = await request(app).post('/api/sessions/resolve').send({
        table_token: tableToken,
        restaurant_slug: RESTAURANT_SLUG,
        device_token: tokenA
      });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.action).toBe('resume');
      expect(resolveRes.body.session_id).toBe(session_id);
    });
  });
});
