// Single source of truth for whether the Super Admin "Activate / Suspend"
// toggle on a tenant row should currently read as active.
//
// Deliberately keyed off the raw administrative `billing_status`
// ('active' | 'suspended' | 'pending') rather than the trial/period-aware
// `computed_status` ('trialing' | 'past_due' | 'cancel_at_period_end' | ...)
// that the backend derives for subscription-eligibility display elsewhere.
// `computed_status` answers "would a guest be let in right now?" and
// intentionally reports 'trialing' for a restaurant's entire trial window
// regardless of what billing_status is set to. Driving this toggle off it
// meant a newly onboarded restaurant (always created with a trial_ends_at
// in the future) kept showing "Activate" even after being activated, and a
// second click would silently flip billing_status to 'suspended' instead
// of doing nothing. The pre-existing "default" restaurant never hit this
// because it was seeded without a trial_ends_at, so its computed_status
// always equalled billing_status.
export function getTenantToggleState(tenant) {
  const billingStatus = tenant?.billing_status || 'pending';
  const isActive = billingStatus === 'active';
  return {
    isActive,
    nextStatus: isActive ? 'suspended' : 'active',
    label: isActive ? 'Suspend' : 'Activate',
    title: isActive ? 'Suspend tenant' : 'Activate tenant'
  };
}
