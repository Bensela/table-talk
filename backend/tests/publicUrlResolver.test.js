const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

describe('publicUrlResolver — centralized public origin resolution', () => {
  afterEach(() => {
    jest.resetModules();
    if (ORIGINAL_FRONTEND_URL === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
    }
  });

  describe('normalizeOrigin', () => {
    test('accepts a bare https origin and strips a trailing slash', () => {
      const { normalizeOrigin } = require('../services/publicUrlResolver');
      expect(normalizeOrigin('https://catalyst.madetoconnect.co/')).toBe('https://catalyst.madetoconnect.co');
    });

    test('rejects a value carrying a path, query, or fragment', () => {
      const { normalizeOrigin } = require('../services/publicUrlResolver');
      expect(normalizeOrigin('https://catalyst.madetoconnect.co/dashboard')).toBe('');
      expect(normalizeOrigin('https://catalyst.madetoconnect.co?x=1')).toBe('');
      expect(normalizeOrigin('https://catalyst.madetoconnect.co#frag')).toBe('');
    });

    test('rejects non-http(s) protocols and garbage input', () => {
      const { normalizeOrigin } = require('../services/publicUrlResolver');
      expect(normalizeOrigin('javascript:alert(1)')).toBe('');
      expect(normalizeOrigin('not a url')).toBe('');
      expect(normalizeOrigin(null)).toBe('');
      expect(normalizeOrigin(undefined)).toBe('');
    });
  });

  describe('getPublicOrigin — resolution order', () => {
    test('prefers the Super Admin-configured frontend_url over env and default', async () => {
      jest.doMock('../services/platformSettingsService', () => ({
        getPaymentGatewayPublic: jest.fn().mockResolvedValue({ frontend_url: 'https://configured.example.com' })
      }));
      process.env.FRONTEND_URL = 'https://env-only.example.com';
      const { getPublicOrigin } = require('../services/publicUrlResolver');
      await expect(getPublicOrigin()).resolves.toBe('https://configured.example.com');
    });

    test('falls back to process.env.FRONTEND_URL when nothing is configured in the DB', async () => {
      jest.doMock('../services/platformSettingsService', () => ({
        getPaymentGatewayPublic: jest.fn().mockResolvedValue({ frontend_url: '' })
      }));
      process.env.FRONTEND_URL = 'https://env-only.example.com';
      const { getPublicOrigin } = require('../services/publicUrlResolver');
      await expect(getPublicOrigin()).resolves.toBe('https://env-only.example.com');
    });

    test('falls back to the configured application domain when nothing is set anywhere', async () => {
      jest.doMock('../services/platformSettingsService', () => ({
        getPaymentGatewayPublic: jest.fn().mockResolvedValue({ frontend_url: '' })
      }));
      delete process.env.FRONTEND_URL;
      const { getPublicOrigin, DEFAULT_PUBLIC_ORIGIN } = require('../services/publicUrlResolver');
      expect(DEFAULT_PUBLIC_ORIGIN).toBe('https://catalyst.madetoconnect.co');
      await expect(getPublicOrigin()).resolves.toBe(DEFAULT_PUBLIC_ORIGIN);
    });

    test('falls back gracefully when the settings table is unreachable', async () => {
      jest.doMock('../services/platformSettingsService', () => ({
        getPaymentGatewayPublic: jest.fn().mockRejectedValue(new Error('db down'))
      }));
      process.env.FRONTEND_URL = 'https://env-only.example.com';
      const { getPublicOrigin } = require('../services/publicUrlResolver');
      await expect(getPublicOrigin()).resolves.toBe('https://env-only.example.com');
    });
  });

  describe('isTrustedOrigin — origin-only candidates (e.g. a QR baseUrl override)', () => {
    test('accepts a candidate that exactly matches a trusted origin', () => {
      const { isTrustedOrigin } = require('../services/publicUrlResolver');
      expect(isTrustedOrigin('https://catalyst.madetoconnect.co', ['https://catalyst.madetoconnect.co'])).toBe(true);
    });

    test('rejects an arbitrary host not in the trusted list', () => {
      const { isTrustedOrigin } = require('../services/publicUrlResolver');
      expect(isTrustedOrigin('https://evil.example.com', ['https://catalyst.madetoconnect.co'])).toBe(false);
    });

    test('rejects a value that is not an origin by itself (carries a path)', () => {
      const { isTrustedOrigin } = require('../services/publicUrlResolver');
      expect(isTrustedOrigin('https://catalyst.madetoconnect.co/r/x/t/1', ['https://catalyst.madetoconnect.co'])).toBe(false);
    });
  });

  describe('hasTrustedOrigin — full redirect URLs with a path/query', () => {
    test('accepts a full URL whose origin matches, regardless of path/query', () => {
      const { hasTrustedOrigin } = require('../services/publicUrlResolver');
      expect(hasTrustedOrigin('https://catalyst.madetoconnect.co/dashboard?billing=success', ['https://catalyst.madetoconnect.co'])).toBe(true);
    });

    test('rejects a redirect to an untrusted host even though it is a valid https URL', () => {
      const { hasTrustedOrigin } = require('../services/publicUrlResolver');
      expect(hasTrustedOrigin('https://evil.example.com/phish', ['https://catalyst.madetoconnect.co'])).toBe(false);
    });

    test('rejects a non-string or unparsable candidate', () => {
      const { hasTrustedOrigin } = require('../services/publicUrlResolver');
      expect(hasTrustedOrigin(null, ['https://catalyst.madetoconnect.co'])).toBe(false);
      expect(hasTrustedOrigin('not a url', ['https://catalyst.madetoconnect.co'])).toBe(false);
    });
  });

  describe('buildPublicUrl', () => {
    test('joins an origin and path without duplicating slashes', () => {
      const { buildPublicUrl } = require('../services/publicUrlResolver');
      expect(buildPublicUrl('https://catalyst.madetoconnect.co', '/subscribe/abc')).toBe('https://catalyst.madetoconnect.co/subscribe/abc');
      expect(buildPublicUrl('https://catalyst.madetoconnect.co/', 'subscribe/abc')).toBe('https://catalyst.madetoconnect.co/subscribe/abc');
    });

    test('falls back to the default origin when given an invalid origin', () => {
      const { buildPublicUrl, DEFAULT_PUBLIC_ORIGIN } = require('../services/publicUrlResolver');
      expect(buildPublicUrl('not a url', 'subscribe/abc')).toBe(`${DEFAULT_PUBLIC_ORIGIN}/subscribe/abc`);
    });
  });
});
