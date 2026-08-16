import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '../api';
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
  const [addressLookup, setAddressLookup] = useState({ loading: false, error: '', resolvedAddress: '' });
  const [printPaperSize, setPrintPaperSize] = useState('letter');
  const [printingTableId, setPrintingTableId] = useState(null);
  const printAreaRef = useRef(null);
  const addressLookupRequestRef = useRef(0);

  // Billing / subscription state
  const [plans, setPlans] = useState([]);
  const [billingProvider, setBillingProvider] = useState('manual');
  const [billingActionLoading, setBillingActionLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [billingSuccess, setBillingSuccess] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [paymentGateway, setPaymentGateway] = useState(null);
  const [paymentGatewayLoading, setPaymentGatewayLoading] = useState(false);

  // QR generation state
  const [qrModal, setQrModal] = useState(false);
  const [qrResults, setQrResults] = useState([]); // [{ id, table_number, url, qr }]
  const [selectedTables, setSelectedTables] = useState([]); // selected table IDs
  const [generatingQr, setGeneratingQr] = useState(false);

  useEffect(() => {
    if (!checking) {
      fetchData();
    }
  }, [checking]);

  useEffect(() => {
    if (!profileEdit) {
      return undefined;
    }

    const trimmedAddress = String(editForm.address || '').trim();

    if (!trimmedAddress) {
      setAddressLookup({ loading: false, error: '', resolvedAddress: '' });
      setEditForm((current) => (
        current.latitude || current.longitude
          ? { ...current, latitude: '', longitude: '' }
          : current
      ));
      return undefined;
    }

    if (trimmedAddress.length < 10) {
      setAddressLookup((current) => ({ ...current, loading: false, error: '', resolvedAddress: '' }));
      return undefined;
    }

    if (
      addressLookup.resolvedAddress === trimmedAddress &&
      String(editForm.latitude || '').trim() &&
      String(editForm.longitude || '').trim()
    ) {
      return undefined;
    }

    const requestId = addressLookupRequestRef.current + 1;
    addressLookupRequestRef.current = requestId;

    const timeoutId = window.setTimeout(async () => {
      try {
        setAddressLookup({ loading: true, error: '', resolvedAddress: '' });

        const response = await apiFetch('/admin/geocode-address', {
          method: 'POST',
          headers: getAdminHeaders(),
          body: JSON.stringify({ address: trimmedAddress })
        });

        const data = await response.json();

        if (requestId !== addressLookupRequestRef.current) {
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || 'Unable to locate that address');
        }

        setEditForm((current) => {
          if (String(current.address || '').trim() !== trimmedAddress) {
            return current;
          }

          return {
            ...current,
            latitude: String(data.latitude),
            longitude: String(data.longitude)
          };
        });

        setAddressLookup({ loading: false, error: '', resolvedAddress: trimmedAddress });
      } catch (err) {
        if (requestId !== addressLookupRequestRef.current) {
          return;
        }

        setAddressLookup({ loading: false, error: err.message, resolvedAddress: '' });
      }
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [profileEdit, editForm.address, editForm.latitude, editForm.longitude, addressLookup.resolvedAddress]);

  const fetchData = async () => {
    try {
      const tablesRes = await apiFetch('/tenant/tables', { headers: getAdminHeaders() });
      const tablesData = await tablesRes.json();
      setTables(Array.isArray(tablesData) ? tablesData : []);

      const [profileRes, billingRes, plansRes, invoicesRes, pgRes] = await Promise.all([
        apiFetch('/tenant/profile', { headers: getAdminHeaders() }),
        apiFetch('/tenant/billing', { headers: getAdminHeaders() }),
        apiFetch('/admin/plans'),
        apiFetch('/tenant/billing/invoices', { headers: getAdminHeaders() }),
        (async () => {
          try {
            setPaymentGatewayLoading(true);
            return await apiFetch('/tenant/billing/payment-gateway', { headers: getAdminHeaders() });
          } finally {
            setPaymentGatewayLoading(false);
          }
        })()
      ]);

      const billingMerged = {};
      if (billingRes.ok) {
        const data = await billingRes.json();
        Object.assign(billingMerged, data?.billing || data || {});
        setBillingProvider(data?.billing_provider || 'manual');
      }
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        Object.assign(billingMerged, profileData);
      }
      if (Object.keys(billingMerged).length) {
        setProfile((prev) => ({ ...(prev || {}), ...billingMerged }));
      }
      if (plansRes.ok) {
        const plansData = await plansRes.json();
        setPlans(Array.isArray(plansData?.plans) ? plansData.plans : []);
        if (plansData?.billing_provider) {
          setBillingProvider(plansData.billing_provider);
        }
      }
      if (invoicesRes.ok) {
        const inv = await invoicesRes.json();
        setInvoices(Array.isArray(inv?.invoices) ? inv.invoices : []);
      }
      if (pgRes?.ok) {
        const pg = await pgRes.json();
        setPaymentGateway(pg);
      } else {
        setPaymentGateway({
          provider: billingProvider === 'stripe' ? 'stripe' : 'manual',
          mode: 'test',
          publishable_key: '',
          has_secret_key: billingProvider === 'stripe',
          has_webhook_secret: false,
          restaurant_stripe_customer_id: null,
          restaurant_stripe_subscription_id: null,
          sources: {}
        });
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
      const res = await apiFetch('/tenant/tables', {
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
    setAddressLookup({
      loading: false,
      error: '',
      resolvedAddress: profile?.address && profile?.latitude != null && profile?.longitude != null ? profile.address : ''
    });
    setError(''); setSuccess('');
    setProfileEdit(true);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      const res = await apiFetch('/tenant/profile', {
        method: 'PATCH', headers: getAdminHeaders(),
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

  // ── Billing / Subscription actions ───────────────────────────────────────────────
  const currentPlan = profile?.plan || 'trial';
  const isTrial = currentPlan === 'trial';
  const canGenerateQr = profile && typeof profile.can_generate_qr === 'boolean' ? profile.can_generate_qr : !isTrial;
  const computedBillingStatus = profile?.computed_status || profile?.billing_status || 'pending';

  const handleCheckout = async (planKey) => {
    setBillingError('');
    setBillingSuccess('');
    setBillingActionLoading(true);
    try {
      const res = await apiFetch('/tenant/billing/checkout', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ plan: planKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to start checkout');
      if (data?.url) {
        window.location.href = data.url;
      } else if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        setBillingSuccess('Plan activated.');
        fetchData();
      }
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setBillingActionLoading(false);
    }
  };

  const handleOpenBillingPortal = async () => {
    setBillingError('');
    setBillingSuccess('');
    setBillingActionLoading(true);
    try {
      const res = await apiFetch('/tenant/billing/portal', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to open billing portal');
      if (data?.url) {
        window.location.href = data.url;
      } else if (data?.portal_url) {
        window.location.href = data.portal_url;
      } else {
        setBillingSuccess('Billing updated.');
        fetchData();
      }
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setBillingActionLoading(false);
    }
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

      const res = await apiFetch('/tenant/qr', {
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

  const handlePrint = async (table) => {
    setError('');
    setSuccess('');
    setPrintingTableId(table.id);

    try {
      const res = await apiFetch('/tenant/qr', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ tables: [table.table_number] })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate QR code');
      }

      const qrEntry = Array.isArray(data) ? data[0] : null;
      if (!qrEntry?.qr) {
        throw new Error('QR code data is missing');
      }

      const paperSizeCss = printPaperSize === 'a4'
        ? 'A4'
        : printPaperSize === 'a5'
          ? 'A5'
          : 'Letter';

      const restaurantName = profile?.name || 'Catalyst';
      const printWindow = window.open('', '_blank');
      const html = `
      <html>
        <head>
          <title>Print QR - Table ${table.table_number}</title>
          <style>
            @page {
              size: ${paperSizeCss};
              margin: 14mm;
            }
            @media print {
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
            body {
              font-family: system-ui, -apple-system, sans-serif;
              margin: 0;
              padding: 0;
              color: #1e293b;
              background: #ffffff;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
            }
            .card {
              max-width: 320px;
              margin: 0 auto;
              border: 2px dashed rgba(148, 163, 184, 0.8);
              border-radius: 24px;
              padding: 32px;
              box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            }
            .restaurant {
              font-size: 14px;
              font-weight: 800;
              color: #0f172a;
              text-transform: uppercase;
              letter-spacing: 0.14em;
              margin-bottom: 14px;
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
            .qr-frame {
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
              overflow: hidden;
            }
            .qr-frame img {
              width: 100%;
              height: 100%;
              object-fit: cover;
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
            <div class="restaurant">${restaurantName}</div>
            <div class="logo">Table<span>-Talk</span></div>
            <div class="qr-frame">
              <img src="${qrEntry.qr}" alt="QR code for table ${table.table_number}" />
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
    } catch (err) {
      setError(err.message);
    } finally {
      setPrintingTableId(null);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
            <div className="text-right flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-[0.2em] border ${
                  currentPlan === 'trial'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : currentPlan === 'starter'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                      : currentPlan === 'premium'
                        ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                        : currentPlan === 'enterprise'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                }`}>
                  {formatPlanLabel(currentPlan)}
                </span>
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${
                  computedBillingStatus === 'active'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : computedBillingStatus === 'trialing'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : computedBillingStatus === 'past_due'
                        ? 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                        : computedBillingStatus === 'canceled' || computedBillingStatus === 'cancel_at_period_end'
                          ? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                          : computedBillingStatus === 'suspended' || computedBillingStatus === 'unpaid'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                }`}>
                  {formatStatusLabel(computedBillingStatus)}
                </span>
              </div>
              <span className="text-[11px] text-slate-500">Provider: {billingProvider}</span>
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
            {(profile.latitude && profile.longitude) || profile.address ? (
              <div className="w-full lg:w-80 shrink-0">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Location</h4>
                <div className="rounded-xl overflow-hidden border border-slate-700">
                  <MapDisplay latitude={profile.latitude} longitude={profile.longitude} address={profile.address} height={160} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Subscription & Billing Card */}
      {profile && (
        <section className="mb-8 bg-slate-800/50 border border-slate-700/50 rounded-3xl p-6 shadow-xl">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-violet-200 mb-3">
                Subscription
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-white">Your Plan &amp; Billing</h2>
              <p className="text-sm text-slate-400 mt-2 max-w-2xl">
                Upgrade, manage your subscription, or open the billing portal. Trial-period QR codes are provisioned by the Catalyst Super Admin team during onboarding.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenBillingPortal}
                disabled={billingActionLoading || billingProvider !== 'stripe' || !profile?.stripe_customer_id}
                className="rounded-xl border border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20 px-4 py-2.5 text-sm font-bold text-violet-200 transition-all disabled:opacity-40"
                title={billingProvider !== 'stripe' ? 'Stripe billing is not configured for this environment.' : !profile?.stripe_customer_id ? 'No Stripe customer linked yet. Complete a checkout first.' : ''}
              >
                {billingActionLoading ? 'Loading…' : 'Manage Billing'}
              </button>
              <button
                type="button"
                onClick={() => fetchData()}
                className="rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-900/90 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-slate-300 transition-all"
              >
                Refresh
              </button>
            </div>
          </div>

          {billingError && (
            <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">{billingError}</div>
          )}
          {billingSuccess && (
            <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">{billingSuccess}</div>
          )}

          {isTrial && !canGenerateQr && (
            <div className="mb-6 rounded-2xl border border-amber-500/40 bg-[linear-gradient(135deg,rgba(251,191,36,0.14),rgba(251,146,60,0.06))] p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <h3 className="text-base font-extrabold text-amber-200">You are in your trial period.</h3>
                  <p className="text-sm text-slate-300 mt-1.5 max-w-2xl">
                    Trial QR codes and tables are generated and delivered by the Catalyst Super Admin team. If you haven&apos;t received them yet, contact your onboarding contact or support.
                  </p>
                  {profile?.trial_ends_at && (
                    <div className="text-xs text-amber-200/90 mt-2">
                      Trial ends on {new Date(profile.trial_ends_at).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 w-full lg:w-64 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCheckout('starter')}
                    disabled={billingActionLoading || billingProvider !== 'stripe'}
                    className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white text-sm font-bold py-2.5 px-4 transition-all disabled:opacity-40"
                  >
                    Upgrade to Starter
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCheckout('premium')}
                    disabled={billingActionLoading || billingProvider !== 'stripe'}
                    className="rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white text-sm font-bold py-2.5 px-4 transition-all disabled:opacity-40"
                  >
                    Upgrade to Premium
                  </button>
                  {billingProvider !== 'stripe' && (
                    <div className="text-[11px] text-slate-400">
                      Manual billing mode — contact support to process your upgrade.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {computedBillingStatus === 'suspended' && (
            <div className="mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4">
              <div className="text-sm font-bold text-rose-200">Your billing is suspended.</div>
              <div className="text-xs text-rose-200/90 mt-1">
                Please settle outstanding invoices or contact support to restore access to QR generation and advanced features.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 2xl:grid-cols-[1.1fr_0.9fr] gap-6 mb-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">Current Entitlements</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <MiniStat label="Plan" value={formatPlanLabel(currentPlan)} />
                <MiniStat label="Max Tables" value={profile?.max_tables ?? 'Unlimited'} />
                <MiniStat label="Sessions/Mo" value={profile?.max_monthly_sessions ?? 'Unlimited'} />
                <MiniStat label="Support Tier" value={profile?.support_tier || 'Standard'} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <EntitlementChip label="Generate QR" enabled={Boolean(canGenerateQr)} />
                <EntitlementChip label="Dual-Phone" enabled={Boolean(profile?.can_use_dual_phone_sessions)} />
                <EntitlementChip label="Export Analytics" enabled={Boolean(profile?.can_export_analytics)} />
                <EntitlementChip label="Custom QR Brand" enabled={Boolean(profile?.can_use_custom_qr_branding)} />
                <EntitlementChip label="Support" enabled={Boolean(profile?.can_access_support)} />
              </div>
              <div className="mt-4 text-xs text-slate-400 space-y-1">
                {profile?.subscription_started_at && <div>Subscription started: {new Date(profile.subscription_started_at).toLocaleDateString()}</div>}
                {profile?.subscription_current_period_end && <div>Renewal / next billing: {new Date(profile.subscription_current_period_end).toLocaleString()}</div>}
                {profile?.subscription_cancel_at_period_end && <div className="text-amber-300">Your subscription cancels at the end of the current billing period.</div>}
                {profile?.stripe_subscription_id ? <div>Stripe subscription linked.</div> : <div>No Stripe subscription linked.</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Available Plans</div>
                <div className="text-[11px] text-slate-500">
                  {billingProvider === 'stripe' ? 'Checkout via Stripe' : 'Manual invoicing'}
                </div>
              </div>
              <div className="space-y-3">
                {(plans.length ? plans : [{ key: 'starter', name: 'Starter', tagline: 'Core venues', monthly_amount: 4900, currency: 'USD', interval: 'month', features: ['Unlimited single-phone sessions', 'Up to 20 tables', 'Analytics dashboard'], defaults: {} }, { key: 'premium', name: 'Premium', tagline: 'Growing venues', monthly_amount: 14900, currency: 'USD', interval: 'month', features: ['Everything in Starter', 'Dual-phone sessions', 'Custom QR branding'], defaults: {} }]).map((plan) => (
                  <div key={plan.key} className={`rounded-2xl border p-4 transition-all ${
                    currentPlan === plan.key ? 'border-violet-500/50 bg-violet-500/5' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                  }`}>
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.18em] border ${
                            plan.key === 'starter'
                              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                              : plan.key === 'premium'
                                ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                                : plan.key === 'enterprise'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          }`}>
                            {plan.name}
                          </span>
                          {currentPlan === plan.key && (
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Current</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">{plan.tagline || ''}</div>
                        <div className="mt-2 text-sm text-slate-300 line-clamp-2">
                          {Array.isArray(plan.features) ? plan.features.slice(0, 3).join(' · ') : ''}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="text-right">
                          <div className="text-xl font-extrabold text-white">
                            {(plan?.currency || 'USD')} {typeof plan?.monthly_amount === 'number'
                              ? (plan.monthly_amount / 100).toFixed(2)
                              : plan?.monthly_amount ?? '—'}
                          </div>
                          <div className="text-[11px] text-slate-500 uppercase tracking-wider">per {plan?.interval || 'month'}</div>
                        </div>
                        {plan.key !== currentPlan ? (
                          <button
                            type="button"
                            onClick={() => handleCheckout(plan.key)}
                            disabled={billingActionLoading || billingProvider !== 'stripe'}
                            className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-xs font-bold py-2 px-4 transition-all disabled:opacity-40 whitespace-nowrap"
                          >
                            {billingProvider === 'stripe' ? `Upgrade to ${plan.name}` : 'Contact support'}
                          </button>
                        ) : (
                          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300">✓ Active</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-emerald-200">Need Enterprise?</div>
                    <div className="text-xs text-slate-400 mt-1">Dedicated support, multi-location rollout, SSO, custom branding, and SLA.</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenBillingPortal}
                    disabled={billingActionLoading}
                    className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.2em] text-emerald-200 transition-all disabled:opacity-40 whitespace-nowrap"
                  >
                    Contact Sales
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Recent Invoices &amp; Billing Events</div>
                <div className="text-xs text-slate-500 mt-1">Mirror of your Stripe invoices / manual billing entries.</div>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto border border-slate-800 rounded-xl divide-y divide-slate-800">
              {invoices.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-500">No invoices on file yet.</div>
              )}
              {invoices.map((inv) => (
                <div key={inv.invoice_id || inv.id} className="grid grid-cols-12 gap-2 items-center px-4 py-3 text-xs">
                  <div className="col-span-4 font-semibold text-white truncate">
                    {inv.provider_invoice_number || inv.invoice_number || inv.invoice_id || `#${inv.id || '—'}`}
                  </div>
                  <div className="col-span-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${
                      inv.status === 'paid'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : inv.status === 'open'
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          : inv.status === 'void'
                            ? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    }`}>
                      {formatStatusLabel(inv.status || 'pending')}
                    </span>
                  </div>
                  <div className="col-span-2 text-slate-300">
                    {inv.currency || 'USD'} {typeof inv.amount_cents === 'number' ? (inv.amount_cents / 100).toFixed(2) : inv.amount_total ?? '—'}
                  </div>
                  <div className="col-span-2 text-slate-500 truncate">
                    {inv.paid_at || inv.period_end || inv.created_at ? new Date(inv.paid_at || inv.period_end || inv.created_at).toLocaleDateString() : '—'}
                  </div>
                  <div className="col-span-2 text-right">
                    {inv.hosted_invoice_url || inv.invoice_pdf ? (
                      <a
                        href={inv.hosted_invoice_url || inv.invoice_pdf}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-300 hover:border-indigo-500 hover:text-indigo-300 transition-colors"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Payment Gateway Card */}
      <section className="mb-8 bg-slate-800/50 border border-slate-700/50 rounded-3xl p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-sky-200 mb-3">
              Platform
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-white">Payment Gateway</h2>
            <p className="text-sm text-slate-400 mt-2 max-w-2xl">
              Billing for this venue uses the platform-wide payment gateway configured by your Catalyst onboarding team.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchData()}
              className="rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-900/90 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-slate-300 transition-all"
            >
              {paymentGatewayLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={handleOpenBillingPortal}
              disabled={billingActionLoading || !paymentGateway || paymentGateway.provider !== 'stripe' || !paymentGateway.has_secret_key || !profile?.stripe_customer_id}
              className="rounded-xl bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 hover:brightness-110 text-white text-sm font-bold py-2.5 px-4 transition-all disabled:opacity-40 shadow-lg shadow-indigo-500/20"
              title={
                paymentGateway?.provider !== 'stripe'
                  ? 'The platform is operating in manual billing mode.'
                  : !paymentGateway?.has_secret_key
                    ? 'Stripe is not connected yet — your onboarding team will enable checkout soon.'
                    : !profile?.stripe_customer_id
                      ? 'No Stripe customer linked yet — complete your first checkout first.'
                      : ''
              }
            >
              {billingActionLoading ? 'Loading…' : 'Visit Billing Portal'}
            </button>
          </div>
        </div>

        {paymentGatewayLoading && !paymentGateway && (
          <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-950/60 px-5 py-8 text-center text-sm text-slate-500">
            Loading payment gateway…
          </div>
        )}

        {paymentGateway && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">Provider</div>
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-2xl flex items-center justify-center text-lg font-extrabold ${
                  paymentGateway.provider === 'stripe'
                    ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white'
                    : 'bg-slate-700 text-slate-300'
                }`}>
                  {paymentGateway.provider === 'stripe' ? 'S' : 'M'}
                </div>
                <div>
                  <div className="text-lg font-extrabold text-white">
                    {paymentGateway.provider === 'stripe' ? 'Stripe' : 'Manual Billing'}
                  </div>
                  <div className="text-xs text-slate-400">
                    {paymentGateway.provider === 'stripe' ? 'Platform Stripe account' : 'Invoiced by Catalyst team'}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">Environment</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[11px] font-bold uppercase tracking-[0.18em] px-2.5 py-1 rounded-full border ${
                  paymentGateway.mode === 'live'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                }`}>
                  Mode: {paymentGateway.mode === 'live' ? 'Live' : 'Test'}
                </span>
                <span className={`text-[11px] font-bold uppercase tracking-[0.18em] px-2.5 py-1 rounded-full border ${
                  paymentGateway.provider === 'stripe' && paymentGateway.has_secret_key
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-600 bg-slate-800 text-slate-300'
                }`}>
                  {paymentGateway.provider === 'stripe' && paymentGateway.has_secret_key ? 'Stripe Connected' : 'Stripe Inactive'}
                </span>
                {paymentGateway.has_webhook_secret && (
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] px-2.5 py-1 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-200">
                    Webhooks active
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">Account Linkage</div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Stripe customer</span>
                  <span className={`font-mono ${paymentGateway.restaurant_stripe_customer_id ? 'text-emerald-200' : 'text-slate-500'}`}>
                    {paymentGateway.restaurant_stripe_customer_id || 'Not linked'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Subscription</span>
                  <span className={`font-mono ${paymentGateway.restaurant_stripe_subscription_id ? 'text-emerald-200' : 'text-slate-500'}`}>
                    {paymentGateway.restaurant_stripe_subscription_id || 'None'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {paymentGateway && paymentGateway.provider === 'manual' && (
          <div className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4">
            <div className="text-sm font-bold text-amber-200">Your venue is on manual invoicing.</div>
            <div className="text-xs text-amber-200/90 mt-1">
              The Catalyst team handles billing and onboarding for your venue directly. To activate Stripe Checkout and the self-serve Billing Portal, contact your onboarding contact or Catalyst support.
            </div>
          </div>
        )}

        {paymentGateway && paymentGateway.provider === 'stripe' && !paymentGateway.has_secret_key && (
          <div className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4">
            <div className="text-sm font-bold text-amber-200">Stripe is not yet connected for this environment.</div>
            <div className="text-xs text-amber-200/90 mt-1">
              Your onboarding team is finalizing Stripe credentials. Checkout and portal actions will be enabled once credentials are live.
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Table Management List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-3xl p-6 shadow-xl backdrop-blur-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Registered Tables</h2>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Paper</span>
                  <select
                    value={printPaperSize}
                    onChange={(event) => setPrintPaperSize(event.target.value)}
                    className="bg-transparent text-xs font-semibold text-slate-200 focus:outline-none"
                  >
                    <option value="letter">Letter</option>
                    <option value="a4">A4</option>
                    <option value="a5">A5</option>
                  </select>
                </div>
                {tables.length > 0 && (
                  canGenerateQr ? (
                    <button
                      onClick={openQrModal}
                      className="text-xs font-bold px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center gap-1.5"
                    >
                      <span>📱</span> Generate QR Codes
                    </button>
                  ) : (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200">
                      Trial QRs provided by Super Admin
                    </div>
                  )
                )}
              </div>
            </div>
            {!canGenerateQr && (
              <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-200/90">
                During the trial period, QR codes are issued by the Catalyst Super Admin team. Once provisioned, they will appear here and you can print them. Upgrade to a paid plan to self-serve QR generation.
              </div>
            )}
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
                      disabled={printingTableId === t.id}
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
            <p className="text-xs text-slate-400 mb-6">
              {canGenerateQr
                ? 'Create a table mapping to automatically generate a conversational QR link'
                : 'Trial tables are created and provisioned by the Catalyst Super Admin team. Upgrade to self-serve.'}
            </p>
            {!canGenerateQr && (
              <div className="mb-5 rounded-2xl border border-amber-500/40 bg-[linear-gradient(135deg,rgba(251,191,36,0.14),rgba(251,146,60,0.06))] px-4 py-4">
                <div className="text-sm font-extrabold text-amber-200 mb-1">Registration locked during trial</div>
                <div className="text-xs text-slate-300">
                  Your onboarding contact will provision your initial tables and QR codes. After trial, you can add and regenerate tables at any time.
                </div>
              </div>
            )}
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
                  disabled={!canGenerateQr}
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="e.g. 5A, 12, Terrace-1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !canGenerateQr}
                className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 text-sm mt-6 disabled:cursor-not-allowed"
              >
                {loading
                  ? 'Registering...'
                  : canGenerateQr
                    ? 'Register Table'
                    : 'Registration locked during trial'}
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
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs text-slate-400">
                  {addressLookup.loading
                    ? 'Looking up latitude and longitude from the address...'
                    : addressLookup.error
                      ? addressLookup.error
                      : 'Latitude and longitude are filled automatically when the address is recognized.'}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Latitude" placeholder="40.7128"
                    value={editForm.latitude} onChange={v => setEditForm(f => ({ ...f, latitude: v }))} />
                  <Field label="Longitude" placeholder="-74.0060"
                    value={editForm.longitude} onChange={v => setEditForm(f => ({ ...f, longitude: v }))} />
                </div>
                {((editForm.latitude && editForm.longitude) || editForm.address) && (
                  <div className="rounded-xl overflow-hidden border border-slate-700">
                    <MapDisplay
                      latitude={editForm.latitude ? parseFloat(editForm.latitude) : null}
                      longitude={editForm.longitude ? parseFloat(editForm.longitude) : null}
                      address={editForm.address}
                      height={120}
                    />
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

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-500/20 to-slate-400/10 px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">{label}</div>
      <div className="text-lg font-extrabold mt-1 leading-none text-slate-100">{value}</div>
    </div>
  );
}

function EntitlementChip({ label, enabled, value }) {
  const cls = enabled ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30' : 'bg-slate-500/15 text-slate-400 border border-slate-500/30';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-bold uppercase tracking-wider ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-slate-500'}`} />
      {label}{value ? ` · ${value}` : ''}
    </span>
  );
}

function formatPlanLabel(plan) {
  const map = { trial: 'Trial', starter: 'Starter', premium: 'Premium', enterprise: 'Enterprise', free: 'Free', pro: 'Pro' };
  return map[plan] || 'Trial';
}

function formatStatusLabel(status) {
  const key = String(status || 'pending').toLowerCase().trim();
  const map = {
    active: 'Active',
    trialing: 'Trialing',
    pending: 'Pending',
    past_due: 'Past Due',
    canceled: 'Canceled',
    suspended: 'Suspended',
    cancel_at_period_end: 'Canceling',
    unpaid: 'Unpaid',
    incomplete: 'Incomplete',
    incomplete_expired: 'Expired',
    paid: 'Paid',
    open: 'Open',
    void: 'Void'
  };
  if (map[key]) return map[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
