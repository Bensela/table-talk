import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { apiFetch, setAdminAuth } from '../api';

function getReturnToFromSearch(searchParams, fallback) {
  const candidate = searchParams.get('returnTo');
  if (!candidate || typeof candidate !== 'string') return fallback;
  // Safety: only allow relative URLs (no open redirects to other origins)
  if (!/^\/(?!\/|\\)/.test(candidate)) return fallback;
  // Block obvious attack strings
  if (/[<>\s]/.test(candidate) || /javascript:/i.test(candidate)) return fallback;
  return candidate;
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [resetLink, setResetLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetTokenStatus, setResetTokenStatus] = useState('unknown');
  const [resetTokenError, setResetTokenError] = useState('');
  const [invalidRedirectCountdown, setInvalidRedirectCountdown] = useState(null);
  const invalidCountdownRef = useRef(null);

  const clearInvalidCountdown = useCallback(() => {
    if (invalidCountdownRef.current) {
      clearInterval(invalidCountdownRef.current);
      invalidCountdownRef.current = null;
    }
  }, []);

  const startInvalidCountdown = useCallback((seconds) => {
    clearInvalidCountdown();
    const total = Math.max(1, Math.floor(Number(seconds) || 5));
    setInvalidRedirectCountdown(total);
    invalidCountdownRef.current = setInterval(() => {
      setInvalidRedirectCountdown((prev) => {
        if (prev == null) return null;
        const next = prev - 1;
        if (next <= 0) {
          clearInvalidCountdown();
          const loginTarget = searchParams.get('expiredReturn') ?
            `/admin/login?returnTo=${encodeURIComponent(searchParams.get('expiredReturn') || '/admin')}` :
            '/admin/login';
          navigate(loginTarget, { replace: true });
          return 0;
        }
        return next;
      });
    }, 1000);
  }, [clearInvalidCountdown, navigate, searchParams]);

  useEffect(() => () => clearInvalidCountdown(), [clearInvalidCountdown]);

  useEffect(() => {
    async function validateResetTokenFromUrl() {
      const token = searchParams.get('reset');
      if (!token) {
        return;
      }
      setView('reset');
      setResetToken(token);
      setResetTokenStatus('checking');
      setResetTokenError('');
      clearInvalidCountdown();
      try {
        const response = await apiFetch('/admin/validate-reset-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const rawText = await response.text();
        let data = {};
        try { data = rawText ? JSON.parse(rawText) : {}; } catch {}
        if (response.ok && data?.ok) {
          setResetTokenStatus('valid');
        } else {
          setResetTokenStatus('invalid');
          setResetTokenError(data?.error || 'Invalid or expired reset link');
          if (response.status === 410 || /expired/i.test(data?.error || '')) {
            startInvalidCountdown(5);
          }
        }
      } catch (err) {
        setResetTokenStatus('unknown');
      }
    }
    validateResetTokenFromUrl();
  }, [searchParams, clearInvalidCountdown, startInvalidCountdown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await apiFetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const rawText = await response.text();
      let data = {};

      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        if (response.status === 429) {
          const retrySec = data?.retry_after_seconds ? Number(data.retry_after_seconds) : null;
          throw new Error(data?.error || (retrySec ? `Too many attempts. Try again in ${retrySec}s.` : 'Too many login attempts.'));
        }
        throw new Error(data.error || `Login failed (${response.status})`);
      }

      // Store token and user details in localStorage
      setAdminAuth({ token: data.token, user: data.user });

      // Honor ?returnTo= (safe relative paths only) then fall back to role-based defaults.
      const roleDefault = data.user.role === 'SUPER_ADMIN' ? '/admin' : '/dashboard';
      const returnTo = getReturnToFromSearch(searchParams, roleDefault);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setResetLink('');
    setLoading(true);

    try {
      const response = await apiFetch('/admin/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const rawText = await response.text();
      let data = {};

      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      setSuccess(data.message || 'If an account exists, a reset link has been generated.');
      if (data.reset_url) {
        setResetLink(data.reset_url);
        setResetToken(data.reset_token || '');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (resetPassword !== resetPasswordConfirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await apiFetch('/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, new_password: resetPassword }),
      });

      const rawText = await response.text();
      let data = {};

      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        throw new Error(data.error || `Reset failed (${response.status})`);
      }

      setSuccess('Password updated. You can sign in now.');
      setResetPassword('');
      setResetPasswordConfirm('');
      setResetToken('');
      setResetLink('');
      setView('login');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyResetLink = async () => {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink);
      setSuccess('Reset link copied.');
    } catch {
      setError('Unable to copy reset link in this browser.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-slate-900 to-purple-900 flex items-center justify-center p-4 selection:bg-purple-500 selection:text-white">
      <div className="w-full max-w-md">
        {/* Glassmorphic card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, type: 'spring' }}
          className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl relative overflow-hidden"
        >
          <div className="absolute -top-16 -left-16 w-32 h-32 bg-purple-500/30 rounded-full blur-3xl" />
          <div className="absolute -bottom-16 -right-16 w-32 h-32 bg-indigo-500/30 rounded-full blur-3xl" />

          <div className="text-center mb-8 relative">
            <img src="/catalyst-logo.png" alt="Catalyst" className="w-20 h-20 mx-auto object-contain drop-shadow-lg mb-2" />
            <h1 className="text-3xl font-extrabold text-white mt-4 tracking-tight">
              {view === 'login' ? 'Admin Portal' : view === 'forgot' ? 'Reset Your Password' : 'Set a New Password'}
            </h1>
            {view === 'login' && <p className="text-purple-200 text-sm mt-2">Sign in to manage your Catalyst experience</p>}
            {view === 'forgot' && <p className="text-purple-200 text-sm mt-2">Enter your email and we&apos;ll generate a secure reset link</p>}
            {view === 'reset' && resetTokenStatus === 'valid' && <p className="text-purple-200 text-sm mt-2">Choose a strong new password for your account</p>}
          </div>

          <form
            onSubmit={view === 'login' ? handleSubmit : view === 'forgot' ? handleForgotPassword : handleResetPassword}
            className="space-y-6 relative"
          >
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-red-500/20 border border-red-500/50 text-red-200 text-sm py-3 px-4 rounded-xl text-center"
              >
                ⚠️ {error}
              </motion.div>
            )}
            {success && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 text-sm py-3 px-4 rounded-xl text-center"
              >
                ✅ {success}
              </motion.div>
            )}

            {view !== 'reset' && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-purple-200 mb-2">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@tabletalk.app"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-purple-300/40 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 transition-all"
                />
              </div>
            )}

            {view === 'login' && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-purple-200 mb-2">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-purple-300/40 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 transition-all"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setView('forgot');
                      setError('');
                      setSuccess('');
                      setResetLink('');
                    }}
                    className="text-xs font-semibold text-purple-200/80 hover:text-purple-100"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>
            )}

            {view === 'reset' && (
              <>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-purple-200 mb-2">Reset Token</label>
                  <input
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => { setResetToken(e.target.value); setResetTokenStatus('unknown'); setResetTokenError(''); }}
                    placeholder="Paste token"
                    disabled={resetTokenStatus === 'checking'}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-purple-300/40 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 transition-all disabled:opacity-60"
                  />
                </div>

                {resetTokenStatus === 'checking' && (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span className="text-sm text-purple-100">Validating reset link...</span>
                  </div>
                )}

                {resetTokenStatus === 'invalid' && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center flex-shrink-0 text-lg">⚠️</div>
                        <div className="flex-1">
                          <div className="font-semibold text-rose-100 text-sm">
                            {resetTokenError || 'Invalid or expired reset link'}
                          </div>
                          <div className="text-xs text-rose-200/70 mt-1 leading-relaxed">
                            For security, password reset links expire 30 minutes after they are created. Request a new reset link to continue.
                          </div>
                          <div className="flex flex-wrap gap-2 mt-3">
                            <button
                              type="button"
                              onClick={() => {
                                setView('forgot');
                                setError('');
                                setSuccess('');
                                setResetLink('');
                                setResetTokenStatus('unknown');
                                setResetTokenError('');
                              }}
                              className="rounded-xl bg-rose-500/80 hover:bg-rose-500 text-white text-xs font-bold px-4 py-2 transition-colors"
                            >
                              Request New Reset Link
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setView('login');
                                setError('');
                                setSuccess('');
                                setResetLink('');
                                setResetTokenStatus('unknown');
                                setResetTokenError('');
                              }}
                              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-purple-100 text-xs font-bold px-4 py-2 transition-colors"
                            >
                              Back to Sign In
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {invalidRedirectCountdown != null && invalidRedirectCountdown > 0 && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200 flex items-center justify-between">
                        <span>Automatically returning to sign in in {invalidRedirectCountdown} second{invalidRedirectCountdown === 1 ? '' : 's'}...</span>
                        <button
                          type="button"
                          onClick={() => { clearInvalidCountdown(); setInvalidRedirectCountdown(null); }}
                          className="ml-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1 font-bold text-amber-100 text-[11px] flex-shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {resetTokenStatus === 'valid' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-purple-200 mb-2">New Password</label>
                      <input
                        type="password"
                        required
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-purple-300/40 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-purple-200 mb-2">Confirm Password</label>
                      <input
                        type="password"
                        required
                        value={resetPasswordConfirm}
                        onChange={(e) => setResetPasswordConfirm(e.target.value)}
                        placeholder="Repeat password"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-purple-300/40 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 transition-all"
                      />
                    </div>
                  </>
                )}
              </>
            )}

            <button
              type="submit"
              disabled={loading || (view === 'reset' && (resetTokenStatus === 'checking' || resetTokenStatus === 'invalid'))}
              className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-3.5 px-4 rounded-xl transition-all hover:shadow-lg hover:shadow-purple-500/20 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? 'Working...'
                : view === 'login'
                  ? 'Sign In'
                  : view === 'forgot'
                    ? 'Send Reset Link'
                    : resetTokenStatus === 'invalid'
                      ? 'Link Is Invalid'
                      : 'Reset Password'}
            </button>

            {view === 'forgot' && (
              <div className="space-y-3">
                {resetLink && (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-purple-200 mb-2">Reset Link (Dev)</div>
                    <div className="break-all text-xs text-purple-100/80">{resetLink}</div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={copyResetLink}
                        className="flex-1 rounded-xl border border-purple-400/30 bg-purple-500/10 px-3 py-2 text-xs font-bold text-purple-100 hover:bg-purple-500/20"
                      >
                        Copy Link
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setView('reset');
                          setError('');
                          setSuccess('');
                        }}
                        className="flex-1 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-100 hover:bg-indigo-500/20"
                      >
                        Reset Now
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setView('login');
                    setError('');
                    setSuccess('');
                    setResetLink('');
                  }}
                  className="w-full text-xs font-semibold text-purple-200/80 hover:text-purple-100"
                >
                  Back to sign in
                </button>
              </div>
            )}

            {view === 'reset' && (
              <button
                type="button"
                onClick={() => {
                  setView('login');
                  setError('');
                  setSuccess('');
                  setResetLink('');
                }}
                className="w-full text-xs font-semibold text-purple-200/80 hover:text-purple-100"
              >
                Back to sign in
              </button>
            )}
          </form>
        </motion.div>
      </div>
    </div>
  );
}
