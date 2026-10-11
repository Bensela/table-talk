const { evaluateGuestAccess } = require('../services/guestAccessPolicy');

const NOW = new Date('2026-10-11T12:00:00Z');
const daysFromNow = (d) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000).toISOString();

const row = (overrides = {}) => ({
  billing_status: 'active',
  plan: 'starter',
  trial_ends_at: null,
  subscription_current_period_end: null,
  ...overrides
});

describe('guest access policy — shared QR/session eligibility', () => {
  describe('allowed states', () => {
    test('active paid/manual restaurant with no dates', () => {
      expect(evaluateGuestAccess(row(), NOW)).toMatchObject({ allowed: true });
    });

    test('active restaurant inside its paid period', () => {
      const r = row({ subscription_current_period_end: daysFromNow(10) });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: true });
    });

    test('cancel-at-period-end subscription stays allowed until the period ends', () => {
      const r = row({
        subscription_current_period_end: daysFromNow(3),
        subscription_cancel_at_period_end: true
      });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: true });
    });

    test('trial that has not ended yet (active)', () => {
      const r = row({ plan: 'trial', trial_ends_at: daysFromNow(5) });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: true, state: 'trialing' });
    });

    test('pending trial that has not ended yet (legacy handshake grace state)', () => {
      const r = row({ billing_status: 'pending', plan: 'trial', trial_ends_at: daysFromNow(5) });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: true, state: 'trialing' });
    });

    test('paying restaurant that converted from a trial keeps access despite the retained trial date', () => {
      // setRestaurantPlan() intentionally keeps old trial dates "for audit, but do not treat as trial".
      const r = row({
        plan: 'starter',
        trial_ends_at: daysFromNow(-30),
        subscription_current_period_end: daysFromNow(20)
      });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: true });
    });

    test('mocked/legacy rows without plan or date fields fall back to billing_status', () => {
      expect(evaluateGuestAccess({ billing_status: 'active' }, NOW)).toMatchObject({ allowed: true });
    });
  });

  describe('denied states', () => {
    test('expired trial is denied even though billing_status is still active', () => {
      const r = row({ plan: 'trial', trial_ends_at: daysFromNow(-5) });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: false, reason: 'trial_expired' });
    });

    test('expired pending trial is denied', () => {
      const r = row({ billing_status: 'pending', plan: 'trial', trial_ends_at: daysFromNow(-1) });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: false, reason: 'trial_expired' });
    });

    test('paid subscription past its period end is denied', () => {
      const r = row({ subscription_current_period_end: daysFromNow(-2) });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: false, reason: 'subscription_expired' });
    });

    test('suspended is denied regardless of dates', () => {
      const r = row({
        billing_status: 'suspended',
        plan: 'trial',
        trial_ends_at: daysFromNow(5)
      });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: false, reason: 'suspended' });
    });

    test.each(['past_due', 'canceled', 'pending', 'unknown-status', null, undefined])(
      'non-active billing_status %p on a non-trial plan is denied',
      (status) => {
        const r = row({ billing_status: status });
        expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: false });
      }
    );

    test('pending trial with no trial end date is denied (fail closed)', () => {
      const r = row({ billing_status: 'pending', plan: 'trial', trial_ends_at: null });
      expect(evaluateGuestAccess(r, NOW)).toMatchObject({ allowed: false });
    });

    test('missing restaurant row is denied', () => {
      expect(evaluateGuestAccess(null, NOW)).toMatchObject({ allowed: false });
    });
  });
});
