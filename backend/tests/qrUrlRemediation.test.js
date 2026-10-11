const {
  normalizeBaseUrl,
  buildCanonicalQrUrl,
  planQrUrlCorrections
} = require('../services/qrUrlRemediation');

const BASE = 'https://catalyst.example.test';

const row = (overrides = {}) => ({
  id: 't1',
  restaurant_id: 'r1',
  slug: 'panini',
  table_number: 'Table 1',
  qr_code_url: 'https://tabletalk.app/r/panini/t/Table%201',
  ...overrides
});

describe('QR URL remediation planning', () => {
  test('rewrites a wrong-host URL while preserving slug and table identity', () => {
    const plan = planQrUrlCorrections([row()], { baseUrl: BASE });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({
      id: 't1',
      old_url: 'https://tabletalk.app/r/panini/t/Table%201',
      new_url: `${BASE}/r/panini/t/Table%201`
    });
  });

  test('uses exactly the format the provisioner writes', () => {
    expect(buildCanonicalQrUrl(BASE, 'panini', ' Table 1 ')).toBe(`${BASE}/r/panini/t/Table%201`);
    expect(buildCanonicalQrUrl(BASE, 'cafe-2', 'A&B #2')).toBe(`${BASE}/r/cafe-2/t/A%26B%20%232`);
  });

  test('is idempotent: applying the plan and re-planning yields no updates', () => {
    const first = planQrUrlCorrections([row()], { baseUrl: BASE });
    const applied = [row({ qr_code_url: first.updates[0].new_url })];
    const second = planQrUrlCorrections(applied, { baseUrl: BASE });
    expect(second.updates).toHaveLength(0);
    expect(second.unchanged).toBe(1);
  });

  test('handles a base URL with a trailing slash', () => {
    const plan = planQrUrlCorrections([row()], { baseUrl: `${BASE}/` });
    expect(plan.updates[0].new_url).toBe(`${BASE}/r/panini/t/Table%201`);
  });

  test('leaves rows that already point at the correct host untouched', () => {
    const plan = planQrUrlCorrections([row({ qr_code_url: `${BASE}/r/panini/t/Table%201` })], { baseUrl: BASE });
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  test('skips rows whose URL identity does not match the row (never repoints a table)', () => {
    const plan = planQrUrlCorrections(
      [
        row({ id: 'a', qr_code_url: 'https://tabletalk.app/r/other-restaurant/t/Table%201' }),
        row({ id: 'b', qr_code_url: 'https://tabletalk.app/r/panini/t/Table%202' })
      ],
      { baseUrl: BASE }
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['identity_mismatch', 'identity_mismatch']);
  });

  test('only rewrites explicitly targeted hosts; other hosts are reported, not changed', () => {
    const plan = planQrUrlCorrections(
      [row({ qr_code_url: 'https://custom-domain.example/r/panini/t/Table%201' })],
      { baseUrl: BASE }
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped[0]).toMatchObject({ reason: 'host_not_targeted', host: 'custom-domain.example' });
  });

  test('a custom --from-host list is honoured', () => {
    const plan = planQrUrlCorrections(
      [row({ qr_code_url: 'https://old.example.test/r/panini/t/Table%201' })],
      { baseUrl: BASE, fromHosts: ['old.example.test'] }
    );
    expect(plan.updates).toHaveLength(1);
  });

  test('skips null, unparsable and non-QR values without throwing', () => {
    const plan = planQrUrlCorrections(
      [
        row({ id: 'n', qr_code_url: null }),
        row({ id: 'u', qr_code_url: 'not a url' }),
        row({ id: 'p', qr_code_url: 'https://tabletalk.app/somewhere/else' })
      ],
      { baseUrl: BASE }
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['no_stored_url', 'unparsable_url', 'unexpected_path']);
  });

  test('tolerates tables with percent signs in their name', () => {
    const plan = planQrUrlCorrections(
      [row({ table_number: '100%', qr_code_url: 'https://tabletalk.app/r/panini/t/100%25' })],
      { baseUrl: BASE }
    );
    expect(plan.updates[0].new_url).toBe(`${BASE}/r/panini/t/100%25`);
  });

  describe('input validation', () => {
    test.each([
      ['no scheme', 'catalyst.example.test'],
      ['unsupported scheme', 'ftp://catalyst.example.test'],
      ['contains a path', 'https://catalyst.example.test/app'],
      ['contains a query', 'https://catalyst.example.test/?x=1'],
      ['empty', '']
    ])('rejects a base URL that is %s', (_label, value) => {
      expect(() => normalizeBaseUrl(value)).toThrow();
    });

    test('refuses a base host that is also a replaced host', () => {
      expect(() => planQrUrlCorrections([row()], { baseUrl: 'https://tabletalk.app' })).toThrow(/must not be one of/);
    });
  });
});
