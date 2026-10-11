// Single source of truth for "may guests of this restaurant start or resume
// a Catalyst session right now?". Used by both the public QR handshake and
// the resolveRestaurant middleware so the two boundaries can never drift.
//
// Mirrors the existing billing lifecycle (billingService.setRestaurantPlan,
// Stripe webhook handlers):
//   - billing_status 'suspended' (subscription deleted / SA suspended) → denied
//   - plan 'trial'   → eligible until trial_ends_at (active or pending)
//   - any other plan → eligible while billing_status is 'active' and the
//                      Stripe period (when one is recorded) has not ended
// Trial dates are retained "for audit" after upgrading to a paid plan, so
// trial_ends_at is only consulted when the current plan is 'trial'.
// Pure function: no I/O, injectable clock, fails closed.

function toMillis(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function deny(reason) {
  return { allowed: false, reason };
}

function evaluateGuestAccess(restaurant, now = new Date()) {
  if (!restaurant) return deny('not_found');

  const status = restaurant.billing_status;
  if (status === 'suspended') return deny('suspended');

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  if (restaurant.plan === 'trial') {
    const trialEnd = toMillis(restaurant.trial_ends_at);
    if (trialEnd !== null) {
      if (trialEnd <= nowMs) return deny('trial_expired');
      if (status === 'active' || status === 'pending') {
        return { allowed: true, reason: 'trialing', state: 'trialing' };
      }
      return deny('inactive');
    }
    // A trial with no recorded end date is only eligible when explicitly active.
    return status === 'active'
      ? { allowed: true, reason: 'active', state: 'active' }
      : deny('inactive');
  }

  if (status !== 'active') return deny('inactive');

  const periodEnd = toMillis(restaurant.subscription_current_period_end);
  if (periodEnd !== null && periodEnd < nowMs) return deny('subscription_expired');

  return { allowed: true, reason: 'active', state: 'active' };
}

module.exports = { evaluateGuestAccess };
