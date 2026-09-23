const request = require('supertest');
const crypto = require('crypto');

jest.mock('../../db', () => ({
  query: jest.fn()
}));

const db = require('../../db');
const { joinAttempts } = require('../../middleware/rateLimiter');
const app = require('../../index');

const RESTAURANT_ID = 'd0000000-0000-0000-0000-000000000000';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_GROUP_ID = '22222222-2222-4222-8222-222222222222';
const TABLE_TOKEN = 'table-pairing-1';
const CODE = 'ABCD';

const pairingHash = (code, sessionId) => {
  const salt = process.env.SECRET_SALT || 'default_salt';
  return crypto
    .createHash('sha256')
    .update(code + sessionId + salt)
    .digest('hex');
};

const restaurantRow = (slug = 'test-cafe') => ({
  id: RESTAURANT_ID,
  slug,
  name: 'Test Cafe',
  billing_status: 'active',
  contact_email: null,
  contact_phone: null,
  address: null,
  latitude: null,
  longitude: null,
  manager_name: null
});

const waitingCandidate = (overrides = {}) => ({
  session_id: SESSION_ID,
  restaurant_id: RESTAURANT_ID,
  table_token: TABLE_TOKEN,
  context: 'Established',
  mode: 'dual-phone',
  session_group_id: SESSION_GROUP_ID,
  dual_status: 'waiting',
  pairing_code_hash: pairingHash(CODE, SESSION_ID),
  pairing_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  ...overrides
});

const claimedSession = (overrides = {}) => ({
  session_id: SESSION_ID,
  restaurant_id: RESTAURANT_ID,
  table_token: TABLE_TOKEN,
  context: 'Established',
  mode: 'dual-phone',
  session_group_id: SESSION_GROUP_ID,
  dual_status: 'paired',
  ...overrides
});

const installDbBehavior = ({
  candidates = [],
  claimRows = [],
  claimError = null,
  pairingOpportunity = [],
  activeDualSession = [],
  activeTokenSession = []
} = {}) => {
  db.query.mockImplementation((text, params) => {
    if (
      typeof text === 'string' &&
      text.includes('FROM restaurants') &&
      text.includes('billing_status') &&
      text.includes('WHERE slug = $1')
    ) {
      return Promise.resolve({
        rows: [restaurantRow(params?.[0])]
      });
    }

    if (
      typeof text === 'string' &&
      text.includes('SELECT id FROM restaurants')
    ) {
      return Promise.resolve({
        rows: [{ id: RESTAURANT_ID }]
      });
    }

    if (
      typeof text === 'string' &&
      text.includes('SELECT session_id, restaurant_id, table_token, context, mode') &&
      text.includes("pairing_code_hash IS NOT NULL") &&
      text.includes("ORDER BY created_at DESC")
    ) {
      return Promise.resolve({ rows: candidates });
    }

    if (
      typeof text === 'string' &&
      text.includes('WITH claimed AS (') &&
      text.includes('INSERT INTO session_participants')
    ) {
      if (claimError) {
        return Promise.reject(claimError);
      }

      return Promise.resolve({ rows: claimRows });
    }

    if (
      typeof text === 'string' &&
      text.includes('FROM sessions') &&
      text.includes("dual_status = 'waiting'") &&
      text.includes('pairing_code_hash IS NOT NULL') &&
      text.includes('SELECT 1')
    ) {
      return Promise.resolve({ rows: pairingOpportunity });
    }

    if (
      typeof text === 'string' &&
      text.includes('FROM sessions') &&
      text.includes("dual_status = 'paired'") &&
      text.includes('SELECT 1')
    ) {
      return Promise.resolve({ rows: activeDualSession });
    }

    if (
      typeof text === 'string' &&
      text.includes('JOIN session_participants') &&
      text.includes('participant_token_hash')
    ) {
      return Promise.resolve({ rows: activeTokenSession });
    }

    // Analytics and unrelated defensive queries.
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
};

describe('Catalyst dual-phone pairing behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    joinAttempts.clear();
  });

  describe('POST /api/sessions/join-dual', () => {
    test('rejects malformed pairing codes before candidate lookup', async () => {
      installDbBehavior();

      const res = await request(app)
        .post('/api/sessions/join-dual')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          code: 'A1CD'
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PAIRING_CODE_INVALID');

      const candidateQueries = db.query.mock.calls.filter(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('pairing_code_hash IS NOT NULL') &&
          sql.includes('ORDER BY created_at DESC')
      );

      expect(candidateQueries).toHaveLength(0);
    });

    test('normalizes lowercase code and successfully redeems Phone B', async () => {
      installDbBehavior({
        candidates: [waitingCandidate()],
        claimRows: [claimedSession()]
      });

      const res = await request(app)
        .post('/api/sessions/join-dual')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          code: 'abcd'
        });

      expect(res.status).toBe(200);
      expect(res.body.session_id).toBe(SESSION_ID);
      expect(res.body.session_group_id).toBe(SESSION_GROUP_ID);
      expect(res.body.context).toBe('Established');
      expect(res.body.mode).toBe('dual-phone');
      expect(res.body.dual_status).toBe('paired');
      expect(res.body.participant_id).toBeDefined();
      expect(res.body.participant_token).toBeDefined();

      const candidateCall = db.query.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('pairing_code_hash IS NOT NULL') &&
          sql.includes('ORDER BY created_at DESC')
      );

      expect(candidateCall).toBeDefined();
      expect(candidateCall[1]).toEqual([RESTAURANT_ID, TABLE_TOKEN]);

      const claimCall = db.query.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('WITH claimed AS (') &&
          sql.includes('INSERT INTO session_participants')
      );

      expect(claimCall).toBeDefined();
      expect(claimCall[1][0]).toBe(SESSION_ID);
      expect(claimCall[1][1]).toBe(RESTAURANT_ID);
      expect(claimCall[1][2]).toBe(TABLE_TOKEN);
      expect(claimCall[1][3]).toBe(pairingHash(CODE, SESSION_ID));
      expect(claimCall[1][4]).toBe(res.body.participant_id);
      expect(claimCall[1][5]).toMatch(/^[a-f0-9]{64}$/);
    });

    test('does not reveal whether a session exists when code does not match', async () => {
      installDbBehavior({
        candidates: [waitingCandidate()]
      });

      const res = await request(app)
        .post('/api/sessions/join-dual')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          code: 'WXYZ'
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PAIRING_CODE_INVALID');
      expect(res.body.error).toBe('Invalid or expired pairing code.');

      const claimCalls = db.query.mock.calls.filter(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('WITH claimed AS (')
      );

      expect(claimCalls).toHaveLength(0);
    });

    test('returns the same generic rejection when no live candidate exists', async () => {
      installDbBehavior({ candidates: [] });

      const res = await request(app)
        .post('/api/sessions/join-dual')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          code: CODE
        });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        code: 'PAIRING_CODE_INVALID',
        error: 'Invalid or expired pairing code.'
      });
    });

    test('candidate discovery is tenant and table scoped', async () => {
      installDbBehavior({ candidates: [] });

      await request(app)
        .post('/api/sessions/join-dual')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: 'different-table',
          code: CODE
        });

      const candidateCall = db.query.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('pairing_code_hash IS NOT NULL') &&
          sql.includes('ORDER BY created_at DESC')
      );

      expect(candidateCall).toBeDefined();

      const [sql, params] = candidateCall;

      expect(sql).toContain('restaurant_id = $1');
      expect(sql).toContain('table_token = $2');
      expect(sql).toContain("mode = 'dual-phone'");
      expect(sql).toContain("dual_status = 'waiting'");
      expect(sql).toContain('pairing_expires_at > NOW()');
      expect(sql).toContain('expires_at > NOW()');

      expect(params).toEqual([
        RESTAURANT_ID,
        'different-table'
      ]);
    });

    test('returns 409 when atomic claim loses a concurrent redemption race', async () => {
      installDbBehavior({
        candidates: [waitingCandidate()],
        claimRows: []
      });

      const res = await request(app)
        .post('/api/sessions/join-dual')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          code: CODE
        });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: 'SESSION_FULL',
        code: 'PAIRING_ALREADY_CLAIMED'
      });
    });

    test('maps unique role-B constraint collision to already claimed', async () => {
      const uniqueError = new Error('duplicate key');
      uniqueError.code = '23505';

      installDbBehavior({
        candidates: [waitingCandidate()],
        claimError: uniqueError
      });

      const res = await request(app)
        .post('/api/sessions/join-dual')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          code: CODE
        });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: 'SESSION_FULL',
        code: 'PAIRING_ALREADY_CLAIMED'
      });
    });

    test('atomic claim consumes pairing credentials and inserts only role B', async () => {
      installDbBehavior({
        candidates: [waitingCandidate()],
        claimRows: [claimedSession()]
      });

      const res = await request(app)
        .post('/api/sessions/join-dual')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          code: CODE
        });

      expect(res.status).toBe(200);

      const claimCall = db.query.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('WITH claimed AS (')
      );

      expect(claimCall).toBeDefined();

      const [sql] = claimCall;

      expect(sql).toContain("SET dual_status = 'paired'");
      expect(sql).toContain('pairing_code_hash = NULL');
      expect(sql).toContain('pairing_expires_at = NULL');
      expect(sql).toContain("SELECT $5, session_id, 'B', $6, NOW(), NULL");
      expect(sql).toContain("dual_status = 'waiting'");
      expect(sql).toContain('pairing_code_hash = $4');
      expect(sql).toContain('pairing_expires_at > NOW()');
    });
  });

  describe('POST /api/sessions/resolve', () => {
    test('unknown Phone B is offered code entry without receiving a session id', async () => {
      installDbBehavior({
        pairingOpportunity: [{ '?column?': 1 }]
      });

      const res = await request(app)
        .post('/api/sessions/resolve')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        action: 'enter_join_code'
      });
      expect(res.body.session_id).toBeUndefined();
      expect(res.body.participant_id).toBeUndefined();
      expect(res.body.role).toBeUndefined();
    });

    test('unknown Phone C gets start_new when existing dual session is already paired', async () => {
      installDbBehavior({
        pairingOpportunity: [],
        activeDualSession: [{ '?column?': 1 }]
      });

      const res = await request(app)
        .post('/api/sessions/resolve')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        action: 'start_new',
        reason: 'dual_session_full'
      });
      expect(res.body.session_id).toBeUndefined();
    });

    test('Start Fresh waiting state without a live pairing hash falls through to start_new', async () => {
      installDbBehavior({
        pairingOpportunity: [],
        activeDualSession: []
      });

      const res = await request(app)
        .post('/api/sessions/resolve')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        action: 'start_new'
      });

      const opportunityCall = db.query.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes("dual_status = 'waiting'") &&
          sql.includes('pairing_code_hash IS NOT NULL') &&
          sql.includes('SELECT 1')
      );

      expect(opportunityCall).toBeDefined();
    });
    test('explicit new-session intent declines an available pairing opportunity', async () => {
      installDbBehavior({
        pairingOpportunity: [{ '?column?': 1 }]
      });

      const res = await request(app)
        .post('/api/sessions/resolve')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          prefer_new_session: true
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        action: 'start_new'
      });

      expect(res.body.session_id).toBeUndefined();
      expect(res.body.participant_id).toBeUndefined();
      expect(res.body.role).toBeUndefined();
    });

    test('false explicit-new intent does not suppress pairing-code entry', async () => {
      installDbBehavior({
        pairingOpportunity: [{ '?column?': 1 }]
      });

      const res = await request(app)
        .post('/api/sessions/resolve')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          prefer_new_session: false
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        action: 'enter_join_code'
      });
    });

    test.each([
      ['string true', 'true'],
      ['numeric one', 1]
    ])(
      'non-boolean explicit-new value %s cannot enable the override',
      async (_label, value) => {
        installDbBehavior({
          pairingOpportunity: [{ '?column?': 1 }]
        });

        const res = await request(app)
          .post('/api/sessions/resolve')
          .send({
            restaurant_slug: 'test-cafe',
            table_token: TABLE_TOKEN,
            prefer_new_session: value
          });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          action: 'enter_join_code'
        });
      }
    );

    test('explicit-new intent does not consume or mutate the pairing opportunity', async () => {
      installDbBehavior({
        pairingOpportunity: [{ '?column?': 1 }]
      });

      const declineRes = await request(app)
        .post('/api/sessions/resolve')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          prefer_new_session: true
        });

      expect(declineRes.status).toBe(200);
      expect(declineRes.body).toEqual({
        action: 'start_new'
      });

      const normalRes = await request(app)
        .post('/api/sessions/resolve')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN
        });

      expect(normalRes.status).toBe(200);
      expect(normalRes.body).toEqual({
        action: 'enter_join_code'
      });

      const destructivePairingCalls = db.query.mock.calls.filter(
        ([sql]) =>
          typeof sql === 'string' &&
          /(?:UPDATE|DELETE)\s+sessions/i.test(sql) &&
          (
            sql.includes('pairing_code_hash') ||
            sql.includes('pairing_expires_at')
          )
      );

      expect(destructivePairingCalls).toHaveLength(0);
    });

    test('pairing opportunity remains restaurant and table scoped with explicit-new intent', async () => {
      installDbBehavior({
        pairingOpportunity: [{ '?column?': 1 }]
      });

      await request(app)
        .post('/api/sessions/resolve')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          prefer_new_session: true
        });

      const opportunityCall = db.query.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes("dual_status = 'waiting'") &&
          sql.includes('pairing_code_hash IS NOT NULL') &&
          sql.includes('SELECT 1')
      );

      expect(opportunityCall).toBeDefined();

      const [sql, params] = opportunityCall;

      expect(sql).toContain('table_token = $1');
      expect(sql).toContain('restaurant_id = $2');
      expect(params).toEqual([TABLE_TOKEN, RESTAURANT_ID]);
    });

    test('known participant identity remains authoritative when explicit-new is requested', async () => {
      const participantToken = 'known-participant-token';

      installDbBehavior({
        pairingOpportunity: [{ '?column?': 1 }],
        activeTokenSession: [{
          session_id: SESSION_ID,
          restaurant_id: RESTAURANT_ID,
          table_token: TABLE_TOKEN,
          mode: 'single-phone',
          dual_status: null,
          role: 'A',
          participant_id: 'participant-known-a',
          context: 'Established',
          created_at: new Date().toISOString()
        }]
      });

      const res = await request(app)
        .post('/api/sessions/resolve')
        .send({
          restaurant_slug: 'test-cafe',
          table_token: TABLE_TOKEN,
          device_token: participantToken,
          prefer_new_session: true
        });

      expect(res.status).toBe(200);

      expect(res.body).toMatchObject({
        action: 'resume',
        session_id: SESSION_ID,
        participant_id: 'participant-known-a',
        role: 'A'
      });

      expect(res.body.action).not.toBe('start_new');
      expect(res.body.action).not.toBe('enter_join_code');
    });
  });
});