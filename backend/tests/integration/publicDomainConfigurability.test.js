// Release verification: changing the configured canonical public domain must
// change newly generated links (here: a Super Admin onboarding invite URL)
// with NO source-code change — only configuration — and must never fall back
// to the old unrelated tabletalk.app domain. Also verifies the documented
// precedence: Super Admin DB setting > process.env.FRONTEND_URL (the
// DigitalOcean app-spec env var) > built-in default.
const request = require('supertest');

// Not testing QR pixel rendering here, only the resolved invite URL — mock
// out the real (CPU-bound) QRCode.toDataURL so this suite stays fast and
// deterministic under parallel test-worker load.
jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,stub')
}));

jest.mock('../../db', () => {
  const mockQuery = jest.fn(() => {
    const nextMock = mockQuery._queue.shift();
    if (nextMock) return nextMock;
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  mockQuery._queue = [];
  mockQuery.mockResolvedValueOnce = (val) => {
    mockQuery._queue.push(Promise.resolve(val));
    return mockQuery;
  };
  return { query: mockQuery };
});

jest.mock('../../services/platformSettingsService', () => ({
  getPaymentGatewayPublic: jest.fn()
}));

const db = require('../../db');
const platformSettings = require('../../services/platformSettingsService');
const app = require('../../index');
const { signToken } = require('../../middleware/authMiddleware');

const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

function queueCreateTenantInviteHappyPath() {
  // activeInvite check, existingUser check, slug-uniqueness check: all empty.
  // rowCount must be explicit — adminController checks `.rowCount === 0`,
  // and a plain `{ rows: [] }` leaves rowCount `undefined`, which fails that
  // check and spins ensureUniqueRestaurantSlug's loop forever.
  db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
  db.query.mockResolvedValueOnce({
    rows: [{ id: 'r-new', name: 'Test Bistro', slug: 'test-bistro', plan: 'trial', billing_status: 'pending', trial_ends_at: new Date().toISOString(), created_at: new Date().toISOString() }],
    rowCount: 1
  }); // INSERT restaurants
  db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT restaurant_invites
  db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT
}

describe('Release verification: canonical public domain is configuration, not source code', () => {
  const superAdminToken = signToken({ id: 'u-super', email: 'superadmin@example.com', role: 'SUPER_ADMIN', restaurant_id: null });

  afterEach(() => {
    jest.clearAllMocks();
    if (ORIGINAL_FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
  });

  it('follows the Super Admin-configured frontend_url (test origin A) with no code change', async () => {
    platformSettings.getPaymentGatewayPublic.mockResolvedValue({ frontend_url: 'https://staging-a.catalyst-test.example.com' });
    queueCreateTenantInviteHappyPath();

    const res = await request(app)
      .post('/api/admin/tenants/invites')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Test Bistro A', email: 'owner-a@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.invite.url).toBe('https://staging-a.catalyst-test.example.com/subscribe/' + res.body.invite.url.split('/subscribe/')[1]);
    expect(res.body.invite.url).not.toContain('tabletalk.app');
  });

  it('follows a DIFFERENT Super Admin-configured frontend_url (test origin B) — proves this is configuration, not a hardcoded domain', async () => {
    platformSettings.getPaymentGatewayPublic.mockResolvedValue({ frontend_url: 'https://staging-b.catalyst-test.example.com' });
    queueCreateTenantInviteHappyPath();

    const res = await request(app)
      .post('/api/admin/tenants/invites')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Test Bistro B', email: 'owner-b@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.invite.url.startsWith('https://staging-b.catalyst-test.example.com/subscribe/')).toBe(true);
    expect(res.body.invite.url).not.toContain('tabletalk.app');
  });

  it('precedence: DB setting wins over process.env.FRONTEND_URL (the DigitalOcean env var) when both are set', async () => {
    process.env.FRONTEND_URL = 'https://env-only.catalyst-test.example.com';
    platformSettings.getPaymentGatewayPublic.mockResolvedValue({ frontend_url: 'https://db-configured.catalyst-test.example.com' });
    queueCreateTenantInviteHappyPath();

    const res = await request(app)
      .post('/api/admin/tenants/invites')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Test Bistro C', email: 'owner-c@example.com' });

    expect(res.body.invite.url.startsWith('https://db-configured.catalyst-test.example.com/subscribe/')).toBe(true);
  });

  // The process.env.FRONTEND_URL (DigitalOcean) fallback precedence is
  // captured once at module load — correct for a real deployment, where DO
  // sets it before the Node process starts, same as every other env-derived
  // const in this codebase. That precedence is verified in isolation (fresh
  // module graph, not this already-running `app`) in
  // tests/billingServiceFrontendUrl.test.js and tests/publicUrlResolver.test.js.

  it('never falls back to the unrelated tabletalk.app domain when nothing is configured anywhere', async () => {
    delete process.env.FRONTEND_URL;
    platformSettings.getPaymentGatewayPublic.mockResolvedValue({ frontend_url: '' });
    queueCreateTenantInviteHappyPath();

    const res = await request(app)
      .post('/api/admin/tenants/invites')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Test Bistro E', email: 'owner-e@example.com' });

    expect(res.body.invite.url.startsWith('https://catalyst.madetoconnect.co/subscribe/')).toBe(true);
    expect(res.body.invite.url).not.toContain('tabletalk.app');
  });
});
