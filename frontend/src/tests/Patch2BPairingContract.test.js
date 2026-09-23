import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const srcRoot = path.resolve(process.cwd(), 'src');

const read = (relativePath) =>
  fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');

const mode = read('pages/ModeSelection.jsx');
const welcome = read('pages/WelcomeScreen.jsx');
const api = read('api/index.js');
const controller = fs.readFileSync(
  path.resolve(process.cwd(), '..', 'backend', 'controllers', 'sessionController.js'),
  'utf8'
);

describe('Catalyst Patch 2B frontend pairing contract', () => {
  it('allows setup_completed only as credential-free coordination, never pairing authorization', () => {
    expect(mode).not.toMatch(/setup_completed[\s\S]{0,500}\bsession_?id\b/i);
    expect(welcome).not.toMatch(/setup_completed[\s\S]{0,500}\bjoinDualSession\s*\(/i);
    expect(welcome).not.toMatch(/setup_completed[\s\S]{0,500}\/session\/.*\/game/i);
  });

  it('requires the restored setup lifecycle to remain restaurant-and-table scoped', () => {
    expect(welcome).toContain('join_table_setup');
    expect(welcome).toContain('claim_setup');
    expect(welcome).toContain('setup_completed');
    expect(welcome).toContain('setup_released');
    expect(welcome).toMatch(/restaurantSlug|activeRestaurantSlug/);
    expect(welcome).toMatch(/tableToken/);
  });

  it('requires setup waiters to re-resolve instead of trusting completion payload session identity', () => {
    expect(welcome).toMatch(/const\s+onSetupCompleted\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?reResolveAfterSetupChange\s*\(\s*\)/);
    // Re-arbitration never auto-claims: a waiting device lands back on the
    // interactive Continue screen and only claims setup ownership from an
    // explicit user action (pressing Continue or "Start a new session
    // instead"), never silently on receipt of a setup lifecycle event.
    expect(welcome).toMatch(/reResolveAfterSetupChange[\s\S]*?setupResolutionRef\.current\s*\(\s*\{\s*claimIfStartNew\s*:\s*false\s*\}\s*\)/);
    expect(welcome).toMatch(/resolveWelcomeFlow[\s\S]*?resolveSession\s*\(/);
    expect(welcome).not.toMatch(/setup_completed[\s\S]{0,1000}sessionId/);
    expect(welcome).not.toMatch(/setup_completed[\s\S]{0,1000}session_id/);
  });

  it('requires setup ownership credential transport without weakening pairing-code authorization', () => {
    expect(welcome).toMatch(/lockToken/);
    expect(mode).toMatch(/lockToken/);
    expect(mode).toContain('setup_completed');
    expect(mode).toMatch(/restaurantSlug/);
    expect(mode).toMatch(/tableToken/);
    expect(mode).toMatch(/\bmode\b/);
  });

  it('does not authorize Phone B by session_id through joinDualSession', () => {
    expect(welcome).not.toMatch(
      /joinDualSession\s*\(\s*\{\s*session_id\s*:/
    );

    expect(mode).not.toMatch(
      /joinDualSession\s*\(\s*\{\s*session_id\s*:/
    );
  });

  it('implements the backend enter_join_code action in WelcomeScreen', () => {
    expect(welcome).toContain('enter_join_code');
  });

  it('requires exactly four permitted letters for Phone B pairing', () => {
    expect(welcome).toContain("useState(['', '', '', ''])");
    expect(welcome).toMatch(
      /const\s+code\s*=\s*chars\.join\(''\)\.toUpperCase\(\)/
    );
    expect(welcome).toMatch(
      /\/\^\[ABCDEFGHJKLMNPRSTUVWXYZ\]\{4\}\$\/\.test\(code\)/
    );
    expect(welcome).toContain('next.every(Boolean)');
    expect(welcome).toContain('submitJoinCode(next)');
    expect(welcome).not.toMatch(/joinCode\.length\s*!==\s*6/);
  });

  it('redeems Phone B only from WelcomeScreen with table token and validated code', () => {
    expect(welcome).toMatch(
      /joinDualSession\s*\(\s*\{[\s\S]*?table_token\s*:\s*tableToken[\s\S]*?\bcode\s*,/
    );

    expect(mode).not.toContain('joinDualSession');
    expect(mode).not.toContain('handleJoinDual');
    expect(mode).not.toContain('joinCode.length');
  });

  it('retains a Phone A pairing-code presentation state', () => {
    expect(mode).toContain('show-code');
    expect(mode).toMatch(/pairing/i);
    expect(mode).toMatch(/createdSessionId/);
  });

  it('consumes the backend pairing code returned when Phone A creates a dual session', () => {
    expect(mode).toMatch(/pairing_code/);
  });

  it('retains dual_partner_joined transition support for Phone A', () => {
    expect(mode).toContain('dual_partner_joined');
  });

  it('keeps API pairing redemption code-capable', () => {
    expect(api).toMatch(
      /joinDualSession\s*=\s*\(\s*\{[\s\S]*?\bcode\b/
    );
  });

  it('removes legacy session_id and reclaim_role inputs from the frontend pairing API contract', () => {
    const declaration = api.match(
      /export\s+const\s+joinDualSession\s*=\s*\(\s*\{([^}]*)\}/
    );

    expect(declaration).not.toBeNull();

    const parameters = declaration?.[1] || '';

    expect(parameters).not.toMatch(/\bsession_id\b/);
    expect(parameters).not.toMatch(/\breclaim_role\b/);
  });

  it('keeps setup coordination separate from Phone B pairing authorization', () => {
    expect(welcome).not.toMatch(/joinDualSession\s*\(\s*\{\s*session_id\s*:/);
    expect(mode).not.toMatch(/joinDualSession\s*\(\s*\{\s*session_id\s*:/);
    expect(welcome).toMatch(/joinDualSession\s*\(\s*\{[\s\S]*?table_token\s*:\s*tableToken[\s\S]*?\bcode\s*,/);
    expect(api).not.toMatch(/joinDualSession\s*=\s*\(\s*\{[^}]*\bsession_id\b/);
  });

  it('does not fail open into onboarding when session resolution fails', () => {
    const catchMatch = welcome.match(/catch\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/);
    expect(catchMatch).not.toBeNull();
    const catchBody = catchMatch?.[1] || '';
    expect(catchBody).not.toMatch(/navigate\s*\(\s*contextPath\s*\)/);
  });

  it('arbitrates backend start_new before navigating to ContextSelection', () => {
    expect(welcome).toMatch(/action\s*===\s*['"]start_new['"]/);
    expect(welcome).toContain('claim_setup');
    expect(welcome).toMatch(/if\s*\(\s*action\s*===\s*['"]start_new['"]\s*\)[\s\S]*?claimTableSetup\s*\(\s*\)[\s\S]*?claim\.status\s*===\s*['"]granted['"][\s\S]*?storeSetupLockToken\s*\(\s*claim\.lockToken\s*\)[\s\S]*?navigate\s*\(\s*contextPath\s*\)/);
  });

  it('routes Start New Instead through setup arbitration rather than direct context navigation', () => {
    const startNewMatch = welcome.match(/const\s+startNewInstead\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\};/);
    expect(startNewMatch).not.toBeNull();
    const startNewBody = startNewMatch?.[1] || '';
    expect(startNewBody).toMatch(/resolveWelcomeFlow\s*\(\s*\{[\s\S]*?claimIfStartNew\s*:\s*true/);
    expect(startNewBody).not.toMatch(/navigate\s*\(\s*contextPath\s*\)/);
  });

  it('stores setup ownership as a scoped session credential rather than participant identity', () => {
    expect(welcome).toMatch(
      /const\s+setupLockStorageKey\s*=\s*normalizedSetupRestaurant\s*&&\s*tableToken[\s\S]{0,200}setup_lock::\$\{normalizedSetupRestaurant\}::\$\{tableToken\}/
    );
    expect(welcome).toMatch(
      /sessionStorage\.setItem\s*\(\s*setupLockStorageKey\s*,\s*lockToken\s*\)/
    );
    expect(welcome).toMatch(
      /sessionStorage\.getItem\s*\(\s*setupLockStorageKey\s*\)/
    );
    expect(welcome).toMatch(/restaurantSlug|activeRestaurantSlug/);
    expect(welcome).toMatch(/tableToken/);
    expect(welcome).toMatch(/lockToken/);
    expect(welcome).not.toMatch(/localStorage\.setItem\s*\([\s\S]{0,300}setup[_-]lock/i);
  });

  it('keeps busy scanners waiting and re-resolves only after setup lifecycle notification', () => {
    expect(welcome).toMatch(/status\s*===\s*['"]busy['"]/);
    expect(welcome).toMatch(/const\s+onSetupCompleted\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?reResolveAfterSetupChange\s*\(\s*\)/);
    expect(welcome).toMatch(/const\s+onSetupReleased\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?reResolveAfterSetupChange\s*\(\s*\)/);
  });

  it('re-resolution after setup lifecycle change lands on the interactive Continue screen rather than auto-claiming', () => {
    // A waiting device never silently races for setup ownership on receipt
    // of a setup_completed/setup_released event — it re-resolves and, when
    // the outcome is start_new, shows the normal Continue screen. The claim
    // race only starts from an explicit user action (Continue press, or
    // "Start a new session instead"), both of which pass claimIfStartNew: true.
    expect(welcome).toMatch(
      /const\s+reResolveAfterSetupChange\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?setupResolutionRef\.current\s*\(\s*\{\s*claimIfStartNew\s*:\s*false\s*\}\s*\)/
    );

    // The claim-and-navigate machinery itself is still present and reachable
    // from an explicit claimIfStartNew: true call (Continue / Start New
    // Instead).
    expect(welcome).toMatch(
      /if\s*\(\s*action\s*===\s*['"]start_new['"]\s*\)[\s\S]*?claimTableSetup\s*\(\s*\)[\s\S]*?claim\.status\s*===\s*['"]granted['"][\s\S]*?storeSetupLockToken\s*\(\s*claim\.lockToken\s*\)[\s\S]*?navigate\s*\(\s*contextPath\s*\)/
    );

    expect(welcome).toMatch(
      /claim\.status\s*===\s*['"]busy['"][\s\S]*?setSetupWaiting\s*\(\s*true\s*\)/
    );
  });

  it('auto-advances a waiting code-entry screen once its pairing opportunity is consumed elsewhere', () => {
    // Coordination-only notification: no session/participant identity, and
    // it only acts on a device that is still on the code-entry screen and
    // has not already opted into starting its own session.
    expect(welcome).toMatch(/pairing_opportunity_consumed/);
    expect(welcome).toMatch(
      /const\s+onPairingOpportunityConsumed\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?joinCodeRequiredRef\.current[\s\S]*?startNewInsteadRef\.current/
    );
    expect(welcome).toMatch(/startNewInsteadRef\.current\s*=\s*startNewInstead/);

    expect(controller).toMatch(/pairing_opportunity_consumed/);
  });

  it('uses explicit new-session intent instead of looping back into an available pairing opportunity', () => {
    expect(api).toMatch(/export\s+const\s+resolveSession/);
    expect(api).toMatch(/preferNewSession\s*=\s*false/);
    expect(api).toMatch(/prefer_new_session\s*:\s*preferNewSession\s*===\s*true/);

    expect(welcome).toMatch(
      /startNewInstead[\s\S]*?preferNewSession\s*:\s*true/
    );

    expect(controller).toMatch(/prefer_new_session/);
    expect(controller).toMatch(/preferNewSession/);
    expect(controller).toMatch(/pairingOpportunity\.rows\.length\s*>\s*0\s*&&\s*!preferNewSession/);
  });

  it('keeps explicit new-session intent behind setup arbitration', () => {
    expect(welcome).toMatch(
      /preferNewSession\s*:\s*true[\s\S]*?claimIfStartNew\s*:\s*true/
    );

    expect(welcome).toMatch(
      /action\s*===\s*['"]start_new['"][\s\S]*?claimTableSetup\s*\(\s*\)/
    );
  });

  it('requires ModeSelection setup completion to carry ownership and scope but no session identity', () => {
    expect(mode).toContain('setup_completed');
    expect(mode).toMatch(/setup_completed[\s\S]{0,1000}restaurantSlug/);
    expect(mode).toMatch(/setup_completed[\s\S]{0,1000}tableToken/);
    expect(mode).toMatch(/setup_completed[\s\S]{0,1000}lockToken/);
    expect(mode).toMatch(/setup_completed[\s\S]{0,1000}\bmode\b/);
    expect(mode).not.toMatch(/setup_completed[\s\S]{0,1000}\bsession_?id\b/i);
  });

  it('does not complete dual setup before the backend pairing code is validated', () => {
    const pairingValidation = mode.search(/pairing_code/);
    const setupCompletion = mode.search(/setup_completed/);
    expect(pairingValidation).toBeGreaterThanOrEqual(0);
    expect(setupCompletion).toBeGreaterThan(pairingValidation);
  });
});
