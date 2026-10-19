// Release verification: billingService.getFrontendUrl() is the resolver
// adminController/adminRoutes/restaurantRoutes all call for generated links.
// Confirms its precedence in isolation (fresh module graph per test, since
// its env-derived fallback constant is captured once at module load — by
// design, matching how a real deployment sets FRONTEND_URL before the
// process starts, the same as every other env-derived const in this
// codebase) — never falls back to the unrelated tabletalk.app domain.
const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

describe('billingService.getFrontendUrl — DigitalOcean env precedence (release verification)', () => {
  afterEach(() => {
    jest.resetModules();
    if (ORIGINAL_FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
  });

  test('uses process.env.FRONTEND_URL (the DigitalOcean app-spec env var) when no Super Admin DB setting is configured', async () => {
    process.env.FRONTEND_URL = 'https://do-app.ondigitalocean.app';
    jest.doMock('./../services/platformSettingsService', () => ({
      getPaymentGatewayPublic: jest.fn().mockResolvedValue({ frontend_url: '' })
    }));
    const billingService = require('../services/billingService');
    await expect(billingService.getFrontendUrl()).resolves.toBe('https://do-app.ondigitalocean.app');
  });

  test('Super Admin DB setting takes precedence over process.env.FRONTEND_URL', async () => {
    process.env.FRONTEND_URL = 'https://do-app.ondigitalocean.app';
    jest.doMock('./../services/platformSettingsService', () => ({
      getPaymentGatewayPublic: jest.fn().mockResolvedValue({ frontend_url: 'https://db-configured.catalyst-test.example.com' })
    }));
    const billingService = require('../services/billingService');
    await expect(billingService.getFrontendUrl()).resolves.toBe('https://db-configured.catalyst-test.example.com');
  });

  test('falls back to the configured application domain, never tabletalk.app, when nothing is set anywhere', async () => {
    delete process.env.FRONTEND_URL;
    jest.doMock('./../services/platformSettingsService', () => ({
      getPaymentGatewayPublic: jest.fn().mockResolvedValue({ frontend_url: '' })
    }));
    const billingService = require('../services/billingService');
    const url = await billingService.getFrontendUrl();
    expect(url).toBe('https://catalyst.madetoconnect.co');
    expect(url).not.toContain('tabletalk.app');
  });

  test('a malformed DB setting value is rejected rather than embedded into generated links', async () => {
    process.env.FRONTEND_URL = 'https://do-app.ondigitalocean.app';
    jest.doMock('./../services/platformSettingsService', () => ({
      getPaymentGatewayPublic: jest.fn().mockResolvedValue({ frontend_url: 'not-a-valid-origin' })
    }));
    const billingService = require('../services/billingService');
    await expect(billingService.getFrontendUrl()).resolves.toBe('https://do-app.ondigitalocean.app');
  });
});
