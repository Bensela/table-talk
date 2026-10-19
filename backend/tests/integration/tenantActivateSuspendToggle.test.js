// End-to-end release verification for the Super Admin Activate/Suspend fix:
// a NEWLY ONBOARDED restaurant (created with a 14-day trial_ends_at, exactly
// like adminController.createTenant/createTenantInvite seed it) must toggle
// Activate -> Suspend -> Activate correctly at the HTTP layer, with billing_status
// persisted and returned accurately alongside the trial-aware computed_status —
// and guest access must track billing_status (never get stuck on "trialing").
const request = require('supertest');
const app = require('../../index');
const { signToken } = require('../../middleware/authMiddleware');
const { evaluateGuestAccess } = require('../../services/guestAccessPolicy');

jest.mock('../../db', () => {
  const mockQuery = jest.fn((text, params) => {
    if (text && text.includes('information_schema.columns') && text.includes(`table_name = 'restaurants'`)) {
      return Promise.resolve({
        rows: [
          { column_name: 'plan' },
          { column_name: 'billing_status' },
          { column_name: 'billing_provider' },
          { column_name: 'trial_ends_at' },
          { column_name: 'subscription_current_period_end' },
          { column_name: 'subscription_cancel_at_period_end' },
          { column_name: 'contact_email' },
          { column_name: 'contact_phone' },
          { column_name: 'address' },
          { column_name: 'latitude' },
          { column_name: 'longitude' },
          { column_name: 'manager_name' }
        ]
      });
    }
    const nextMock = mockQuery._queue.shift();
    if (nextMock) return nextMock;
    return Promise.resolve({ rows: [] });
  });
  mockQuery._queue = [];
  mockQuery.mockResolvedValueOnce = (val) => {
    mockQuery._queue.push(Promise.resolve(val));
    return mockQuery;
  };
  return { query: mockQuery };
});

const db = require('../../db');

describe('Release verification: new-restaurant Activate/Suspend toggle end-to-end', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish the info_schema responder cleared by clearAllMocks().
    db.query.mockImplementation((text) => {
      if (text && text.includes('information_schema.columns') && text.includes(`table_name = 'restaurants'`)) {
        return Promise.resolve({
          rows: [
            { column_name: 'plan' }, { column_name: 'billing_status' }, { column_name: 'billing_provider' },
            { column_name: 'trial_ends_at' }, { column_name: 'subscription_current_period_end' },
            { column_name: 'subscription_cancel_at_period_end' }, { column_name: 'contact_email' },
            { column_name: 'contact_phone' }, { column_name: 'address' }, { column_name: 'latitude' },
            { column_name: 'longitude' }, { column_name: 'manager_name' }
          ]
        });
      }
      const nextMock = db.query._queue.shift();
      if (nextMock) return nextMock;
      return Promise.resolve({ rows: [] });
    });
  });

  const superAdminToken = signToken({ id: 'u-super', email: 'superadmin@example.com', role: 'SUPER_ADMIN', restaurant_id: null });

  const trialEndsAtFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const restaurantId = 'r-new-onboard';

  function tenantRow(billingStatus) {
    return {
      id: restaurantId,
      name: 'Casa Moreno',
      slug: 'casa-moreno',
      plan: 'trial',
      billing_status: billingStatus,
      billing_provider: 'manual',
      trial_ends_at: trialEndsAtFuture,
      subscription_current_period_end: null,
      subscription_cancel_at_period_end: false,
      contact_email: 'owner@casamoreno.test',
      contact_phone: null,
      address: null,
      latitude: null,
      longitude: null,
      manager_name: null,
      created_at: new Date().toISOString()
    };
  }

  it('step 1: a freshly onboarded restaurant lists as pending/trialing', async () => {
    db.query.mockResolvedValueOnce({ rows: [tenantRow('pending')] });

    const res = await request(app)
      .get('/api/admin/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    const row = res.body.find((t) => t.id === restaurantId);
    expect(row).toMatchObject({ billing_status: 'pending', computed_status: 'trialing' });
    // The pre-fix bug keyed the toggle off computed_status, which is 'trialing'
    // here — this is still correctly "not active" either way, so step 1 alone
    // does not distinguish the fix; steps 2-3 below do.
    expect(evaluateGuestAccess(row)).toMatchObject({ allowed: true, reason: 'trialing' });
  });

  it('step 2: Activate persists billing_status=active and is reported as active even though the trial is still running', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ ...tenantRow('active'), billing_status: 'active' }]
    });

    const patchRes = await request(app)
      .patch(`/api/admin/tenants/${restaurantId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ billing_status: 'active' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.billing_status).toBe('active');

    // Confirm the actual UPDATE statement persisted billing_status = 'active'
    // for this restaurant id — not just that the HTTP layer echoed it back.
    const updateCall = db.query.mock.calls.find(([text]) => text && text.includes('UPDATE restaurants'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toMatch(/billing_status = \$/);
    expect(updateCall[1]).toEqual(expect.arrayContaining(['active']));

    // Dashboard refresh: GET /tenants now reflects billing_status=active, but
    // computed_status is STILL 'trialing' because the trial has not ended —
    // this is the exact divergence that used to leave the Activate/Suspend
    // button stuck. The fixed frontend helper (getTenantToggleState) reads
    // billing_status, not computed_status, so it now correctly shows "Suspend".
    db.query.mockResolvedValueOnce({ rows: [{ ...tenantRow('active') }] });
    const getRes = await request(app)
      .get('/api/admin/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`);
    const row = getRes.body.find((t) => t.id === restaurantId);
    expect(row).toMatchObject({ billing_status: 'active', computed_status: 'trialing' });

    // Guest access is allowed while active+trialing.
    expect(evaluateGuestAccess(row)).toMatchObject({ allowed: true });
  });

  it('step 3: Suspend persists billing_status=suspended and guest access is denied despite the still-valid trial', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...tenantRow('suspended') }] });

    const patchRes = await request(app)
      .patch(`/api/admin/tenants/${restaurantId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ billing_status: 'suspended' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.billing_status).toBe('suspended');

    const updateCall = db.query.mock.calls.find(([text]) => text && text.includes('UPDATE restaurants'));
    expect(updateCall[1]).toEqual(expect.arrayContaining(['suspended']));

    // Dashboard refresh: computed_status now correctly reports 'suspended'
    // too (the override at the top of deriveComputedBillingStatus), so the
    // button correctly flips back to "Activate".
    db.query.mockResolvedValueOnce({ rows: [{ ...tenantRow('suspended') }] });
    const getRes = await request(app)
      .get('/api/admin/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`);
    const row = getRes.body.find((t) => t.id === restaurantId);
    expect(row).toMatchObject({ billing_status: 'suspended', computed_status: 'suspended' });

    // The defect this verification pass is specifically guarding against:
    // suspension must win even though plan='trial' and trial_ends_at is
    // still in the future (not expired).
    expect(evaluateGuestAccess(row)).toMatchObject({ allowed: false, reason: 'suspended' });
  });

  it('step 4: Activate again correctly re-persists billing_status=active and restores guest access', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...tenantRow('active') }] });

    const patchRes = await request(app)
      .patch(`/api/admin/tenants/${restaurantId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ billing_status: 'active' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.billing_status).toBe('active');

    db.query.mockResolvedValueOnce({ rows: [{ ...tenantRow('active') }] });
    const getRes = await request(app)
      .get('/api/admin/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`);
    const row = getRes.body.find((t) => t.id === restaurantId);
    expect(row.billing_status).toBe('active');
    expect(evaluateGuestAccess(row)).toMatchObject({ allowed: true });
  });

  it('rejects an invalid billing_status value instead of writing it (fail-closed)', async () => {
    const patchRes = await request(app)
      .patch(`/api/admin/tenants/${restaurantId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ billing_status: 'trialing' }); // not a caller-settable value

    expect(patchRes.status).toBe(400);
    const updateCall = db.query.mock.calls.find(([text]) => text && text.includes('UPDATE restaurants'));
    expect(updateCall).toBeFalsy();
  });
});
