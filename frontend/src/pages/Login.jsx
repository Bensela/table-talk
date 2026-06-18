import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function Login() {
  const navigate = useNavigate();
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if (token) {
      setView('reset');
      setResetToken(token);
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await fetch('/api/admin/login', {
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
        throw new Error(data.error || `Login failed (${response.status})`);
      }

      // Store token and user details in localStorage
      localStorage.setItem('adminToken', data.token);
      localStorage.setItem('adminUser', JSON.stringify(data.user));

      // Redirect depending on user role
      if (data.user.role === 'SUPER_ADMIN') {
        navigate('/admin');
      } else if (data.user.role === 'RESTAURANT_ADMIN') {
        navigate('/dashboard');
      }
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
      const response = await fetch('/api/admin/forgot-password', {
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
      const response = await fetch('/api/admin/reset-password', {
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
            <span className="text-4xl">🔑</span>
            <h1 className="text-3xl font-extrabold text-white mt-4 tracking-tight">Admin Portal</h1>
            <p className="text-purple-200 text-sm mt-2">Sign in to manage your Table-Talk experience</p>
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
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="Paste token"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-purple-300/40 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 transition-all"
                  />
                </div>
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

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-3.5 px-4 rounded-xl transition-all hover:shadow-lg hover:shadow-purple-500/20 active:scale-[0.99] disabled:opacity-50"
            >
              {loading
                ? 'Working...'
                : view === 'login'
                  ? 'Sign In'
                  : view === 'forgot'
                    ? 'Send Reset Link'
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
