import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function RestaurantSubscriptionPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [inviteData, setInviteData] = useState(null);
  const [form, setForm] = useState({
    restaurantName: '',
    managerName: '',
    contactPhone: '',
    address: '',
    password: '',
    confirmPassword: ''
  });

  useEffect(() => {
    async function loadInvite() {
      try {
        setLoading(true);
        setError('');
        const response = await fetch(`/api/public/restaurant-invites/${token}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Invite could not be loaded');
        }

        setInviteData(data);
        setForm((current) => ({
          ...current,
          restaurantName: data.restaurant?.name || '',
          managerName: data.restaurant?.manager_name || '',
          contactPhone: data.restaurant?.contact_phone || '',
          address: data.restaurant?.address || ''
        }));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      loadInvite();
    }
  }, [token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
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
        throw new Error(data.error || 'Subscription could not be completed');
      }

      localStorage.setItem('adminToken', data.token);
      localStorage.setItem('adminUser', JSON.stringify(data.user));
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/80 border border-slate-800 rounded-3xl shadow-2xl p-6 md:p-8"
        >
          <div className="mb-8">
            <h1 className="text-3xl font-extrabold tracking-tight">Complete Your Restaurant Subscription</h1>
            <p className="text-slate-400 text-sm mt-2">
              Finish the remaining onboarding details and create your restaurant admin login.
            </p>
          </div>

          {error && (
            <div className="mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          {!error && inviteData && (
            <div className="mb-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
              <div className="font-semibold">{inviteData.restaurant?.name}</div>
              <div className="text-cyan-100/80">{inviteData.restaurant?.contact_email}</div>
              <div className="text-cyan-100/70 mt-1">
                Address coordinates are detected automatically when you submit the form.
              </div>
            </div>
          )}

          {inviteData && (
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
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 font-bold text-white transition hover:from-cyan-600 hover:to-blue-600 disabled:opacity-60"
              >
                {submitting ? 'Completing Subscription...' : 'Complete Subscription'}
              </button>
            </form>
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
        className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
      />
    </div>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{label}</label>
      <div className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-slate-300">
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
        className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
      />
    </div>
  );
}
