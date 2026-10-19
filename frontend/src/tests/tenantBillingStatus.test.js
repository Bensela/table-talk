import { describe, it, expect } from 'vitest';
import { getTenantToggleState } from '../utils/tenantBillingStatus';

describe('getTenantToggleState — Super Admin Activate/Suspend toggle', () => {
  it('reads the pre-existing default restaurant (no trial) as active -> Suspend', () => {
    const state = getTenantToggleState({ billing_status: 'active', computed_status: 'active' });
    expect(state).toMatchObject({ isActive: true, nextStatus: 'suspended', label: 'Suspend' });
  });

  it('reads a newly onboarded, still-pending restaurant as inactive -> Activate', () => {
    const state = getTenantToggleState({
      billing_status: 'pending',
      computed_status: 'trialing',
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    });
    expect(state).toMatchObject({ isActive: false, nextStatus: 'active', label: 'Activate' });
  });

  it('keeps toggling correctly for a newly onboarded restaurant mid-trial after it has been activated', () => {
    // This is the exact bug scenario: billing_status is now 'active', but the
    // trial has not ended yet so computed_status is still 'trialing'. The
    // toggle must track billing_status, not the trial-aware computed_status,
    // or a second click here would silently suspend instead of no-op/suspend
    // as the admin expects.
    const stillTrialingButActivated = {
      billing_status: 'active',
      computed_status: 'trialing',
      trial_ends_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
    };
    const state = getTenantToggleState(stillTrialingButActivated);
    expect(state).toMatchObject({ isActive: true, nextStatus: 'suspended', label: 'Suspend' });
  });

  it('always reads an explicitly suspended restaurant as inactive -> Activate, regardless of computed_status', () => {
    const state = getTenantToggleState({ billing_status: 'suspended', computed_status: 'suspended' });
    expect(state).toMatchObject({ isActive: false, nextStatus: 'active', label: 'Activate' });
  });

  it('falls back to pending (inactive) when billing_status is missing', () => {
    const state = getTenantToggleState({});
    expect(state).toMatchObject({ isActive: false, nextStatus: 'active', label: 'Activate' });
  });
});
