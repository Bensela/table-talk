import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import MapDisplay from '../components/MapDisplay';

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [globalQuestions, setGlobalQuestions] = useState([]);
  const [loading, setLoading] = useState(false);

  // Registration form state
  const [form, setForm] = useState({
    name: '', slug: '', managerName: '',
    contactEmail: '', contactPhone: '',
    address: '', latitude: '', longitude: ''
  });
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Edit modal state
  const [editingTenant, setEditingTenant] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');

  // Toggle collapsed rows
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { fetchData(); }, []);

  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
  });

  const fetchData = async () => {
    try {
      const tenantsRes = await fetch('/api/admin/tenants', { headers: getHeaders() });
      if (tenantsRes.status === 401 || tenantsRes.status === 403) { navigate('/admin/login'); return; }
      const data = await tenantsRes.json();
      setTenants(Array.isArray(data) ? data : []);

      setGlobalQuestions([
        { id: 'q-uuid-1', text: 'If you could travel anywhere tomorrow, where would you go?' },
        { id: 'q-uuid-2', text: 'What is the most memorable meal you have ever had?' },
        { id: 'q-uuid-3', text: 'What quality do you value most in your friends?' },
        { id: 'q-uuid-4', text: 'What is your favorite way to unwind after a long day?' }
      ]);
    } catch (err) { console.error(err); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError(''); setFormSuccess(''); setLoading(true);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({
          name: form.name, slug: form.slug,
          managerName: form.managerName || null,
          contactEmail: form.contactEmail || null,
          contactPhone: form.contactPhone || null,
          address: form.address || null,
          latitude: form.latitude ? parseFloat(form.latitude) : null,
          longitude: form.longitude ? parseFloat(form.longitude) : null,
          adminEmail: adminEmail || null,
          adminPassword: adminPassword || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create tenant');
      setFormSuccess(`"${data.name}" registered successfully!`);
      setForm({ name: '', slug: '', managerName: '', contactEmail: '', contactPhone: '', address: '', latitude: '', longitude: '' });
      setAdminEmail(''); setAdminPassword('');
      fetchData();
    } catch (err) { setFormError(err.message); }
    finally { setLoading(false); }
  };

  const openEdit = (t) => {
    setEditingTenant(t);
    setEditForm({
      name: t.name || '', slug: t.slug || '',
      managerName: t.manager_name || '',
      contactEmail: t.contact_email || '',
      contactPhone: t.contact_phone || '',
      address: t.address || '',
      latitude: t.latitude != null ? String(t.latitude) : '',
      longitude: t.longitude != null ? String(t.longitude) : ''
    });
    setEditError(''); setEditSuccess('');
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setEditError(''); setEditSuccess(''); setLoading(true);
    try {
      const res = await fetch(`/api/admin/tenants/${editingTenant.id}`, {
        method: 'PATCH', headers: getHeaders(),
        body: JSON.stringify({
          name: editForm.name,
          slug: editForm.slug,
          managerName: editForm.managerName || null,
          contactEmail: editForm.contactEmail || null,
          contactPhone: editForm.contactPhone || null,
          address: editForm.address || null,
          latitude: editForm.latitude ? parseFloat(editForm.latitude) : null,
          longitude: editForm.longitude ? parseFloat(editForm.longitude) : null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setEditSuccess(`"${data.name}" updated!`);
      fetchData();
      setTimeout(() => setEditingTenant(null), 1500);
    } catch (err) { setEditError(err.message); }
    finally { setLoading(false); }
  };

  const toggleBilling = async (t) => {
    const next = t.billing_status === 'active' ? 'suspended' : 'active';
    try {
      const res = await fetch(`/api/admin/tenants/${t.id}`, {
        method: 'PATCH', headers: getHeaders(),
        body: JSON.stringify({ billing_status: next })
      });
      if (res.ok) fetchData();
    } catch (err) { console.error(err); }
  };

  const moveQuestion = async (idx, dir) => {
    const list = [...globalQuestions];
    const t = idx + dir;
    if (t < 0 || t >= list.length) return;
    [list[idx], list[t]] = [list[t], list[idx]];
    setGlobalQuestions(list);
    try {
      await fetch('/api/admin/questions/reshuffle', {
        method: 'PATCH', headers: getHeaders(),
        body: JSON.stringify({ question_ids: list.map(q => q.id) })
      });
    } catch (err) { console.error(err); }
  };

  const autoSlug = (name) => {
    setForm(f => ({ ...f, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      <header className="flex justify-between items-center mb-10 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Super Admin Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Manage restaurants, contacts, billing, and locations</p>
        </div>
        <button onClick={() => { localStorage.clear(); navigate('/admin/login'); }}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-4 py-2 rounded-xl transition-all">
          Sign Out
        </button>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left: Tenants Table + Questions */}
        <div className="xl:col-span-3 space-y-8">

          {/* Tenants List */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-md">
            <h2 className="text-xl font-bold mb-6">Registered Restaurants</h2>

            {/* Column headers */}
            <div className="grid grid-cols-12 gap-2 px-4 mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <div className="col-span-2">Name</div>
              <div className="col-span-2">Manager</div>
              <div className="col-span-2">Contact</div>
              <div className="col-span-3">Address</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <div className="space-y-2">
              {tenants.map(t => (
                <div key={t.id}>
                  {/* Row */}
                  <div className={`grid grid-cols-12 gap-2 items-center px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                    expandedId === t.id
                      ? 'bg-slate-800 border-purple-500/40'
                      : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                  }`}
                    onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  >
                    <div className="col-span-2 font-semibold text-white truncate">{t.name}</div>
                    <div className="col-span-2 text-sm text-slate-400 truncate">{t.manager_name || '—'}</div>
                    <div className="col-span-2 text-xs text-slate-500 truncate">
                      {t.contact_email ? <span className="text-slate-300">{t.contact_email}</span> : '—'}
                      {t.contact_phone && <span className="ml-1 text-slate-500">· {t.contact_phone}</span>}
                    </div>
                    <div className="col-span-3 text-xs text-slate-500 truncate">{t.address || '—'}</div>
                    <div className="col-span-1">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                        t.billing_status === 'active'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}>
                        {t.billing_status}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-2">
                      <button onClick={(e) => { e.stopPropagation(); toggleBilling(t); }}
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg border transition-all ${
                          t.billing_status === 'active'
                            ? 'border-rose-500/30 hover:bg-rose-500/10 text-rose-400'
                            : 'border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-400'
                        }`}>
                        {t.billing_status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); openEdit(t); }}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-600 hover:border-purple-500 hover:bg-purple-500/10 text-slate-400 hover:text-purple-300 transition-all">
                        Edit
                      </button>
                    </div>
                  </div>

                  {/* Expanded: Map + Details */}
                  <AnimatePresence>
                    {expandedId === t.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 py-4">
                          <div className="space-y-2 text-sm">
                            <h4 className="font-bold text-slate-300 text-xs uppercase tracking-wider">Location</h4>
                            {t.latitude && t.longitude ? (
                              <div className="text-xs text-slate-500 mb-1">
                                {parseFloat(t.latitude).toFixed(5)}, {parseFloat(t.longitude).toFixed(5)}
                              </div>
                            ) : null}
                            <MapDisplay
                              latitude={t.latitude} longitude={t.longitude} address={t.address}
                              height={160}
                            />
                          </div>
                          <div className="space-y-2 text-sm">
                            <h4 className="font-bold text-slate-300 text-xs uppercase tracking-wider">Details</h4>
                            <div className="space-y-1.5 text-xs">
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Slug</span><span className="text-slate-300">/{t.slug}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Manager</span><span className="text-slate-300">{t.manager_name || '—'}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Email</span><span className="text-slate-300">{t.contact_email || '—'}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Phone</span><span className="text-slate-300">{t.contact_phone || '—'}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Address</span><span className="text-slate-300">{t.address || '—'}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Created</span><span className="text-slate-300">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</span></div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
              {tenants.length === 0 && (
                <div className="py-12 text-center text-slate-500 text-sm">No restaurants registered yet.</div>
              )}
            </div>
          </div>

          {/* Global Questions */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-md">
            <h2 className="text-xl font-bold mb-2">Global Questions Sort Order</h2>
            <p className="text-xs text-slate-400 mb-6">Reshuffle default launch questions seen by all active tables</p>
            <div className="space-y-3">
              {globalQuestions.map((q, idx) => (
                <div key={q.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                  <span className="text-sm text-slate-300 pr-4">{q.text}</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => moveQuestion(idx, -1)} disabled={idx === 0}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-400 hover:text-white">
                      ▲
                    </button>
                    <button onClick={() => moveQuestion(idx, 1)} disabled={idx === globalQuestions.length - 1}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-400 hover:text-white">
                      ▼
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Registration Form */}
        <div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-md sticky top-6">
            <h2 className="text-xl font-bold mb-6">Register New Restaurant</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              {formError && <div className="bg-rose-500/20 border border-rose-500/50 text-rose-200 text-xs py-2 px-3 rounded-lg text-center">{formError}</div>}
              {formSuccess && <div className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 text-xs py-2 px-3 rounded-lg text-center">{formSuccess}</div>}

              <FormField label="Restaurant Name *" placeholder="The French Bistro"
                value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))}
                onBlur={() => !form.slug && autoSlug(form.name)} />
              <FormField label="URL Slug *" placeholder="french-bistro"
                value={form.slug} onChange={v => setForm(f => ({ ...f, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} />
              <FormField label="Manager / Owner Name" placeholder="Jean-Pierre Dubois"
                value={form.managerName} onChange={v => setForm(f => ({ ...f, managerName: v }))} />
              <FormField label="Contact Email" placeholder="contact@frenchbistro.com" type="email"
                value={form.contactEmail} onChange={v => setForm(f => ({ ...f, contactEmail: v }))} />
              <FormField label="Contact Phone" placeholder="+1 (555) 000-0000"
                value={form.contactPhone} onChange={v => setForm(f => ({ ...f, contactPhone: v }))} />
              <FormField label="Street Address" placeholder="123 Main St, New York, NY"
                value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} />

              <div className="grid grid-cols-2 gap-2">
                <FormField label="Latitude" placeholder="40.7128"
                  value={form.latitude} onChange={v => setForm(f => ({ ...f, latitude: v }))} />
                <FormField label="Longitude" placeholder="-74.0060"
                  value={form.longitude} onChange={v => setForm(f => ({ ...f, longitude: v }))} />
              </div>

              {/* Map preview */}
              {(form.latitude && form.longitude) && (
                <div className="rounded-xl overflow-hidden border border-slate-700">
                  <MapDisplay latitude={parseFloat(form.latitude)} longitude={parseFloat(form.longitude)} address={form.address} height={120} />
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 space-y-3">
                <p className="text-xs font-semibold text-purple-400">Optional: Restaurant Admin Account</p>
                <FormField label="Admin Email" placeholder="admin@frenchbistro.com" type="email"
                  value={adminEmail} onChange={setAdminEmail} />
                <FormField label="Password" placeholder="••••••••" type="password"
                  value={adminPassword} onChange={setAdminPassword} />
              </div>

              <button type="submit" disabled={loading}
                className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 text-sm mt-2">
                {loading ? 'Creating...' : 'Register Restaurant'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingTenant && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Edit Restaurant</h3>
                <button onClick={() => setEditingTenant(null)} className="text-slate-500 hover:text-white text-2xl leading-none">&times;</button>
              </div>
              {editError && <div className="bg-rose-500/20 border border-rose-500/50 text-rose-200 text-xs py-2 px-3 rounded-lg mb-4">{editError}</div>}
              {editSuccess && <div className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 text-xs py-2 px-3 rounded-lg mb-4">{editSuccess}</div>}
              <form onSubmit={handleUpdate} className="space-y-3">
                <FormField label="Restaurant Name" placeholder="Name"
                  value={editForm.name} onChange={v => setEditForm(f => ({ ...f, name: v }))} />
                <FormField label="URL Slug" placeholder="slug"
                  value={editForm.slug} onChange={v => setEditForm(f => ({ ...f, slug: v }))} />
                <FormField label="Manager / Owner Name" placeholder="Name"
                  value={editForm.managerName} onChange={v => setEditForm(f => ({ ...f, managerName: v }))} />
                <FormField label="Contact Email" placeholder="email" type="email"
                  value={editForm.contactEmail} onChange={v => setEditForm(f => ({ ...f, contactEmail: v }))} />
                <FormField label="Contact Phone" placeholder="phone"
                  value={editForm.contactPhone} onChange={v => setEditForm(f => ({ ...f, contactPhone: v }))} />
                <FormField label="Street Address" placeholder="Full address"
                  value={editForm.address} onChange={v => setEditForm(f => ({ ...f, address: v }))} />
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Latitude" placeholder="40.7128"
                    value={editForm.latitude} onChange={v => setEditForm(f => ({ ...f, latitude: v }))} />
                  <FormField label="Longitude" placeholder="-74.0060"
                    value={editForm.longitude} onChange={v => setEditForm(f => ({ ...f, longitude: v }))} />
                </div>
                {(editForm.latitude && editForm.longitude) && (
                  <div className="rounded-xl overflow-hidden border border-slate-700">
                    <MapDisplay
                      latitude={parseFloat(editForm.latitude)}
                      longitude={parseFloat(editForm.longitude)}
                      address={editForm.address}
                      height={120}
                    />
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setEditingTenant(null)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl transition-all text-sm">
                    Cancel
                  </button>
                  <button type="submit" disabled={loading}
                    className="flex-1 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 text-sm">
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FormField({ label, placeholder, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-all text-sm"
      />
    </div>
  );
}
