import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const INVITE_STATUS = {
  LOADING: 'loading',
  VALID: 'valid',
  NOT_FOUND: 'not_found',
  EXPIRED: 'expired',
  CONSUMED: 'consumed',
  ERROR: 'error'
};

function classifyInviteError(statusCode, message = '') {
  if (statusCode === 410) {
    if (/already been used/i.test(message)) return INVITE_STATUS.CONSUMED;
    return INVITE_STATUS.EXPIRED;
  }
  if (statusCode === 404 || /not found/i.test(message)) return INVITE_STATUS.NOT_FOUND;
  return INVITE_STATUS.ERROR;
}

function errorScreenConfig(status) {
  switch (status) {
    case INVITE_STATUS.EXPIRED:
      return {
        emoji: '⏰',
        title: 'This invite link has expired',
        detail: 'Catalyst onboarding links are time-limited for security. Please reach out to have a new invite issued, or sign in if you already have an account.',
        primaryLabel: 'Go to Sign In',
        primaryTo: '/admin/login',
        showHomeButton: true
      };
    case INVITE_STATUS.CONSUMED:
      return {
        emoji: '✅',
        title: 'This invite has already been used',
        detail: 'This onboarding link was already claimed. If this was you, sign in directly with your credentials.',
        primaryLabel: 'Go to Sign In',
        primaryTo: '/admin/login',
        showHomeButton: true
      };
    case INVITE_STATUS.NOT_FOUND:
      return {
        emoji: '🔍',
        title: 'Invite link not recognized',
        detail: 'We could not find a matching Catalyst onboarding invite. The link may be incomplete or was revoked. Please double-check the URL or request a new link.',
        primaryLabel: 'Go to Sign In',
        primaryTo: '/admin/login',
        showHomeButton: true
      };
    default:
      return {
        emoji: '⚠️',
        title: 'We could not load this invite',
        detail: 'Something went wrong while validating this onboarding link. Please try again or contact support if the issue continues.',
        primaryLabel: 'Retry Invite Check',
        primaryTo: null,
        showHomeButton: true
      };
  }
}

export default function RestaurantSubscriptionPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState(INVITE_STATUS.LOADING);
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [inviteData, setInviteData] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const countdownTimerRef = useRef(null);
  const [form, setForm] = useState({
    restaurantName: '',
    managerName: '',
    contactPhone: '',
    address: '',
    password: '',
    confirmPassword: ''
  });

  const clearCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const startCountdown = useCallback((seconds, target) => {
    clearCountdown();
    const total = Math.max(1, Math.floor(Number(seconds) || 5));
    setCountdown({ remaining: total, target });
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (!prev) return null;
        const next = prev.remaining - 1;
        if (next <= 0) {
          clearCountdown();
          navigate(prev.target, { replace: true });
          return null;
        }
        return { ...prev, remaining: next };
      });
    }, 1000);
  }, [clearCountdown, navigate]);

  useEffect(() => () => clearCountdown(), [clearCountdown]);

  async function loadInvite() {
    try {
      setStatus(INVITE_STATUS.LOADING);
      setErrorMessage('');
      const response = await fetch(`/api/public/restaurant-invites/${token}`);
      const data = await response.json();

      if (!response.ok) {
        const message = data?.error || 'Invite could not be loaded';
        const nextStatus = classifyInviteError(response.status, message);
        setErrorMessage(message);
        setStatus(nextStatus);
        if (nextStatus === INVITE_STATUS.EXPIRED || nextStatus === INVITE_STATUS.CONSUMED) {
          startCountdown(5, '/admin/login');
        }
        return;
      }

      setInviteData(data);
      setForm((current) => ({
        ...current,
        restaurantName: data.restaurant?.name || '',
        managerName: data.restaurant?.manager_name || '',
        contactPhone: data.restaurant?.contact_phone || '',
        address: data.restaurant?.address || ''
      }));
      setStatus(INVITE_STATUS.VALID);
    } catch (err) {
      setErrorMessage(err?.message || 'Unable to load invite');
      setStatus(INVITE_STATUS.ERROR);
    }
  }

  useEffect(() => {
    if (token) {
      loadInvite();
    } else {
      setStatus(INVITE_STATUS.NOT_FOUND);
    }
  }, [token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');

    if (form.password !== form.confirmPassword) {
      setSubmitError('Passwords do not match');
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch(`/api/public/restaurant-invites/${token}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          restaurantName: form.restaurantName,
          managerName: form.managerName,
          contactPhone: form.contactPhone,
          address: form.address,
          password: form.password
        })
      });

      const data = await response.json();
      if (!response.ok) {
        const message = data?.error || 'Subscription could not be completed';
        if (response.status === 410 || /already|expired/i.test(message)) {
          setStatus(classifyInviteError(response.status, message));
          setErrorMessage(message);
        } else {
          setSubmitError(message);
        }
        return;
      }

      localStorage.setItem('adminToken', data.token);
      localStorage.setItem('adminUser', JSON.stringify(data.user));
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setSubmitError(err?.message || 'Subscription could not be completed');
    } finally {
      setSubmitting(false);
    }
  };

  if (status === INVITE_STATUS.LOADING) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
        <div className="text-center space-y-6">
          <img src="/catalyst-logo.png" alt="Catalyst" className="w-24 h-24 mx-auto object-contain drop-shadow-xl" />
          <div className="flex items-center justify-center gap-3">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-slate-300">Checking invite...</span>
          </div>
        </div>
      </div>
    );
  }

  if (status !== INVITE_STATUS.VALID) {
    const cfg = errorScreenConfig(status);
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4 md:p-8">
        <div className="max-w-lg w-full">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="bg-slate-900/80 border border-slate-800 rounded-3xl shadow-2xl p-8 md:p-10 text-center"
          >
            <img src="/catalyst-logo.png" alt="Catalyst" className="w-20 h-20 mx-auto object-contain drop-shadow-xl mb-6" />
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto mb-6 text-3xl">
              {cfg.emoji}
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white mb-3">
              {cfg.title}
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed mb-6 max-w-md mx-auto">
              {cfg.detail}
            </p>
            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-xs text-slate-300/80 inline-block max-w-full break-all">
                {errorMessage}
              </div>
            )}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
              {cfg.primaryTo ? (
                <Link
                  to={cfg.primaryTo}
                  className="w-full sm:w-auto rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-orange-900/20 transition-colors"
                >
                  {cfg.primaryLabel}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={loadInvite}
                  className="w-full sm:w-auto rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-orange-900/20 transition-colors"
                >
                  {cfg.primaryLabel}
                </button>
              )}
              {cfg.showHomeButton && (
                <Link
                  to="/"
                  className="w-full sm:w-auto rounded-2xl border border-slate-700 bg-slate-950/60 hover:bg-slate-950 px-6 py-3 text-sm font-bold text-slate-200 transition-colors"
                >
                  Back to Home
                </Link>
              )}
            </div>
            {countdown && countdown.remaining > 0 && (
              <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-center justify-between gap-3">
                <span>Redirecting to sign in in {countdown.remaining} second{countdown.remaining === 1 ? '' : 's'}...</span>
                <button
                  type="button"
                  onClick={() => { clearCountdown(); setCountdown(null); }}
                  className="rounded-lg bg-slate-950/60 hover:bg-slate-950 border border-slate-700 px-3 py-1.5 font-bold text-amber-100 text-[11px] flex-shrink-0"
                >
                  Cancel
                </button>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="bg-slate-900/80 border border-slate-800 rounded-3xl shadow-2xl p-6 md:p-8"
        >
          <div className="flex flex-col items-center text-center mb-8">
            <img src="/catalyst-logo.png" alt="Catalyst" className="w-20 h-20 object-contain drop-shadow-xl mb-4" />
            <h1 className="text-3xl font-extrabold tracking-tight">Complete Your Restaurant Subscription</h1>
            <p className="text-slate-400 text-sm mt-2 max-w-md">
              Finish the remaining onboarding details and create your restaurant admin login to start using Catalyst.
            </p>
          </div>

          {submitError && (
            <div className="mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {submitError}
            </div>
          )}

          {inviteData && (
            <>
              <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0 text-xl">
                    ✉️
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-amber-100">{inviteData.restaurant?.name || 'Catalyst Restaurant'}</div>
                    <div className="text-amber-100/80 text-sm break-all">{inviteData.restaurant?.contact_email}</div>
                    {inviteData.invite?.expires_at && (
                      <div className="text-amber-100/70 mt-1 text-xs">
                        Invite expires on {new Date(inviteData.invite.expires_at).toLocaleString()}
                      </div>
                    )}
                    <div className="text-amber-100/70 mt-1 text-xs">
                      Address coordinates are detected automatically when you submit the form.
                    </div>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <FormField
                  label="Restaurant Name"
                  value={form.restaurantName}
                  onChange={(value) => setForm((current) => ({ ...current, restaurantName: value }))}
                  placeholder="Restaurant name"
                />
                <ReadOnlyField label="Restaurant Email" value={inviteData.restaurant?.contact_email || ''} />
                <FormField
                  label="Manager / Owner Name"
                  value={form.managerName}
                  onChange={(value) => setForm((current) => ({ ...current, managerName: value }))}
                  placeholder="Owner or manager name"
                />
                <FormField
                  label="Restaurant Phone"
                  value={form.contactPhone}
                  onChange={(value) => setForm((current) => ({ ...current, contactPhone: value }))}
                  placeholder="+1 (555) 000-0000"
                />
                <TextAreaField
                  label="Restaurant Address"
                  value={form.address}
                  onChange={(value) => setForm((current) => ({ ...current, address: value }))}
                  placeholder="123 Main St, City, State, Zip"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    label="Create Password"
                    type="password"
                    value={form.password}
                    onChange={(value) => setForm((current) => ({ ...current, password: value }))}
                    placeholder="At least 8 characters"
                  />
                  <FormField
                    label="Confirm Password"
                    type="password"
                    value={form.confirmPassword}
                    onChange={(value) => setForm((current) => ({ ...current, confirmPassword: value }))}
                    placeholder="Repeat password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 px-4 py-3 font-bold text-white shadow-lg shadow-orange-900/20 transition-all disabled:opacity-60"
                >
                  {submitting ? 'Completing Subscription...' : 'Complete Subscription'}
                </button>

                <div className="pt-2 text-center text-xs text-slate-500">
                  Already have an account?{' '}
                  <Link to="/admin/login" className="text-amber-400 hover:text-amber-300 font-semibold">
                    Sign in instead
                  </Link>
                </div>
              </form>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all"
      />
    </div>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{label}</label>
      <div className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-slate-300 break-all">
        {value || 'Unavailable'}
      </div>
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all resize-none"
      />
    </div>
  );
}
