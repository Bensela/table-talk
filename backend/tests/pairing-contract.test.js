const fs = require('fs');
const path = require('path');

const controllerPath = path.join(
  __dirname,
  '..',
  'controllers',
  'sessionController.js'
);

const routePath = path.join(
  __dirname,
  '..',
  'routes',
  'sessionRoutes.js'
);

const limiterPath = path.join(
  __dirname,
  '..',
  'middleware',
  'rateLimiter.js'
);

const controller = fs.readFileSync(controllerPath, 'utf8');
const routes = fs.readFileSync(routePath, 'utf8');
const limiter = fs.readFileSync(limiterPath, 'utf8');

describe('Catalyst Patch 2A pairing contract', () => {
  test('pairing alphabet is four letters and excludes I, O and Q', () => {
    expect(controller).toMatch(
      /ABCDEFGHJKLMNPRSTUVWXYZ/
    );

    expect(controller).toMatch(
      /PAIRING_CODE_LENGTH\s*=\s*4|length\s*[:=]\s*4/
    );
  });

  test('dual-phone creation generates a live pairing code', () => {
    expect(controller).toMatch(
      /mode\s*===\s*['"]dual-phone['"][\s\S]{0,1200}generatePairingCode\s*\(/
    );

    expect(controller).toMatch(
      /hashPairingCode\s*\(\s*pairingCode\s*,\s*sessionId/
    );
  });

  test('pairing window is exactly five minutes', () => {
    const hasFiveMinuteInterval =
      /INTERVAL\s+['"]5 minutes['"]/i.test(controller);

    const hasFiveMinuteMilliseconds =
      /5\s*\*\s*60\s*\*\s*1000/.test(controller);

    expect(
      hasFiveMinuteInterval || hasFiveMinuteMilliseconds
    ).toBe(true);
  });

  test('single-phone sessions do not receive pairing credentials', () => {
    expect(controller).toMatch(
      /mode\s*===\s*['"]dual-phone['"]/
    );

    expect(controller).toMatch(
      /pairingCodeHash/
    );

    expect(controller).toMatch(
      /pairingExpiresAt/
    );
  });

  test('join-dual requires a code from the request', () => {
    expect(controller).toMatch(
      /(?:const|let|var)\s*\{[^}]*\bcode\b[^}]*\}\s*=\s*req\.body/
    );
  });

  test('join code is normalized to uppercase', () => {
    expect(controller).toMatch(
      /\bcode\b[\s\S]{0,300}\.toUpperCase\s*\(/
    );
  });

  test('join code accepts exactly four allowed letters', () => {
    expect(controller).toMatch(
      /\^\[ABCDEFGHJKLMNPRSTUVWXYZ\]\{4\}\$/
    );
  });

  test('join candidates are scoped to restaurant and table', () => {
    expect(controller).toMatch(
      /table_token\s*=\s*\$[0-9]+[\s\S]{0,500}restaurant_id\s*=\s*\$[0-9]+/
    );
  });

  test('join candidates require an unconsumed pairing hash', () => {
    expect(controller).toMatch(
      /pairing_code_hash\s+IS\s+NOT\s+NULL/i
    );
  });

  test('join candidates require an unexpired pairing window', () => {
    expect(controller).toMatch(
      /pairing_expires_at\s*>\s*(?:NOW\(\)|CURRENT_TIMESTAMP)/i
    );
  });

  test('join is limited to dual-phone sessions', () => {
    expect(controller).toMatch(
      /mode\s*=\s*['"]dual-phone['"]/
    );
  });

  test('successful redemption consumes pairing credentials', () => {
    expect(controller).toMatch(
      /pairing_code_hash\s*=\s*NULL[\s\S]{0,200}pairing_expires_at\s*=\s*NULL/i
    );
  });

  test('session_id alone is not an authorization path for a new Phone B', () => {
    expect(controller).not.toMatch(
      /if\s*\(\s*session_id\s*\)[\s\S]{0,500}Direct join by ID/i
    );
  });

  test('join-dual does not automatically select the latest waiting session for Phone B', () => {
    const start = controller.indexOf('const joinDualPhoneSession = async (req, res) => {');
    const end = controller.indexOf('const getSession = async (req, res) => {');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const joinDualController = controller.slice(start, end);

    expect(joinDualController).not.toMatch(
      /Find latest waiting session/i
    );

    expect(joinDualController).not.toMatch(
      /ORDER BY created_at DESC LIMIT 1/i
    );
  });

  test('resolveSession does not authorize an unknown phone through legacy join_dual or reclaim_dual actions', () => {
    const start = controller.indexOf('const resolveSession = async (req, res) => {');
    const end = controller.indexOf('const getSessionState = async (req, res) => {');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const resolveController = controller.slice(start, end);

    expect(resolveController).not.toMatch(
      /action:\s*['"]join_dual['"]/i
    );

    expect(resolveController).not.toMatch(
      /action:\s*['"]reclaim_dual['"]/i
    );
  });

  test('join-dual route retains explicit rate-limiter protection', () => {
    expect(routes).toMatch(
      /router\.post\(\s*['"]\/join-dual['"]\s*,\s*joinRateLimiter/
    );
  });

  test('existing IP limiter is not mistaken for QR-flow failed-code tracking', () => {
    expect(limiter).toMatch(/joinRateLimiter/);

    // Documentation test:
    // current limiter is defense-in-depth only. Patch 2 frontend/server
    // failed-code semantics are tested separately during implementation.
    expect(limiter).toMatch(/attempts\.count/);
  });
});
