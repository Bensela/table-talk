'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Patch 2B.11A
 *
 * TEST-ONLY discovery/contract suite.
 *
 * These tests intentionally describe the REQUIRED setup-arbitration
 * security architecture before production code is changed.
 *
 * Setup coordination is NOT dual-session authorization.
 * A setup-completed event must never authorize Phone B by session_id.
 */

const repoRoot = path.resolve(__dirname, '..', '..');

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const backendIndex = read('backend/index.js');
const sessionController = read('backend/controllers/sessionController.js');
const welcome = read('frontend/src/pages/WelcomeScreen.jsx');
const mode = read('frontend/src/pages/ModeSelection.jsx');
const api = read('frontend/src/api/index.js');

describe('Patch 2B.11A - setup arbitration security contract', () => {

  describe('tenant-scoped setup namespace', () => {

    test('setup lock storage must not be keyed by bare table token alone', () => {
      expect(backendIndex).not.toMatch(/setupLocks\.set\(\s*tableToken\s*,/);
      expect(backendIndex).not.toMatch(/setupLocks\.get\(\s*tableToken\s*\)/);
      expect(backendIndex).not.toMatch(/setupLocks\.delete\(\s*tableToken\s*\)/);
    });

    test('setup socket room must not use bare setup_<tableToken> namespace', () => {
      expect(backendIndex).not.toMatch(/setup_\$\{tableToken\}/);
    });

    test('setup arbitration implementation must include restaurant scope', () => {
      const setupRegionMatches = backendIndex.match(
        /(?:join_table_setup|claim_setup|release_setup|setup_completed)[\s\S]{0,9000}/
      );

      expect(setupRegionMatches).not.toBeNull();

      const setupRegion = setupRegionMatches[0];
      expect(setupRegion).toMatch(/restaurant/i);
    });

  });

  describe('setup coordination is not authorization', () => {

    test('Welcome must never redeem dual membership using session_id', () => {
      expect(welcome).not.toMatch(
        /joinDualSession\s*\(\s*\{[\s\S]{0,300}?session_id\s*:/
      );
    });

    test('ModeSelection must never redeem dual membership using session_id', () => {
      expect(mode).not.toMatch(
        /joinDualSession\s*\(\s*\{[\s\S]{0,300}?session_id\s*:/
      );
    });

    test('frontend join-dual API must not send session_id or reclaim_role', () => {
      const joinFn = api.match(
        /joinDualSession[\s\S]{0,1800}/
      );

      expect(joinFn).not.toBeNull();
      expect(joinFn[0]).not.toMatch(/session_id\s*:/);
      expect(joinFn[0]).not.toMatch(/reclaim_role\s*:/);
    });

    test('backend join-dual authorization requires four-letter code', () => {
      expect(sessionController).toMatch(
        /const\s*\{[^}]*table_token[^}]*code[^}]*\}\s*=\s*req\.body/
      );

      expect(sessionController).toMatch(
        /\^\[ABCDEFGHJKLMNPRSTUVWXYZ\]\{4\}\$/
      );
    });

  });

  describe('pairing remains tenant + table scoped', () => {

    test('pairing candidate query requires restaurant and table', () => {
      expect(sessionController).toMatch(
        /WHERE\s+restaurant_id\s*=\s*\$1[\s\S]{0,300}?AND\s+table_token\s*=\s*\$2/
      );
    });

    test('pairing opportunity discovery requires restaurant and table', () => {
      expect(sessionController).toMatch(
        /WHERE\s+table_token\s*=\s*\$1[\s\S]{0,200}?AND\s+restaurant_id\s*=\s*\$2[\s\S]{0,300}?pairing_code_hash\s+IS\s+NOT\s+NULL/
      );
    });

  });

  describe('restored setup lifecycle contract', () => {

    test('Welcome participates in setup coordination', () => {
      expect(welcome).toMatch(
        /join_table_setup|claim_setup|setup_status|setup_claimed/
      );
    });

    test('Welcome handles setup completion without session-id authorization', () => {
      expect(welcome).toMatch(/setup_completed/);

      const completionRegions = welcome.match(/setup_completed[\s\S]{0,1200}/g) || [];

      for (const region of completionRegions) {
        expect(region).not.toMatch(
          /joinDualSession\s*\(\s*\{[\s\S]{0,250}?session_id/
        );
      }
    });

    test('ModeSelection signals setup lifecycle completion or release', () => {
      expect(mode).toMatch(/setup_completed|release_setup/);
    });

  });

  describe('resolver remains the authority after setup coordination', () => {

    test('unknown device pairing opportunity returns enter_join_code only', () => {
      expect(sessionController).toContain('enter_join_code');
    });

    test('active paired dual does not expose join authorization to unknown device', () => {
      expect(sessionController).toContain('dual_session_full');
      expect(sessionController).toContain('start_new');
    });

  });

});


/* PATCH_2B_11B_SECURITY_CONTRACT */

describe('Patch 2B.11B setup arbitration security boundary', () => {
  const fs = require('fs');
  const path = require('path');

  const backendIndex = fs.readFileSync(
    path.join(__dirname, '..', 'index.js'),
    'utf8'
  );

  const setupHandlersStart =
    backendIndex.indexOf("socket.on('join_table_setup'");

  const setupHandlersEnd =
    backendIndex.indexOf("socket.on('context_switch_intent'");

  if (
    setupHandlersStart < 0 ||
    setupHandlersEnd <= setupHandlersStart
  ) {
    throw new Error('Unable to isolate pre-session setup handler region');
  }

  const setupHandlers = backendIndex.slice(
    setupHandlersStart,
    setupHandlersEnd
  );

  test('setup lock storage is not keyed by bare table token', () => {
    expect(setupHandlers).not.toMatch(
      /setupLocks\.get\(tableToken\)/
    );

    expect(setupHandlers).not.toMatch(
      /setupLocks\.set\(tableToken\s*,/
    );

    expect(setupHandlers).not.toMatch(
      /setupLocks\.delete\(tableToken\)/
    );
  });

  test('setup room is not table-token-only', () => {
    expect(setupHandlers).not.toContain(
      'setup_${tableToken}'
    );
  });
  test('setup completion requires lock ownership credential', () => {
    const completionStart =
      backendIndex.indexOf("socket.on('setup_completed'");

    expect(completionStart).toBeGreaterThan(-1);

    const completionBlock =
      backendIndex.slice(
        completionStart,
        completionStart + 600
      );

    expect(completionBlock).toContain('lockToken');
  });

  test('setup completion does not accept or broadcast sessionId', () => {
    const completionStart =
      backendIndex.indexOf("socket.on('setup_completed'");

    expect(completionStart).toBeGreaterThan(-1);

    const completionBlock =
      backendIndex.slice(
        completionStart,
        completionStart + 600
      );

    expect(completionBlock).not.toContain('sessionId');
  });

  test('setup completion does not blindly clear by bare table token', () => {
    const completionStart =
      backendIndex.indexOf("socket.on('setup_completed'");

    expect(completionStart).toBeGreaterThan(-1);

    const completionBlock =
      backendIndex.slice(
        completionStart,
        completionStart + 600
      );

    expect(completionBlock).not.toContain(
      'clearSetupLockForTable(tableToken)'
    );
  });

  test('pairing authorization remains separate from setup completion', () => {
    const completionStart =
      backendIndex.indexOf("socket.on('setup_completed'");

    expect(completionStart).toBeGreaterThan(-1);

    const completionBlock =
      backendIndex.slice(
        completionStart,
        completionStart + 600
      );

    expect(completionBlock).not.toContain(
      'joinDualSession'
    );

    expect(completionBlock).not.toContain(
      'participant_id'
    );
  });
});
