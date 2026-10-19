const request = require('supertest');
const express = require('express');

// This suite is about URL-trust decisions, not QR pixel rendering — mock
// out the real (CPU-bound) QRCode.toDataURL so the suite stays fast and
// deterministic under parallel test-worker load instead of occasionally
// tripping Jest's default per-test timeout.
jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,stub')
}));

jest.mock('../../db', () => ({
  query: jest.fn()
}));

jest.mock('../../services/billingService', () => ({
  getFrontendUrl: jest.fn()
}));

const db = require('../../db');
const billingService = require('../../services/billingService');
const restaurantRoutes = require('../../routes/restaurantRoutes');

const CANONICAL_ORIGIN = 'https://catalyst.madetoconnect.co';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/restaurants', restaurantRoutes);
  return app;
}

describe('POST /restaurants/:slug/qr — untrusted baseUrl rejection', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    billingService.getFrontendUrl.mockResolvedValue(CANONICAL_ORIGIN);
    db.query.mockResolvedValue({
      rows: [{ id: 'r1', slug: 'panini', name: 'Panini', plan: 'starter', active: true }]
    });
  });

  it('rejects an unauthenticated request before looking at baseUrl', async () => {
    const res = await request(app)
      .post('/restaurants/panini/qr')
      .send({ tables: ['table-1'] });
    expect(res.status).toBe(401);
  });

  it('uses the resolved canonical origin when no baseUrl is supplied', async () => {
    const res = await request(app)
      .post('/restaurants/panini/qr')
      .set('X-Restaurant-Key', 'secret123')
      .send({ tables: ['table-1'] });

    expect(res.status).toBe(200);
    expect(res.body[0].url).toBe(`${CANONICAL_ORIGIN}/r/panini/t/table-1`);
  });

  it('honors an explicit baseUrl that matches the canonical origin', async () => {
    const res = await request(app)
      .post('/restaurants/panini/qr')
      .set('X-Restaurant-Key', 'secret123')
      .send({ tables: ['table-1'], baseUrl: CANONICAL_ORIGIN });

    expect(res.status).toBe(200);
    expect(res.body[0].url).toBe(`${CANONICAL_ORIGIN}/r/panini/t/table-1`);
  });

  it('rejects an untrusted baseUrl host instead of embedding it in a generated QR code', async () => {
    const res = await request(app)
      .post('/restaurants/panini/qr')
      .set('X-Restaurant-Key', 'secret123')
      .send({ tables: ['table-1'], baseUrl: 'https://evil.example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/configured application domain/i);
  });

  it('rejects the legacy unrelated tabletalk.app host as an untrusted baseUrl', async () => {
    const res = await request(app)
      .post('/restaurants/panini/qr')
      .set('X-Restaurant-Key', 'secret123')
      .send({ tables: ['table-1'], baseUrl: 'https://tabletalk.app' });

    expect(res.status).toBe(400);
  });

  describe('release verification: the trusted origin tracks the configured domain, not a hardcoded one', () => {
    const TEST_ORIGIN = 'https://qa.catalyst-test.example.com';

    beforeEach(() => {
      // Simulate a Super Admin changing the configured canonical domain —
      // no source code changes, just what billingService.getFrontendUrl()
      // resolves to (the same thing it would do by reading an updated DB
      // setting or FRONTEND_URL env var).
      billingService.getFrontendUrl.mockResolvedValue(TEST_ORIGIN);
    });

    it('honors a baseUrl matching the NEW configured domain', async () => {
      const res = await request(app)
        .post('/restaurants/panini/qr')
        .set('X-Restaurant-Key', 'secret123')
        .send({ tables: ['table-1'], baseUrl: TEST_ORIGIN });

      expect(res.status).toBe(200);
      expect(res.body[0].url).toBe(`${TEST_ORIGIN}/r/panini/t/table-1`);
    });

    it('rejects the PREVIOUS canonical origin once the configured domain has moved on', async () => {
      const res = await request(app)
        .post('/restaurants/panini/qr')
        .set('X-Restaurant-Key', 'secret123')
        .send({ tables: ['table-1'], baseUrl: CANONICAL_ORIGIN });

      expect(res.status).toBe(400);
    });

    it('still rejects an unrelated attacker-controlled host under the new configuration', async () => {
      const res = await request(app)
        .post('/restaurants/panini/qr')
        .set('X-Restaurant-Key', 'secret123')
        .send({ tables: ['table-1'], baseUrl: 'https://evil.example.com' });

      expect(res.status).toBe(400);
    });

    it('defaults new QR codes to the new configured domain when no baseUrl is supplied', async () => {
      const res = await request(app)
        .post('/restaurants/panini/qr')
        .set('X-Restaurant-Key', 'secret123')
        .send({ tables: ['table-1'] });

      expect(res.status).toBe(200);
      expect(res.body[0].url).toBe(`${TEST_ORIGIN}/r/panini/t/table-1`);
    });
  });
});
