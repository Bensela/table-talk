const request = require('supertest');

jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const app = require('../../index');

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

const ID = {
  active: '11111111-1111-4111-8111-111111111111',
  paid: '22222222-2222-4222-8222-222222222222',
  expiredTrial: '33333333-3333-4333-8333-333333333333',
  expiredPaid: '44444444-4444-4444-8444-444444444444',
  suspended: '55555555-5555-4555-8555-555555555555',
  pendingTrial: '66666666-6666-4666-8666-666666666666',
  convertedFromTrial: '77777777-7777-4777-8777-777777777777'
};

const tenant = (slug, id, overrides = {}) => ({
  id,
  slug,
  name: `Cafe ${slug}`,
  billing_status: 'active',
  plan: 'starter',
  trial_ends_at: null,
  subscription_current_period_end: null,
  latitude: null,
  longitude: null,
  geofence_radius_meters: 100,
  ...overrides
});

const TENANTS = {
  'gap-active': tenant('gap-active', ID.active),
  'gap-paid': tenant('gap-paid', ID.paid, { subscription_current_period_end: iso(10) }),
  'gap-expired-trial': tenant('gap-expired-trial', ID.expiredTrial, { plan: 'trial', trial_ends_at: iso(-5) }),
  'gap-expired-paid': tenant('gap-expired-paid', ID.expiredPaid, { subscription_current_period_end: iso(-2) }),
  'gap-suspended': tenant('gap-suspended', ID.suspended, { billing_status: 'suspended' }),
  'gap-pending-trial': tenant('gap-pending-trial', ID.pendingTrial, { billing_status: 'pending', plan: 'trial', trial_ends_at: iso(5) }),
  'gap-converted': tenant('gap-converted', ID.convertedFromTrial, {
    plan: 'starter',
    trial_ends_at: iso(-30),
    subscription_current_period_end: iso(20)
  })
};

const REGISTERED_TABLES = { 'Table 1': 't-1', '5': 't-5' };

const installDb = () => {
  db.query.mockImplementation((text, params) => {
    const sql = String(text);

    if (sql.includes('FROM restaurants') && sql.includes('WHERE slug = $1')) {
      const row = TENANTS[params[0]];
      return Promise.resolve({ rows: row ? [row] : [] });
    }

    if (sql.includes('FROM restaurant_tables')) {
      const [restaurantId, tableNumber] = params;
      const known = REGISTERED_TABLES[tableNumber];
      return Promise.resolve({
        rows: known && Object.values(ID).includes(restaurantId) ? [{ table_id: known, table_number: tableNumber }] : []
      });
    }

    if (sql.includes('SELECT id FROM restaurants')) {
      // Legacy id/slug resolver used by controllers.
      const byId = Object.values(TENANTS).find((t) => t.id === params[0]);
      return Promise.resolve({ rows: byId ? [{ id: byId.id }] : [{ id: 'd0000000-0000-0000-0000-000000000000' }] });
    }

    if (sql.includes('INSERT INTO sessions')) {
      return Promise.resolve({
        rows: [{ session_id: params[0], table_token: params[1], restaurant_id: params[2], mode: params[4] }]
      });
    }

    return Promise.resolve({ rows: [], rowCount: 1 });
  });
};

const sessionInserts = () =>
  db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO sessions'));

describe('guest access — handshake (public QR scan)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDb();
    delete process.env.GUEST_GEOFENCE_ENABLED;
  });

  test('active restaurant + registered table → 200', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-active&table=5');
    expect(res.status).toBe(200);
    expect(res.body.restaurant_slug).toBe('gap-active');
  });

  test('active paid restaurant inside its period → 200', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-paid&table=5');
    expect(res.status).toBe(200);
  });

  test('restaurant converted from a trial keeps access (retained trial_ends_at is ignored on paid plans)', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-converted&table=5');
    expect(res.status).toBe(200);
  });

  test('pending trial that has not ended → 200 (existing legitimate trial state)', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-pending-trial&table=5');
    expect(res.status).toBe(200);
  });

  test('EXPIRED trial with billing_status still "active" → 403, not 200 and not 404', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-expired-trial&table=5');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Service is temporarily undergoing maintenance');
  });

  test('EXPIRED paid subscription → 403', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-expired-paid&table=5');
    expect(res.status).toBe(403);
  });

  test('suspended → 403', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-suspended&table=5');
    expect(res.status).toBe(403);
  });

  test('unknown restaurant → 404 (invalid QR is not confused with inactive subscription)', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-does-not-exist&table=5');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Restaurant not found');
  });

  test('active restaurant + unregistered table → 404', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-active&table=99');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Table not registered');
  });

  test('cross-tenant: a table registered for another tenant is not accepted', async () => {
    db.query.mockImplementation((text, params) => {
      const sql = String(text);
      if (sql.includes('FROM restaurants') && sql.includes('WHERE slug = $1')) {
        const row = TENANTS[params[0]];
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (sql.includes('FROM restaurant_tables')) {
        // Table exists only for the "paid" tenant.
        return Promise.resolve({ rows: params[0] === ID.paid ? [{ table_id: 't', table_number: params[1] }] : [] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const own = await request(app).get('/api/public/handshake?slug=gap-paid&table=5');
    const other = await request(app).get('/api/public/handshake?slug=gap-active&table=5');
    expect(own.status).toBe(200);
    expect(other.status).toBe(404);
  });

  test('table names containing a space resolve when the query is encoded once', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-active&table=Table%201');
    expect(res.status).toBe(200);
    expect(res.body.table_number).toBe('Table 1');
  });

  test('a double-encoded table name does not resolve (documents why the client must encode once)', async () => {
    const res = await request(app).get('/api/public/handshake?slug=gap-active&table=Table%25201');
    expect(res.status).toBe(404);
  });
});

describe('guest access — direct API calls cannot bypass enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDb();
  });

  const create = (body, path = '/api/sessions') =>
    request(app).post(path).send({ table_token: '5', mode: 'single-phone', ...body });

  test('active restaurant can create a session', async () => {
    const res = await create({ restaurant_slug: 'gap-active' });
    expect(res.status).toBe(201);
    expect(sessionInserts()).toHaveLength(1);
  });

  test.each([
    ['expired trial', 'gap-expired-trial'],
    ['expired paid subscription', 'gap-expired-paid'],
    ['suspended', 'gap-suspended']
  ])('%s → 403 and no session row is written', async (_label, slug) => {
    const res = await create({ restaurant_slug: slug });
    expect(res.status).toBe(403);
    expect(sessionInserts()).toHaveLength(0);
  });

  test('unknown restaurant → 404, no session row', async () => {
    const res = await create({ restaurant_slug: 'gap-does-not-exist' });
    expect(res.status).toBe(404);
    expect(sessionInserts()).toHaveLength(0);
  });

  test('missing restaurant_slug → 400', async () => {
    const res = await create({});
    expect(res.status).toBe(400);
  });

  test('CROSS-TENANT: an active slug cannot be paired with another tenant\'s restaurant_id', async () => {
    const res = await create({ restaurant_slug: 'gap-active', restaurant_id: ID.expiredTrial });
    expect(res.status).toBe(201);
    const [, params] = sessionInserts()[0];
    expect(params[2]).toBe(ID.active); // never the expired tenant
    expect(res.body.restaurant_id).toBe(ID.active);
  });

  test('CROSS-TENANT: an expired slug is denied even when an active restaurant_id is supplied', async () => {
    const res = await create({ restaurant_slug: 'gap-expired-trial', restaurant_id: ID.active });
    expect(res.status).toBe(403);
    expect(sessionInserts()).toHaveLength(0);
  });

  test.each([
    ['/api/sessions/resolve', { table_token: '5' }],
    ['/api/sessions/join-dual', { table_token: '5', code: 'ABCD' }],
    ['/api/sessions/resume-by-qr', { table_token: '5', participant_token: 'x' }]
  ])('%s denies an expired restaurant', async (path, body) => {
    const res = await request(app).post(path).send({ restaurant_slug: 'gap-expired-trial', ...body });
    expect(res.status).toBe(403);
  });

  test('resolve uses the authorized restaurant, not a body-supplied restaurant_id', async () => {
    await request(app)
      .post('/api/sessions/resolve')
      .send({ restaurant_slug: 'gap-active', restaurant_id: ID.expiredTrial, table_token: '5' });

    const opportunity = db.query.mock.calls.find(
      ([sql]) => String(sql).includes("dual_status = 'waiting'") && String(sql).includes('SELECT 1')
    );
    expect(opportunity).toBeDefined();
    expect(opportunity[1]).toEqual(['5', ID.active]);
  });
});

describe('local / production routing parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDb();
  });

  test('handshake answers identically on /api/public and the bare /public alias', async () => {
    const viaApi = await request(app).get('/api/public/handshake?slug=gap-active&table=5');
    const bare = await request(app).get('/public/handshake?slug=gap-active&table=5');
    expect(viaApi.status).toBe(200);
    expect(bare.status).toBe(200);
    expect(bare.body.restaurant_slug).toBe(viaApi.body.restaurant_slug);
  });

  test('inactive restaurants are denied identically on both route families', async () => {
    const viaApi = await request(app).get('/api/public/handshake?slug=gap-expired-trial&table=5');
    const bare = await request(app).get('/public/handshake?slug=gap-expired-trial&table=5');
    expect(viaApi.status).toBe(403);
    expect(bare.status).toBe(403);
  });

  test('session creation is gated identically on /api/sessions and /sessions', async () => {
    const viaApi = await request(app).post('/api/sessions').send({ table_token: '5', restaurant_slug: 'gap-expired-trial' });
    const bare = await request(app).post('/sessions').send({ table_token: '5', restaurant_slug: 'gap-expired-trial' });
    expect(viaApi.status).toBe(403);
    expect(bare.status).toBe(403);
  });

  test('unknown API paths under /api are not swallowed as an HTML page for JSON endpoints', async () => {
    const res = await request(app).get('/api/public/handshake');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
