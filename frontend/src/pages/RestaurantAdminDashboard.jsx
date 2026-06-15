import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAdminAuth, getAdminHeaders } from '../hooks/useAdminAuth';
import MapDisplay from '../components/MapDisplay';

export default function RestaurantAdminDashboard() {
  const { checking, logout } = useAdminAuth();
  const [tables, setTables] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileEdit, setProfileEdit] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [tableNumber, setTableNumber] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const printAreaRef = useRef(null);

  // QR generation state
  const [qrModal, setQrModal] = useState(false);
  const [qrResults, setQrResults] = useState([]); // [{ id, table_number, url, qr }]
  const [selectedTables, setSelectedTables] = useState([]); // selected table IDs
  const [generatingQr, setGeneratingQr] = useState(false);

  // Loading guard — redirect to login if no token
  if (checking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const tablesRes = await fetch('/api/tenant/tables', { headers: getAdminHeaders() });
      const tablesData = await tablesRes.json();
      setTables(Array.isArray(tablesData) ? tablesData : []);

      const billingRes = await fetch('/api/tenant/billing', { headers: getAdminHeaders() });
      if (billingRes.ok) {
        const data = await billingRes.json();
        setProfile(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRegisterTable = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res = await fetch('/api/tenant/tables', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ table_number: tableNumber })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register table');

      setSuccess(`Table ${data.table_number} registered!`);
      setTableNumber('');
      fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openProfileEdit = () => {
    setEditForm({
      name: profile?.name || '',
      managerName: profile?.manager_name || '',
      contactEmail: profile?.contact_email || '',
      contactPhone: profile?.contact_phone || '',
      address: profile?.address || '',
      latitude: profile?.latitude != null ? String(profile.latitude) : '',
      longitude: profile?.longitude != null ? String(profile.longitude) : ''
    });
    setError(''); setSuccess('');
    setProfileEdit(true);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      const res = await fetch('/api/tenant/profile', {
        method: 'PATCH', headers: getHeaders(),
        body: JSON.stringify({
          name: editForm.name,
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
      setSuccess('Profile updated!');
      setProfile(prev => ({ ...prev, ...data }));
      setTimeout(() => setProfileEdit(false), 1500);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  // ── QR Code Generation ──────────────────────────────────────────────────────────
  const openQrModal = () => {
    setQrResults([]);
    setSelectedTables(tables.map(t => t.id));
    setQrModal(true);
  };

  const toggleTableSelection = (id) => {
    setSelectedTables(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const generateQrCodes = async () => {
    if (selectedTables.length === 0) return;
    setGeneratingQr(true);
    try {
      const selectedNumbers = tables
        .filter(t => selectedTables.includes(t.id))
        .map(t => t.table_number);

      const res = await fetch('/api/tenant/qr', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ tables: selectedNumbers })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate QR codes');
      setQrResults(data);
    } catch (err) { setError(err.message); }
    finally { setGeneratingQr(false); }
  };

  const downloadQr = (result) => {
    const link = document.createElement('a');
    link.href = result.qr;
    link.download = `qr-table-${result.table_number}.png`;
    link.click();
  };

  const handlePrint = (table) => {
    const printWindow = window.open('', '_blank');
    const html = `
      <html>
        <head>
          <title>Print QR - Table ${table.table_number}</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              text-align: center;
              padding: 40px;
              color: #1e293b;
            }
            .card {
              max-width: 320px;
              margin: 0 auto;
              border: 2px dashed #cbd5e1;
              border-radius: 24px;
              padding: 32px;
              box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            }
            .logo {
              font-size: 24px;
              font-weight: 800;
              margin-bottom: 24px;
              letter-spacing: -0.025em;
            }
            .logo span {
              color: #6366f1;
            }
            .qr-placeholder {
              width: 200px;
              height: 200px;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              margin: 0 auto 24px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 16px;
              position: relative;
            }
            .qr-code {
              font-size: 72px;
            }
            .table-label {
              font-size: 14px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.1em;
              color: #64748b;
              margin-bottom: 4px;
            }
            .table-number {
              font-size: 32px;
              font-weight: 900;
              margin-bottom: 16px;
            }
            .instruction {
              font-size: 12px;
              color: #94a3b8;
              line-height: 1.5;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="logo">Table<span>-Talk</span></div>
            <div class="qr-placeholder">
              <span class="qr-code">📱</span>
            </div>
            <div class="table-label">Table</div>
            <div class="table-number">${table.table_number}</div>
            <div class="instruction">
              Scan with your phone camera to join<br/>
              the conversational game at this table.
            </div>
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 pb-6 border-b border-slate-800 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {profile ? `${profile.name} Dashboard` : 'Restaurant Admin Dashboard'}
          </h1>
          <p className="text-slate-400 text-sm mt-1">Manage your restaurant profile, tables, and QR codes</p>
        </div>
        <div className="flex items-center gap-4">
          {profile && (
            <div className="text-right">
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                profile.billing_status === 'active'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
              }`}>
                Billing: {profile.billing_status}
              </span>
            </div>
          )}
          <button
            onClick={() => { localStorage.clear(); logout(); }}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-4 py-2 rounded-xl transition-all"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Profile Card */}
      {profile && (
        <div className="mb-8 bg-slate-800/50 border border-slate-700/50 rounded-3xl p-6 shadow-xl">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 space-y-3">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-bold">Restaurant Profile</h2>
                <button
                  onClick={openProfileEdit}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 text-indigo-400 transition-all"
                >
                  Edit Profile
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <ProfileField label="Manager / Owner" value={profile.manager_name} />
                <ProfileField label="Email" value={profile.contact_email} />
                <ProfileField label="Phone" value={profile.contact_phone} />
                <ProfileField label="Address" value={profile.address} />
                {profile.latitude && profile.longitude && (
                  <ProfileField label="Coordinates" value={`${parseFloat(profile.latitude).toFixed(5)}, ${parseFloat(profile.longitude).toFixed(5)}`} />
                )}
              </div>
            </div>
            {profile.latitude && profile.longitude && (
              <div className="w-full lg:w-80 shrink-0">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Location</h4>
                <div className="rounded-xl overflow-hidden border border-slate-700">
                  <MapDisplay latitude={profile.latitude} longitude={profile.longitude} address={profile.address} height={160} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Table Management List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-3xl p-6 shadow-xl backdrop-blur-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Registered Tables</h2>
              {tables.length > 0 && (
                <button
                  onClick={openQrModal}
                  className="text-xs font-bold px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center gap-1.5"
                >
                  <span>📱</span> Generate QR Codes
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tables.map(t => (
                <div key={t.id} className="bg-slate-950/40 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold tracking-wider text-indigo-400 uppercase">Table Number</span>
                    <h3 className="text-2xl font-black text-white mt-0.5">{t.table_number}</h3>
                    <p className="text-[10px] text-slate-500 truncate max-w-[200px] mt-1">{t.qr_code_url}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePrint(t)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all hover:shadow-lg hover:shadow-indigo-500/20 flex items-center gap-1.5"
                    >
                      <span>🖨️</span> Print QR
                    </button>
                  </div>
                </div>
              ))}
              {tables.length === 0 && (
                <div className="col-span-2 py-12 text-center text-slate-500">No tables registered yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Register Table form */}
        <div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-3xl p-6 shadow-xl backdrop-blur-md sticky top-6">
            <h2 className="text-xl font-bold mb-4">Register New Table</h2>
            <p className="text-xs text-slate-400 mb-6">Create a table mapping to automatically generate a conversational QR link</p>
            <form onSubmit={handleRegisterTable} className="space-y-4">
              {error && (
                <div className="bg-rose-500/20 border border-rose-500/50 text-rose-200 text-xs py-2 px-3 rounded-lg text-center">
                  ⚠️ {error}
                </div>
              )}
              {success && (
                <div className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 text-xs py-2 px-3 rounded-lg text-center">
                  ✅ {success}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Table Number / Label</label>
                <input
                  type="text"
                  required
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="e.g. 5A, 12, Terrace-1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 text-sm mt-6"
              >
                {loading ? 'Registering...' : 'Register Table'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Profile Edit Modal */}
      <AnimatePresence>
        {profileEdit && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Edit Restaurant Profile</h3>
                <button onClick={() => setProfileEdit(false)} className="text-slate-500 hover:text-white text-2xl leading-none">&times;</button>
              </div>
              {error && <div className="bg-rose-500/20 border border-rose-500/50 text-rose-200 text-xs py-2 px-3 rounded-lg mb-4">{error}</div>}
              {success && <div className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 text-xs py-2 px-3 rounded-lg mb-4">{success}</div>}
              <form onSubmit={handleSaveProfile} className="space-y-3">
                <Field label="Restaurant Name" placeholder="Name"
                  value={editForm.name} onChange={v => setEditForm(f => ({ ...f, name: v }))} />
                <Field label="Manager / Owner Name" placeholder="Name"
                  value={editForm.managerName} onChange={v => setEditForm(f => ({ ...f, managerName: v }))} />
                <Field label="Contact Email" placeholder="email" type="email"
                  value={editForm.contactEmail} onChange={v => setEditForm(f => ({ ...f, contactEmail: v }))} />
                <Field label="Contact Phone" placeholder="phone"
                  value={editForm.contactPhone} onChange={v => setEditForm(f => ({ ...f, contactPhone: v }))} />
                <Field label="Street Address" placeholder="Full address"
                  value={editForm.address} onChange={v => setEditForm(f => ({ ...f, address: v }))} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Latitude" placeholder="40.7128"
                    value={editForm.latitude} onChange={v => setEditForm(f => ({ ...f, latitude: v }))} />
                  <Field label="Longitude" placeholder="-74.0060"
                    value={editForm.longitude} onChange={v => setEditForm(f => ({ ...f, longitude: v }))} />
                </div>
                {(editForm.latitude && editForm.longitude) && (
                  <div className="rounded-xl overflow-hidden border border-slate-700">
                    <MapDisplay latitude={parseFloat(editForm.latitude)} longitude={parseFloat(editForm.longitude)} address={editForm.address} height={120} />
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setProfileEdit(false)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl transition-all text-sm">
                    Cancel
                  </button>
                  <button type="submit" disabled={loading}
                    className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 text-sm">
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QR Code Generation Modal */}
      <AnimatePresence>
        {qrModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-bold">Generate QR Codes</h3>
                  <p className="text-xs text-slate-400 mt-1">Select tables and generate downloadable QR images</p>
                </div>
                <button onClick={() => setQrModal(false)} className="text-slate-500 hover:text-white text-2xl leading-none">&times;</button>
              </div>

              {!qrResults.length ? (
                <>
                  {/* Table selection */}
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Select Tables</p>
                  <div className="flex gap-2 flex-wrap mb-4">
                    <button
                      onClick={() => setSelectedTables(tables.map(t => t.id))}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700 transition-all"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedTables([])}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 transition-all"
                    >
                      Clear
                    </button>
                    <span className="text-xs text-slate-500 self-center ml-1">
                      {selectedTables.length} of {tables.length} selected
                    </span>
                  </div>
                  <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
                    {tables.map(t => (
                      <label key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                        selectedTables.includes(t.id)
                          ? 'bg-indigo-600/10 border-indigo-500/40'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}>
                        <input
                          type="checkbox"
                          checked={selectedTables.includes(t.id)}
                          onChange={() => toggleTableSelection(t.id)}
                          className="accent-indigo-500 w-4 h-4"
                        />
                        <span className="text-sm font-bold text-white">{t.table_number}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setQrModal(false)}
                      className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl transition-all text-sm">
                      Cancel
                    </button>
                    <button onClick={generateQrCodes} disabled={selectedTables.length === 0 || generatingQr}
                      className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 text-sm">
                      {generatingQr ? 'Generating...' : `Generate ${selectedTables.length} QR Code${selectedTables.length !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* QR results grid */}
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm font-bold text-emerald-400">{qrResults.length} QR codes generated</p>
                    <button
                      onClick={() => { setQrResults([]); }}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-bold transition-colors"
                    >
                      ← Generate More
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-[60vh] overflow-y-auto mb-6">
                    {qrResults.map(r => (
                      <div key={r.id} className="bg-white rounded-2xl p-4 flex flex-col items-center text-center">
                        <p className="text-xs font-black text-slate-800 mb-2 tracking-wider uppercase">Table</p>
                        <p className="text-lg font-black text-slate-900 mb-3">{r.table_number}</p>
                        <img src={r.qr} alt={`QR for ${r.table_number}`} className="w-full rounded-xl" />
                        <div className="mt-2 flex gap-1 w-full">
                          <button
                            onClick={() => downloadQr(r)}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2 rounded-xl transition-all"
                          >
                            Download PNG
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setQrModal(false)}
                      className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl transition-all text-sm">
                      Done
                    </button>
                    <button
                      onClick={() => qrResults.forEach(r => downloadQr(r))}
                      className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold py-3 px-4 rounded-xl transition-all text-sm"
                    >
                      Download All as PNG
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProfileField({ label, value }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
      <div className="text-slate-200 text-sm">{value || '—'}</div>
    </div>
  );
}

function Field({ label, placeholder, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all text-sm"
      />
    </div>
  );
}
