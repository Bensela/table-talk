import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Hash, Users, QrCode, Download, MoreHorizontal, Pencil, Trash2, Crown, Zap, Rocket, LayoutDashboard, Flag, FileText, Printer, AlertCircle, CheckCircle2, Clock, Sun, Moon, Monitor, Building2, Settings, Check, AlertTriangle, Search, RefreshCw, Plus, BarChart3, CreditCard, MapPin, Activity, Sparkles, LogOut, XCircle, Ban, BookOpenCheck } from 'lucide-react';
import { apiFetch } from '../api';
import { useAdminAuth, getAdminHeaders } from '../hooks/useAdminAuth';
import MapDisplay from '../components/MapDisplay';
import Modal from '../components/ui/Modal';
import ThemeToggle from '../components/ui/ThemeToggle';

export default function SuperAdminDashboard() {
  const { checking, logout } = useAdminAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const TAB_DASHBOARD = 'dashboard';
  const TAB_QUESTIONS = 'questions';
  const initialTab = searchParams.get('tab') === TAB_QUESTIONS ? TAB_QUESTIONS : TAB_DASHBOARD;
  const [activeTab, setActiveTab] = useState(initialTab);
  const setActiveTabSync = (next) => {
    setActiveTab(next);
    if (next === TAB_DASHBOARD) {
      searchParams.delete('tab');
      setSearchParams(searchParams, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };
  const [tenants, setTenants] = useState([]);
  const [globalQuestions, setGlobalQuestions] = useState([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsRange, setMetricsRange] = useState('24h');
  const [inviteForm, setInviteForm] = useState({ name: '', email: '' });
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [generatedInvite, setGeneratedInvite] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [replaceQuestions, setReplaceQuestions] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const [questionSuccess, setQuestionSuccess] = useState('');
  const [questionSearch, setQuestionSearch] = useState('');
  const [selectedContext, setSelectedContext] = useState('All');
  const [selectedQuestionType, setSelectedQuestionType] = useState('All');
  const [selectedDifficulty, setSelectedDifficulty] = useState('All');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState([]);
  const [expandedQuestions, setExpandedQuestions] = useState({});
  const [questionDisplayLimits, setQuestionDisplayLimits] = useState({});
  const [questionActionLoading, setQuestionActionLoading] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [questionForm, setQuestionForm] = useState({
    question_text: '',
    answer_text: '',
    question_type: 'open-ended',
    context: 'Exploring',
    difficulty: 'easy',
    options: ''
  });
  const [editingTenant, setEditingTenant] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [tenantAddressLookup, setTenantAddressLookup] = useState({ loading: false, error: '', resolvedAddress: '' });
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');
  const [tenantActionLoading, setTenantActionLoading] = useState(false);
  const [tenantActionError, setTenantActionError] = useState('');
  const [tenantActionSuccess, setTenantActionSuccess] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [metrics, setMetrics] = useState(createEmptyMetrics());
  const tenantAddressLookupRequestRef = useRef(0);
  const [billingOverview, setBillingOverview] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingDetail, setBillingDetail] = useState(null);
  const [billingActionLoading, setBillingActionLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [billingSuccess, setBillingSuccess] = useState('');
  const [billingPlanForm, setBillingPlanForm] = useState({ plan: 'trial', trialDays: 14, stripePriceId: '' });
  const [billingEntitlementsForm, setBillingEntitlementsForm] = useState({
    max_tables: '',
    max_monthly_sessions: '',
    can_generate_qr: '',
    can_export_analytics: '',
    can_use_custom_qr_branding: '',
    can_use_dual_phone_sessions: '',
    can_access_support: '',
    support_tier: '',
    billing_status: ''
  });
  const [billingProvisionForm, setBillingProvisionForm] = useState({ start: 1, end: 10, pattern: 'Table {n}', single: '' });
  const [saPrintPaperSize, setSaPrintPaperSize] = useState('letter');
  const [saPrintingTableId, setSaPrintingTableId] = useState(null);
  const [saBulkPrinting, setSaBulkPrinting] = useState(false);
  const [saDeletingTableId, setSaDeletingTableId] = useState(null);
  const [saDeleteConfirmTable, setSaDeleteConfirmTable] = useState(null);
  const [billingSearch, setBillingSearch] = useState('');
  const [paymentGateway, setPaymentGateway] = useState(null);
  const [paymentGatewayLoading, setPaymentGatewayLoading] = useState(false);
  const [paymentGatewaySaving, setPaymentGatewaySaving] = useState(false);
  const [paymentGatewayVerifying, setPaymentGatewayVerifying] = useState(false);
  const [pgForm, setPgForm] = useState({
    provider: 'stripe',
    mode: 'test',
    stripe_publishable_key: '',
    stripe_secret_key: '',
    stripe_webhook_secret: '',
    frontend_url: ''
  });
  const [pgBanner, setPgBanner] = useState(null);
  const [openPanel, setOpenPanel] = useState('plan');

  useEffect(() => {
    if (!checking) {
      fetchData();
    }
  }, [checking]);

  useEffect(() => {
    if (!checking) {
      fetchMetrics();
    }
  }, [checking, metricsRange]);

  useEffect(() => {
    if (checking) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      fetchMetrics({ silent: true });
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [checking, metricsRange]);

  useEffect(() => {
    if (!editingTenant) {
      return undefined;
    }

    const trimmedAddress = String(editForm.address || '').trim();

    if (!trimmedAddress) {
      setTenantAddressLookup({ loading: false, error: '', resolvedAddress: '' });
      setEditForm((current) => (
        current.latitude || current.longitude
          ? { ...current, latitude: '', longitude: '' }
          : current
      ));
      return undefined;
    }

    if (trimmedAddress.length < 10) {
      setTenantAddressLookup((current) => ({ ...current, loading: false, error: '', resolvedAddress: '' }));
      return undefined;
    }

    if (
      tenantAddressLookup.resolvedAddress === trimmedAddress &&
      String(editForm.latitude || '').trim() &&
      String(editForm.longitude || '').trim()
    ) {
      return undefined;
    }

    const requestId = tenantAddressLookupRequestRef.current + 1;
    tenantAddressLookupRequestRef.current = requestId;

    const timeoutId = window.setTimeout(async () => {
      try {
        setTenantAddressLookup({ loading: true, error: '', resolvedAddress: '' });

        const response = await apiFetch('/admin/geocode-address', {
          method: 'POST',
          headers: getAdminHeaders(),
          body: JSON.stringify({ address: trimmedAddress })
        });

        const data = await response.json();

        if (requestId !== tenantAddressLookupRequestRef.current) {
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

        setTenantAddressLookup({ loading: false, error: '', resolvedAddress: trimmedAddress });
      } catch (err) {
        if (requestId !== tenantAddressLookupRequestRef.current) {
          return;
        }

        setTenantAddressLookup({ loading: false, error: err.message, resolvedAddress: '' });
      }
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [editingTenant, editForm.address, editForm.latitude, editForm.longitude, tenantAddressLookup.resolvedAddress]);

  const fetchData = async () => {
    try {
      setPageLoading(true);
      const [tenantsRes, questionsRes, metricsRes, billingRes, pgRes] = await Promise.all([
        apiFetch('/admin/tenants', { headers: getAdminHeaders() }),
        apiFetch('/admin/questions', { headers: getAdminHeaders() }),
        apiFetch(`/admin/metrics/overview?range=${encodeURIComponent(metricsRange)}`, { headers: getAdminHeaders() }),
        apiFetch('/admin/billing/tenants', { headers: getAdminHeaders() }),
        (async () => {
          try { setPaymentGatewayLoading(true); return await apiFetch('/admin/platform/payment-gateway', { headers: getAdminHeaders() }); } finally { setPaymentGatewayLoading(false); }
        })()
      ]);

      const tenantsData = await tenantsRes.json();
      const questionsData = await questionsRes.json();
      const metricsData = await metricsRes.json();
      if (billingRes.ok) {
        const billingData = await billingRes.json();
        setBillingOverview(billingData);
      } else {
        const billingErr = await billingRes.json().catch(() => ({}));
        setBillingOverview({
          tenants: [],
          summary: {},
          plan_catalog: [],
          billing_provider: 'manual',
          _error: billingErr?.error || 'Billing overview unavailable'
        });
        setBillingError(billingErr?.error || 'Unable to load billing overview.');
      }

      if (pgRes.ok) {
        const pg = await pgRes.json();
        setPaymentGateway(pg);
        const s = pg?.settings || {};
        setPgForm({
          provider: s.provider || 'stripe',
          mode: s.mode || 'test',
          stripe_publishable_key: s.stripe_publishable_key_masked || '',
          stripe_secret_key: s.stripe_secret_key_masked || '',
          stripe_webhook_secret: s.stripe_webhook_secret_masked || '',
          frontend_url: s.frontend_url || ''
        });
      } else {
        const pgErr = await pgRes.json().catch(() => ({}));
        setPgBanner({ kind: 'error', message: pgErr?.error || 'Unable to load payment gateway settings.' });
      }

      setTenants(Array.isArray(tenantsData) ? tenantsData : []);
      setGlobalQuestions(Array.isArray(questionsData) ? questionsData : []);
      setMetrics(normalizeMetricsPayload(metricsData));
    } catch (err) {
      console.error(err);
      setBillingOverview({
        tenants: [],
        summary: {},
        plan_catalog: [],
        billing_provider: 'manual',
        _error: 'Billing overview unavailable'
      });
      setBillingError('Unable to load billing overview. Try refreshing.');
    } finally {
      setPageLoading(false);
    }
  };

  const savePaymentGateway = async () => {
    try {
      setPaymentGatewaySaving(true);
      setPgBanner(null);
      const response = await apiFetch('/admin/platform/payment-gateway', {
        method: 'PUT',
        headers: getAdminHeaders(),
        body: JSON.stringify(pgForm)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to save payment gateway settings');
      const s = data?.settings || {};
      setPaymentGateway((prev) => ({ ...(prev || {}), settings: s }));
      setPgForm({
        provider: s.provider || 'stripe',
        mode: s.mode || 'test',
        stripe_publishable_key: s.stripe_publishable_key_masked || '',
        stripe_secret_key: s.stripe_secret_key_masked || '',
        stripe_webhook_secret: s.stripe_webhook_secret_masked || '',
        frontend_url: s.frontend_url || ''
      });
      setPgBanner({ kind: 'success', message: 'Payment gateway settings saved successfully.' });
    } catch (err) {
      setPgBanner({ kind: 'error', message: err.message || 'Unable to save payment gateway settings' });
    } finally {
      setPaymentGatewaySaving(false);
    }
  };

  const verifyPaymentGateway = async () => {
    try {
      setPaymentGatewayVerifying(true);
      setPgBanner(null);
      const response = await apiFetch('/admin/platform/payment-gateway/verify', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (data?.ok) {
        setPgBanner({ kind: 'success', message: data.message + (data.livemode ? ' (Live mode)' : ' (Test mode)') });
      } else {
        setPgBanner({ kind: 'error', message: data?.message || 'Verification failed.' });
      }
    } catch (err) {
      setPgBanner({ kind: 'error', message: err.message || 'Verification failed' });
    } finally {
      setPaymentGatewayVerifying(false);
    }
  };

  const derivedWebhookEndpointUrl = (() => {
    const base = pgForm.frontend_url || paymentGateway?.settings?.frontend_url || '';
    if (!base) return '/billing/stripe/webhook';
    const clean = String(base).replace(/\/+$/, '');
    return `${clean}/billing/stripe/webhook`;
  })();

  const fetchMetrics = async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setMetricsLoading(true);
      }

      const response = await apiFetch(`/admin/metrics/overview?range=${encodeURIComponent(metricsRange)}`, {
        headers: getAdminHeaders()
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to load live metrics');
      }

      setMetrics(normalizeMetricsPayload(data));
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) {
        setMetricsLoading(false);
      }
    }
  };

  const exportMetrics = (format) => {
    const payload = {
      exported_at: new Date().toISOString(),
      range: metricsRange,
      ...metrics
    };

    let content = '';
    let mimeType = 'application/json';
    let extension = 'json';

    if (format === 'csv') {
      const lines = [
        ['section', 'label', 'value'],
        ['overview', 'live_sessions_now', metrics.overview.active_sessions_now],
        ['overview', 'live_restaurants_now', metrics.overview.live_restaurants_now],
        ['overview', 'active_tables_now', metrics.overview.active_tables_now],
        ['overview', 'dual_sessions_now', metrics.overview.dual_sessions_now],
        ['overview', `sessions_${metricsRange}`, metrics.overview.sessions_window],
        ['overview', `qr_scans_${metricsRange}`, metrics.overview.qr_scans_window],
        ['overview', `question_views_${metricsRange}`, metrics.overview.question_views_window],
        ...metrics.live_restaurants.map((restaurant) => ['live_restaurant', restaurant.name, `${restaurant.active_sessions} sessions / ${restaurant.active_tables} tables`]),
        ...metrics.context_mix.map((entry) => ['context_mix', entry.label, entry.count]),
        ...metrics.recent_activity.map((event) => ['recent_activity', formatMetricEventLabel(event.event_type), `${event.restaurant_name || ''} ${event.table_token || ''}`.trim()])
      ];

      content = lines
        .map((line) => line.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
      mimeType = 'text/csv;charset=utf-8;';
      extension = 'csv';
    } else {
      content = JSON.stringify(payload, null, 2);
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `table-talk-metrics-${metricsRange}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportQuestionsCsv = () => {
    const questionsToExport = groupedQuestionData.filteredQuestions;
    if (questionsToExport.length === 0) {
      setQuestionError('There are no questions to export for the current filters.');
      setQuestionSuccess('');
      return;
    }

    const lines = [
      ['Question Text', 'Follow-up / Tip', 'Question Type', 'Context', 'Difficulty', 'Options'],
      ...questionsToExport.map((question) => ([
        question.question_text || '',
        question.answer_text || '',
        question.question_type || 'open-ended',
        question.context || '',
        normalizeDifficulty(question.difficulty),
        formatOptionsForPrintableCsv(question.options)
      ]))
    ];

    const content = lines.map(toCsvLine).join('\n');
    downloadTextFile(
      content,
      `table-talk-questions-print-${questionsToExport.length}-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8;'
    );

    setQuestionError('');
    setQuestionSuccess(`Exported ${questionsToExport.length} question(s) to CSV.`);
  };

  const handleCreateInvite = async (event) => {
    event.preventDefault();
    setInviteError('');
    setInviteSuccess('');
    setGeneratedInvite(null);

    try {
      setInviteLoading(true);
      const response = await apiFetch('/admin/tenants/invites', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          name: inviteForm.name,
          email: inviteForm.email
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to generate subscription invite');
      }

      setGeneratedInvite(data);
      setInviteSuccess(`Invite generated for "${data.restaurant.name}".`);
      setInviteForm({ name: '', email: '' });
      fetchData();
    } catch (err) {
      setInviteError(err.message);
    } finally {
      setInviteLoading(false);
    }
  };

  const openEdit = (tenant) => {
    setEditingTenant(tenant);
    setEditForm({
      name: tenant.name || '',
      slug: tenant.slug || '',
      managerName: tenant.manager_name || '',
      contactEmail: tenant.contact_email || '',
      contactPhone: tenant.contact_phone || '',
      address: tenant.address || '',
      latitude: tenant.latitude != null ? String(tenant.latitude) : '',
      longitude: tenant.longitude != null ? String(tenant.longitude) : ''
    });
    setTenantAddressLookup({
      loading: false,
      error: '',
      resolvedAddress: tenant.address && tenant.latitude != null && tenant.longitude != null ? tenant.address : ''
    });
    setEditError('');
    setEditSuccess('');
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    setEditError('');
    setEditSuccess('');

    try {
      setPageLoading(true);
      const response = await apiFetch(`/admin/tenants/${editingTenant.id}`, {
        method: 'PATCH',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          name: editForm.name,
          slug: editForm.slug,
          managerName: editForm.managerName || null,
          contactEmail: editForm.contactEmail || null,
          contactPhone: editForm.contactPhone || null,
          address: editForm.address || null,
          latitude: editForm.latitude || null,
          longitude: editForm.longitude || null
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to save restaurant changes');
      }

      setEditSuccess(`"${data.name}" updated successfully.`);
      await fetchData();
      setTimeout(() => setEditingTenant(null), 1000);
    } catch (err) {
      setEditError(err.message);
    } finally {
      setPageLoading(false);
    }
  };

  const toggleBilling = async (tenant) => {
    const nextStatus = tenant.billing_status === 'active' ? 'suspended' : 'active';

    try {
      const response = await apiFetch(`/admin/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: getAdminHeaders(),
        body: JSON.stringify({ billing_status: nextStatus })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to update billing status');
      }

      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const openTenantBilling = async (tenant) => {
    if (!tenant?.id) return;
    setBillingError('');
    setBillingSuccess('');
    setBillingActionLoading(true);
    setBillingPlanForm((current) => ({ ...current, plan: tenant.plan || 'trial', trialDays: 14 }));
    setBillingEntitlementsForm({
      max_tables: '',
      max_monthly_sessions: '',
      can_generate_qr: '',
      can_export_analytics: '',
      can_use_custom_qr_branding: '',
      can_use_dual_phone_sessions: '',
      can_access_support: '',
      support_tier: '',
      billing_status: ''
    });
    setBillingProvisionForm({ start: 1, end: 10, pattern: 'Table {n}', single: '' });
    try {
      const response = await apiFetch(`/admin/billing/tenants/${tenant.id}`, { headers: getAdminHeaders() });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to load billing details');
      }
      const detail = await response.json();
      setBillingDetail({ tenant, ...detail });
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setBillingActionLoading(false);
    }
  };

  const handleSetPlan = async () => {
    if (!billingDetail?.tenant?.id) return;
    setBillingError('');
    setBillingSuccess('');
    setBillingActionLoading(true);
    try {
      const response = await apiFetch(`/admin/billing/tenants/${billingDetail.tenant.id}/plan`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          plan: billingPlanForm.plan,
          trialDays: Number.isFinite(Number(billingPlanForm.trialDays)) ? Number(billingPlanForm.trialDays) : undefined,
          stripePriceId: billingPlanForm.stripePriceId || undefined
        })
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to change plan');
      }
      await openTenantBilling(billingDetail.tenant);
      setBillingSuccess(`Plan updated to ${billingPlanForm.plan}.`);
      fetchData();
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setBillingActionLoading(false);
    }
  };

  const handleOverrideEntitlements = async () => {
    if (!billingDetail?.tenant?.id) return;
    const payload = Object.entries(billingEntitlementsForm).reduce((acc, [key, value]) => {
      if (value === '' || value == null) return acc;
      if (['can_generate_qr', 'can_export_analytics', 'can_use_custom_qr_branding', 'can_use_dual_phone_sessions', 'can_access_support'].includes(key)) {
        acc[key] = value === 'true';
        return acc;
      }
      if (['max_tables', 'max_monthly_sessions'].includes(key)) {
        const n = Number(value);
        acc[key] = Number.isFinite(n) ? n : null;
        return acc;
      }
      acc[key] = value;
      return acc;
    }, {});
    if (Object.keys(payload).length === 0) {
      setBillingError('Provide at least one entitlement field to override.');
      return;
    }
    setBillingError('');
    setBillingSuccess('');
    setBillingActionLoading(true);
    try {
      const response = await apiFetch(`/admin/billing/tenants/${billingDetail.tenant.id}/entitlements`, {
        method: 'PATCH',
        headers: getAdminHeaders(),
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to update entitlements');
      }
      await openTenantBilling(billingDetail.tenant);
      setBillingSuccess('Entitlements updated.');
      fetchData();
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setBillingActionLoading(false);
    }
  };

  const handleProvisionSingleTrialQr = async () => {
    if (!billingDetail?.tenant?.id) return;
    if (!String(billingProvisionForm.single || '').trim()) {
      setBillingError('Provide a table number/label to provision.');
      return;
    }
    setBillingError('');
    setBillingSuccess('');
    setBillingActionLoading(true);
    try {
      const response = await apiFetch(`/admin/billing/tenants/${billingDetail.tenant.id}/trial/table`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ table_number: String(billingProvisionForm.single).trim() })
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to provision QR');
      }
      await openTenantBilling(billingDetail.tenant);
      setBillingSuccess(`Trial QR provisioned for table ${billingProvisionForm.single}.`);
      setBillingProvisionForm((f) => ({ ...f, single: '' }));
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setBillingActionLoading(false);
    }
  };

  const handleProvisionBatchTrialQrs = async () => {
    if (!billingDetail?.tenant?.id) return;
    setBillingError('');
    setBillingSuccess('');
    setBillingActionLoading(true);
    try {
      const response = await apiFetch(`/admin/billing/tenants/${billingDetail.tenant.id}/trial/tables`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          start: Number(billingProvisionForm.start) || 1,
          end: Number(billingProvisionForm.end) || 10,
          pattern: billingProvisionForm.pattern || 'Table {n}'
        })
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to provision QR batch');
      }
      const body = await response.json();
      const count = Array.isArray(body?.tables) ? body.tables.length : 0;
      await openTenantBilling(billingDetail.tenant);
      setBillingSuccess(`Provisioned ${count} trial QR tables.`);
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setBillingActionLoading(false);
    }
  };

  const buildSaPrintQrCardHtml = (restaurantName, entries, { paperSize }) => {
    const safeName = String(restaurantName || 'Table Talk').replace(/[<>&"']/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
    const paperSizeCss = paperSize === 'a4' ? 'A4' : paperSize === 'a5' ? 'A5' : 'Letter';
    const cols = paperSize === 'a5' ? 1 : 2;
    const gapMm = 8;
    const pageMarginMm = 12;
    const cards = entries.map((entry) => {
      const tbl = String(entry.table_number).replace(/[<>&"']/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
      return `<div class="card">
        <div class="restaurant">${safeName}</div>
        <div class="logo">Table<span>-Talk</span></div>
        <div class="qr-frame">
          <img src="${entry.qr}" alt="QR code for table ${tbl}" />
        </div>
        <div class="table-label">Table</div>
        <div class="table-number">${tbl}</div>
        <div class="instruction">
          Scan with your phone camera to join<br/>
          the conversational game at this table.
        </div>
      </div>`;
    }).join('\n');

    return `<!doctype html>
<html>
  <head>
    <title>Print QR Codes${entries.length === 1 ? ` - ${entries[0].table_number}` : ` (${entries.length})`}</title>
    <style>
      @page { size: ${paperSizeCss}; margin: ${pageMarginMm}mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #ffffff; color: #1e293b; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      body { min-height: 100vh; }
      .grid {
        display: grid;
        grid-template-columns: repeat(${cols}, minmax(0, 1fr));
        gap: ${gapMm}mm;
      }
      .card {
        border: 2px dashed rgba(148, 163, 184, 0.8);
        border-radius: 24px;
        padding: 28px 24px;
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.08);
        page-break-inside: avoid;
        break-inside: avoid;
        text-align: center;
      }
      .restaurant {
        font-size: 13px; font-weight: 800; color: #0f172a;
        text-transform: uppercase; letter-spacing: 0.14em; margin-bottom: 12px;
      }
      .logo { font-size: 22px; font-weight: 800; margin-bottom: 20px; letter-spacing: -0.025em; }
      .logo span { color: #6366f1; }
      .qr-frame {
        width: 180px; height: 180px; background: #f8fafc; border: 1px solid #e2e8f0;
        margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;
        border-radius: 16px; overflow: hidden;
      }
      .qr-frame img { width: 100%; height: 100%; object-fit: cover; }
      .table-label { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-bottom: 4px; }
      .table-number { font-size: 28px; font-weight: 900; margin-bottom: 12px; }
      .instruction { font-size: 11px; color: #94a3b8; line-height: 1.5; }
      @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="grid">
      ${cards}
    </div>
    <script> window.onload = function() { window.print(); window.close(); } </script>
  </body>
</html>`;
  };

  const downloadSaQrPng = (entry) => {
    if (!entry?.qr) return;
    try {
      const a = document.createElement('a');
      const safe = String(entry.table_number || 'qr').replace(/[^A-Za-z0-9_-]+/g, '_');
      a.href = entry.qr;
      a.download = `qr_table_${safe}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 50);
    } catch (err) {
      console.error(err);
      setBillingError('Unable to download PNG.');
    }
  };

  const handleSaPrintSingleQr = async (table) => {
    if (!billingDetail?.tenant?.id || !table?.id) return;
    setSaPrintingTableId(table.id);
    setBillingError('');
    try {
      const res = await apiFetch(`/admin/billing/tenants/${billingDetail.tenant.id}/qr`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ table_ids: [table.id] })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate QR code');
      }
      const data = await res.json();
      if (!Array.isArray(data) || !data[0]?.qr) {
        throw new Error('QR code data is missing');
      }
      const html = buildSaPrintQrCardHtml(
        billingDetail.billing?.name || billingDetail.tenant?.name || 'Table Talk',
        [data[0]],
        { paperSize: saPrintPaperSize }
      );
      const w = window.open('', '_blank');
      w.document.write(html);
      w.document.close();
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setSaPrintingTableId(null);
    }
  };

  const handleSaPrintAllQr = async () => {
    const tables = Array.isArray(billingDetail?.tables) ? billingDetail.tables : [];
    if (!tables.length || !billingDetail?.tenant?.id) return;
    setSaBulkPrinting(true);
    setBillingError('');
    try {
      const res = await apiFetch(`/admin/billing/tenants/${billingDetail.tenant.id}/qr`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ table_ids: tables.map((t) => t.id) })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate QR codes');
      }
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error('No QR codes returned');
      const html = buildSaPrintQrCardHtml(
        billingDetail.billing?.name || billingDetail.tenant?.name || 'Table Talk',
        data,
        { paperSize: saPrintPaperSize }
      );
      const w = window.open('', '_blank');
      w.document.write(html);
      w.document.close();
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setSaBulkPrinting(false);
    }
  };

  const handleSaDownloadSingleQr = async (table) => {
    if (!billingDetail?.tenant?.id || !table?.id) return;
    setSaPrintingTableId(table.id);
    setBillingError('');
    try {
      const res = await apiFetch(`/admin/billing/tenants/${billingDetail.tenant.id}/qr`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ table_ids: [table.id] })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate QR code');
      }
      const data = await res.json();
      if (!Array.isArray(data) || !data[0]?.qr) throw new Error('QR code data is missing');
      downloadSaQrPng(data[0]);
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setSaPrintingTableId(null);
    }
  };

  const handleSaDownloadAllPng = async () => {
    const tables = Array.isArray(billingDetail?.tables) ? billingDetail.tables : [];
    if (!tables.length || !billingDetail?.tenant?.id) return;
    setSaBulkPrinting(true);
    setBillingError('');
    try {
      const res = await apiFetch(`/admin/billing/tenants/${billingDetail.tenant.id}/qr`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ table_ids: tables.map((t) => t.id) })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate QR codes');
      }
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error('No QR codes returned');
      data.forEach((entry, idx) => {
        setTimeout(() => downloadSaQrPng(entry), idx * 220);
      });
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setSaBulkPrinting(false);
    }
  };

  const handleSaDeleteTable = async () => {
    const table = saDeleteConfirmTable;
    if (!table?.id || !billingDetail?.tenant?.id) return;
    setSaDeletingTableId(table.id);
    setBillingError('');
    try {
      const res = await apiFetch(`/admin/billing/tenants/${billingDetail.tenant.id}/tables/${encodeURIComponent(table.id)}`, {
        method: 'DELETE',
        headers: getAdminHeaders()
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete table');
      }
      // Refresh the full tenant detail so tables list + billing stay in sync
      const tenant = billingDetail.tenant;
      const detailRes = await apiFetch(`/admin/billing/tenants/${tenant.id}`, { headers: getAdminHeaders() });
      if (detailRes.ok) {
        const detail = await detailRes.json();
        setBillingDetail({ tenant, ...detail });
      } else {
        // Optimistic fallback: filter out the deleted row locally
        setBillingDetail((cur) => {
          if (!cur) return cur;
          return { ...cur, tables: (Array.isArray(cur.tables) ? cur.tables : []).filter((t) => t.id !== table.id) };
        });
      }
      setBillingSuccess(`Deleted table ${String(table.table_number || table.id)}`);
    } catch (err) {
      setBillingError(err.message);
    } finally {
      setSaDeletingTableId(null);
      setSaDeleteConfirmTable(null);
    }
  };

  const handleRefreshBillingOverview = async () => {
    try {
      setBillingLoading(true);
      const response = await apiFetch('/admin/billing/tenants', { headers: getAdminHeaders() });
      if (!response.ok) throw new Error('Unable to refresh billing overview');
      const data = await response.json();
      setBillingOverview(data);
    } catch (err) {
      console.error(err);
    } finally {
      setBillingLoading(false);
    }
  };

  const handlePermanentDeleteTenant = async (tenant) => {
    if (!tenant || tenant.slug === 'default') {
      return;
    }

    setTenantActionError('');
    setTenantActionSuccess('');

    const confirmation = window.prompt(
      `Permanent delete will remove "${tenant.name}" and all its admin accounts.\n\nType the restaurant slug (${tenant.slug}) to confirm:`
    );

    if (confirmation !== tenant.slug) {
      return;
    }

    try {
      setTenantActionLoading(true);
      const response = await apiFetch(`/admin/tenants/${tenant.id}`, {
        method: 'DELETE',
        headers: getAdminHeaders()
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to delete restaurant');
      }

      setTenantActionSuccess(`"${tenant.name}" was permanently deleted.`);
      if (expandedId === tenant.id) {
        setExpandedId(null);
      }
      if (editingTenant?.id === tenant.id) {
        setEditingTenant(null);
      }
      await fetchData();
    } catch (err) {
      setTenantActionError(err.message);
    } finally {
      setTenantActionLoading(false);
    }
  };

  const moveQuestion = async (questionId, direction) => {
    const updatedQuestions = [...globalQuestions];
    const index = updatedQuestions.findIndex((question) => question.question_id === questionId);
    if (index === -1) {
      return;
    }

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= updatedQuestions.length) {
      return;
    }

    [updatedQuestions[index], updatedQuestions[targetIndex]] = [updatedQuestions[targetIndex], updatedQuestions[index]];
    setGlobalQuestions(updatedQuestions);

    try {
      await apiFetch('/admin/questions/reshuffle', {
        method: 'PATCH',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          question_ids: updatedQuestions.map((question) => question.question_id)
        })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCsvImport = async () => {
    if (!csvFile) {
      setQuestionError('Choose a CSV file first');
      return;
    }

    setQuestionError('');
    setQuestionSuccess('');

    try {
      setQuestionLoading(true);
      const csvText = await csvFile.text();

      const response = await apiFetch('/admin/questions/import', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          csvText,
          replaceExisting: replaceQuestions
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'CSV upload failed');
      }

      setQuestionSuccess(`Imported ${data.imported} question${data.imported === 1 ? '' : 's'}.`);
      setCsvFile(null);
      await fetchData();
    } catch (err) {
      setQuestionError(err.message);
    } finally {
      setQuestionLoading(false);
    }
  };

  const toggleQuestionSelection = (questionId) => {
    setSelectedQuestionIds((current) =>
      current.includes(questionId)
        ? current.filter((id) => id !== questionId)
        : [...current, questionId]
    );
  };

  const selectQuestionIds = (ids, mode = 'add') => {
    const safeIds = Array.from(new Set((ids || []).filter(Boolean)));
    setSelectedQuestionIds((current) => {
      if (mode === 'replace') return safeIds;
      if (mode === 'remove') return current.filter((id) => !safeIds.includes(id));
      // add mode (default): union
      return Array.from(new Set([...current, ...safeIds]));
    });
  };

  const selectAllMatchingFilters = () => {
    const ids = (groupedQuestionData?.filteredQuestions || []).map((q) => q.question_id);
    selectQuestionIds(ids, 'replace');
  };

  const collectGroupIds = (group) => {
    if (!group) return [];
    const ids = [];
    const walkDifficulty = (diffGroup) => {
      if (diffGroup?.questions?.length) {
        for (const q of diffGroup.questions) if (q?.question_id) ids.push(q.question_id);
      }
    };
    const walkType = (typeGrp) => {
      if (typeGrp?.difficulties?.length) {
        for (const d of typeGrp.difficulties) walkDifficulty(d);
      }
    };
    // Context group shape: { types: [...] }
    if (group.types?.length) {
      for (const t of group.types) walkType(t);
    } else if (group.difficulties?.length) {
      for (const d of group.difficulties) walkDifficulty(d);
    } else if (group.questions?.length) {
      for (const q of group.questions) if (q?.question_id) ids.push(q.question_id);
    }
    return Array.from(new Set(ids));
  };

  const countSelectedInGroup = (ids) => {
    const idSet = new Set((ids || []).filter(Boolean));
    return selectedQuestionIds.filter((s) => idSet.has(s)).length;
  };

  const toggleQuestionExpanded = (questionId) => {
    setExpandedQuestions((current) => ({
      ...current,
      [questionId]: !current[questionId]
    }));
  };

  const handleShowMoreQuestions = (sectionKey) => {
    setQuestionDisplayLimits((current) => ({
      ...current,
      [sectionKey]: (current[sectionKey] || DEFAULT_SECTION_VISIBLE_COUNT) + DEFAULT_SECTION_VISIBLE_COUNT
    }));
  };

  const openQuestionEditor = (question) => {
    setEditingQuestion(question);
    setQuestionForm({
      question_text: question.question_text || '',
      answer_text: question.answer_text || '',
      question_type: question.question_type || 'open-ended',
      context: question.context || 'Exploring',
      difficulty: normalizeDifficulty(question.difficulty),
      options: getOptionsPreview(question.options)
    });
    setQuestionError('');
    setQuestionSuccess('');
  };

  const handleSaveQuestion = async (event) => {
    event.preventDefault();
    if (!editingQuestion) {
      return;
    }

    setQuestionError('');
    setQuestionSuccess('');

    try {
      setQuestionActionLoading(true);
      const response = await apiFetch(`/admin/questions/${editingQuestion.question_id}`, {
        method: 'PATCH',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          question_text: questionForm.question_text,
          answer_text: questionForm.answer_text || null,
          question_type: questionForm.question_type,
          context: questionForm.context,
          difficulty: questionForm.difficulty,
          options: questionForm.question_type === 'multiple-choice' ? questionForm.options : null
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to update question');
      }

      setQuestionSuccess('Question updated successfully.');
      setEditingQuestion(null);
      await fetchData();
    } catch (err) {
      setQuestionError(err.message);
    } finally {
      setQuestionActionLoading(false);
    }
  };

  const handleDeleteQuestion = async (questionId) => {
    const confirmed = window.confirm('Delete this question? This action cannot be undone.');
    if (!confirmed) {
      return;
    }

    setQuestionError('');
    setQuestionSuccess('');

    try {
      setQuestionActionLoading(true);
      const response = await apiFetch(`/admin/questions/${questionId}`, {
        method: 'DELETE',
        headers: getAdminHeaders()
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to delete question');
      }

      setSelectedQuestionIds((current) => current.filter((id) => id !== questionId));
      setQuestionSuccess('Question deleted successfully.');
      await fetchData();
    } catch (err) {
      setQuestionError(err.message);
    } finally {
      setQuestionActionLoading(false);
    }
  };

  const handleBulkDeleteQuestions = async () => {
    if (selectedQuestionIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(`Delete ${selectedQuestionIds.length} selected question(s)? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setQuestionError('');
    setQuestionSuccess('');

    try {
      setQuestionActionLoading(true);
      const response = await apiFetch('/admin/questions/bulk-delete', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ question_ids: selectedQuestionIds })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to bulk delete questions');
      }

      setSelectedQuestionIds([]);
      setQuestionSuccess(`Deleted ${data.deleted} question${data.deleted === 1 ? '' : 's'}.`);
      await fetchData();
    } catch (err) {
      setQuestionError(err.message);
    } finally {
      setQuestionActionLoading(false);
    }
  };

  const copyText = async (value, successMessage) => {
    try {
      await navigator.clipboard.writeText(value);
      setInviteSuccess(successMessage);
    } catch (err) {
      setInviteError('Clipboard copy is not available in this browser.');
    }
  };

  const groupedQuestionData = useMemo(() => {
    const searchTerm = questionSearch.trim().toLowerCase();
    const searchableQuestions = globalQuestions.filter((question) => {
      const haystack = [
        question.question_text,
        question.answer_text,
        question.context,
        question.question_type,
        question.difficulty,
        question.category,
        question.sub_category,
        getOptionsPreview(question.options)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !searchTerm || haystack.includes(searchTerm);
      const matchesContext = selectedContext === 'All' || (question.context || 'Unassigned') === selectedContext;
      const matchesType = selectedQuestionType === 'All' || (question.question_type || 'open-ended') === selectedQuestionType;
      const matchesDifficulty = selectedDifficulty === 'All' || normalizeDifficulty(question.difficulty) === selectedDifficulty;

      return matchesSearch && matchesContext && matchesType && matchesDifficulty;
    });

    const contextMap = new Map();

    searchableQuestions.forEach((question) => {
      const contextLabel = question.context || 'Unassigned';
      const typeLabel = question.question_type || 'open-ended';
      const difficultyLabel = normalizeDifficulty(question.difficulty);

      if (!contextMap.has(contextLabel)) {
        contextMap.set(contextLabel, {
          label: contextLabel,
          questionCount: 0,
          types: new Map()
        });
      }

      const contextGroup = contextMap.get(contextLabel);
      contextGroup.questionCount += 1;

      if (!contextGroup.types.has(typeLabel)) {
        contextGroup.types.set(typeLabel, {
          label: typeLabel,
          questionCount: 0,
          difficulties: new Map()
        });
      }

      const typeGroup = contextGroup.types.get(typeLabel);
      typeGroup.questionCount += 1;

      if (!typeGroup.difficulties.has(difficultyLabel)) {
        typeGroup.difficulties.set(difficultyLabel, {
          label: difficultyLabel,
          questions: []
        });
      }

      typeGroup.difficulties.get(difficultyLabel).questions.push(question);
    });

    const contexts = Array.from(contextMap.values())
      .sort((a, b) => getContextRank(a.label) - getContextRank(b.label))
      .map((contextGroup) => ({
        ...contextGroup,
        types: Array.from(contextGroup.types.values())
          .sort((a, b) => getQuestionTypeRank(a.label) - getQuestionTypeRank(b.label))
          .map((typeGroup) => ({
            ...typeGroup,
            difficulties: DIFFICULTY_ORDER
              .filter((difficulty) => typeGroup.difficulties.has(difficulty))
              .map((difficulty) => typeGroup.difficulties.get(difficulty))
          }))
      }));

    const typeGroupCount = contexts.reduce((total, contextGroup) => total + contextGroup.types.length, 0);

    const difficultyBreakdown = DIFFICULTY_ORDER.reduce((accumulator, difficulty) => {
      accumulator[difficulty] = searchableQuestions.filter(
        (question) => normalizeDifficulty(question.difficulty) === difficulty
      ).length;
      return accumulator;
    }, {});

    return {
      contexts,
      filteredQuestions: searchableQuestions,
      stats: {
        contexts: contexts.length,
        typeGroups: typeGroupCount,
        questions: searchableQuestions.length,
        difficultyBreakdown
      }
    };
  }, [globalQuestions, questionSearch, selectedContext, selectedQuestionType, selectedDifficulty]);

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6 font-sans">
      <header className="flex justify-between items-center mb-6 pb-6 border-b border-border">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-violet-500/30">
            <LayoutDashboard className="w-7 h-7 text-violet-400" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Super Admin Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage restaurant onboarding, subscriptions, billing, and global questions</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            onClick={() => logout()}
            className="inline-flex items-center gap-2 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground font-semibold px-4 py-2 rounded-xl transition-colors duration-200"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </header>

      <nav className="mb-8 rounded-2xl border border-border bg-card p-2 shadow-[0_4px_20px_rgba(15,23,42,0.03)] dark:shadow-none transition-colors duration-300">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTabSync(TAB_DASHBOARD)}
            aria-pressed={activeTab === TAB_DASHBOARD}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold tracking-wide transition-all duration-200 ${
              activeTab === TAB_DASHBOARD
                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-[0_4px_18px_rgba(79,70,229,0.22)] dark:from-violet-500 dark:to-indigo-500 dark:shadow-[0_4px_20px_rgba(139,92,246,0.25)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTabSync(TAB_QUESTIONS)}
            aria-pressed={activeTab === TAB_QUESTIONS}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold tracking-wide transition-all duration-200 ${
              activeTab === TAB_QUESTIONS
                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-[0_4px_18px_rgba(79,70,229,0.22)] dark:from-violet-500 dark:to-indigo-500 dark:shadow-[0_4px_20px_rgba(139,92,246,0.25)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <BookOpenCheck className="w-4 h-4" />
            Question Library
          </button>
        </div>
      </nav>

      {activeTab === TAB_DASHBOARD && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
          <div className="xl:col-span-3 space-y-8">
          <section className="relative overflow-hidden rounded-[32px] border border-border/80 bg-card shadow-[0_4px_28px_rgba(15,23,42,0.04)] dark:border-cyan-500/20 dark:bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(168,85,247,0.18),_transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] dark:shadow-2xl p-6 transition-colors duration-300">
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:28px_28px] opacity-30 dark:opacity-30" />
            <div className="absolute inset-0 pointer-events-none opacity-60 dark:hidden">
              <div className="absolute -top-10 -left-10 w-60 h-60 rounded-full bg-cyan-300/20 blur-3xl" />
              <div className="absolute -top-16 right-0 w-64 h-64 rounded-full bg-violet-300/15 blur-3xl" />
            </div>
            <div className="relative z-10">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-200 mb-3">
                    <Activity className="w-3 h-3 text-emerald-500 dark:text-emerald-400 animate-pulse" />
                    Live Platform Metrics
                  </div>
                  <div className="flex items-center gap-3">
                    <BarChart3 className="w-7 h-7 text-cyan-600 dark:text-cyan-300" />
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Real-Time Usage Command Center</h2>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-2xl">
                    Monitor live sessions, QR scans, restaurant activity, and where Table-Talk is being used across active tenant locations.
                  </p>
                </div>
                <div className="flex flex-col items-start lg:items-end gap-3">
                  <div className="flex flex-wrap gap-2">
                    {['24h', '7d', '30d'].map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setMetricsRange(option)}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] transition-colors duration-200 ${
                          metricsRange === option
                            ? 'bg-indigo-600 text-white shadow-[0_4px_14px_rgba(79,70,229,0.25)] dark:bg-cyan-500 dark:text-slate-950 dark:shadow-lg dark:shadow-cyan-500/20'
                            : 'border border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:border-slate-500'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => exportMetrics('csv')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700 hover:bg-emerald-100 transition-colors duration-200 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => exportMetrics('json')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-violet-700 hover:bg-violet-100 transition-colors duration-200 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Export JSON
                    </button>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {metricsLoading ? 'Refreshing live data…' : `Updated ${formatMetricsTimestamp(metrics.generated_at)}`}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                <MetricCard label="Live Sessions" value={metrics.overview.active_sessions_now} accent="cyan" helper={`${metrics.overview.dual_sessions_now} dual live`} />
                <MetricCard label="Live Restaurants" value={metrics.overview.live_restaurants_now} accent="violet" helper={`${metrics.overview.active_tables_now} active tables`} />
                <MetricCard label={`QR Scans · ${metricsRange}`} value={metrics.overview.qr_scans_window} accent="emerald" helper={`${metrics.overview.sessions_window} sessions started`} />
                <MetricCard label={`Question Views · ${metricsRange}`} value={metrics.overview.question_views_window} accent="amber" helper={`${metrics.overview.total_questions} questions in bank`} />
              </div>

              <div className="grid grid-cols-1 2xl:grid-cols-[1.5fr_1fr] gap-6">
                <div className="rounded-3xl border border-border/80 bg-card/70 p-5">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">{metricsRange} Activity Pulse</h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">QR validations, session starts, and question views across the selected reporting window.</p>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <LegendDot color="bg-cyan-400" label="Scans" />
                      <LegendDot color="bg-violet-400" label="Sessions" />
                      <LegendDot color="bg-amber-400" label="Views" />
                    </div>
                  </div>
                  <MetricsTimeline timeline={metrics.activity_timeline} />
                </div>

                <div className="rounded-3xl border border-border/80 bg-card/70 p-5">
                  <div className="mb-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-400" />
                      <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">Context Mix · {metricsRange}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Relationship contexts currently driving usage in the selected range.</p>
                  </div>
                  <div className="space-y-3">
                    {metrics.context_mix.length > 0 ? (
                      metrics.context_mix.map((entry) => (
                        <ContextMixRow
                          key={entry.label}
                          label={entry.label}
                          count={entry.count}
                          total={metrics.context_mix.reduce((sum, item) => sum + item.count, 0)}
                          rangeLabel={metricsRange}
                        />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-sm text-slate-500">
                        No activity recorded yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 2xl:grid-cols-[1.2fr_0.8fr] gap-6 mt-6">
                <div className="rounded-3xl border border-border/80 bg-card/70 p-5">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-emerald-400" />
                        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">Live Venue Feed</h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Where the app is active right now based on recent tenant session activity.</p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {metrics.overview.active_restaurants} active subscriptions
                    </div>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
                    <LiveVenueMap restaurants={metrics.live_restaurants} />
                    {metrics.live_restaurants.length > 0 ? (
                      metrics.live_restaurants.map((restaurant) => (
                        <LiveVenueCard key={restaurant.id} restaurant={restaurant} />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border bg-muted/60 px-4 py-10 text-center text-sm text-muted-foreground">
                        No restaurants are live at this moment.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-border/80 bg-card/70 p-5">
                  <div className="mb-4">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">Recent Platform Events</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Latest validated scans, session events, and engagement signals.</p>
                  </div>
                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {metrics.recent_activity.length > 0 ? (
                      metrics.recent_activity.map((event, index) => (
                        <RecentActivityRow key={`${event.event_type}-${event.timestamp}-${index}`} event={event} />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border bg-muted/60 px-4 py-8 text-center text-sm text-muted-foreground">
                        No recent activity available.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-card/60 border border-border rounded-3xl p-6 shadow-xl backdrop-blur-md">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-violet-200 mb-3">
                  <CreditCard className="w-3 h-3" />
                  Monetization
                </div>
                <div className="flex items-center gap-3">
                  <CreditCard className="w-7 h-7 text-violet-400" />
                  <h2 className="text-2xl font-extrabold tracking-tight text-foreground">Billing &amp; Subscriptions</h2>
                </div>
                <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
                  Assign plans, override entitlements, and provision trial-period QR codes from here. Trial tenants cannot self-serve QRs — they are issued exclusively by Super Admin.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full lg:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={billingSearch}
                    onChange={(e) => setBillingSearch(e.target.value)}
                    placeholder="Search restaurant, slug, or email"
                    className="w-full pl-10 bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500 transition-colors duration-200"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleRefreshBillingOverview}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200 hover:bg-emerald-500/20 transition-colors duration-200"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${billingLoading ? 'animate-spin' : ''}`} />
                  {billingLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>

            {billingOverview ? (
              <>
                {billingOverview._error && (
                  <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
                    {billingOverview._error}
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
                  <BillingStat label="Total Restaurants" value={billingOverview?.summary?.total ?? 0} accent="slate" />
                  <BillingStat label="Trial" value={billingOverview?.summary?.trial_count ?? 0} accent="amber" />
                  <BillingStat label="Starter" value={billingOverview?.summary?.starter_count ?? 0} accent="cyan" />
                  <BillingStat label="Premium" value={billingOverview?.summary?.premium_count ?? 0} accent="violet" />
                  <BillingStat label="Enterprise" value={billingOverview?.summary?.enterprise_count ?? 0} accent="emerald" />
                  <BillingStat label="Active Paid" value={billingOverview?.summary?.active_paid ?? 0} accent="emerald" />
                  <BillingStat label="Suspended / Past Due" value={Number(billingOverview?.summary?.suspended ?? 0) + Number(billingOverview?.summary?.past_due ?? 0)} accent="rose" />
                </div>

                <div className="space-y-3">
                  <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground rounded-xl border border-border bg-muted/40">
                    <div className="col-span-3 flex items-center gap-1.5"><Building2 className="w-3 h-3" /> Restaurant</div>
                    <div className="col-span-2 flex items-center gap-1.5"><Crown className="w-3 h-3" /> Plan</div>
                    <div className="col-span-2 flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> Status</div>
                    <div className="col-span-2 flex items-center gap-1.5"><Settings className="w-3 h-3" /> Entitlements</div>
                    <div className="col-span-3 text-right flex items-center justify-end gap-1.5"><Zap className="w-3 h-3" /> Actions</div>
                  </div>

                  <div className="space-y-2.5">
                    {(billingOverview?.tenants || []).filter((row) => {
                      const q = String(billingSearch || '').toLowerCase();
                      if (!q) return true;
                      return (
                        String(row.name || '').toLowerCase().includes(q) ||
                        String(row.slug || '').toLowerCase().includes(q) ||
                        String(row.contact_email || '').toLowerCase().includes(q)
                      );
                    }).map((row) => (
                      <div key={row.id} className="group grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-2 items-center px-4 md:px-5 py-4 md:py-4 rounded-2xl border border-border bg-card/80 hover:border-violet-500/30 hover:bg-muted/50 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-200">
                        <div className="col-span-1 md:col-span-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-violet-500/20 flex items-center justify-center shrink-0">
                              <Building2 className="w-5 h-5 text-violet-400" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-foreground truncate">{row.name || row.slug}</div>
                              <div className="text-xs text-muted-foreground truncate">/{row.slug}</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-span-1 md:col-span-2">
                          <div className="md:hidden text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Plan</div>
                          <PlanBadge plan={row.plan || 'trial'} />
                        </div>
                        <div className="col-span-1 md:col-span-2">
                          <div className="md:hidden text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Status</div>
                          <StatusBadge status={row.computed_status || row.billing_status || 'pending'} plan={row.plan} />
                          <div className="text-[11px] text-muted-foreground mt-1.5">
                            {row.trial_ends_at ? `Trial ends ${new Date(row.trial_ends_at).toLocaleDateString()}` : row.subscription_current_period_end ? `Renews ${new Date(row.subscription_current_period_end).toLocaleDateString()}` : '—'}
                          </div>
                        </div>
                        <div className="col-span-1 md:col-span-2">
                          <div className="md:hidden text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Entitlements</div>
                          <div className="flex flex-wrap gap-1.5">
                            <EntitlementChip label="QR" enabled={Boolean(row.can_generate_qr)} />
                            <EntitlementChip label="Dual" enabled={Boolean(row.can_use_dual_phone_sessions)} />
                            <EntitlementChip label="Export" enabled={Boolean(row.can_export_analytics)} />
                            <EntitlementChip label="Tables" enabled={Boolean(row.max_tables)} value={row.max_tables} />
                          </div>
                        </div>
                        <div className="col-span-1 md:col-span-3 flex items-center md:justify-end gap-2 pt-1 md:pt-0">
                          <button
                            onClick={() => openTenantBilling(row)}
                            className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl border border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20 hover:border-violet-500/60 text-violet-200 transition-colors duration-200"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            Manage Billing
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-muted/60 px-4 py-10 text-center text-sm text-muted-foreground">
                {billingLoading ? 'Loading billing overview…' : pageLoading ? 'Loading billing overview…' : 'Billing overview will appear here.'}
              </div>
            )}
          </section>

          <section className="bg-card/60 border border-border rounded-3xl p-6 shadow-xl backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30">
                    <Settings className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">Payment Gateway Setup</h2>
                    <p className="text-xs text-muted-foreground mt-1">Configure Stripe keys, mode, and the frontend base URL used for Checkout redirects and QR links.</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchData()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-muted px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors duration-200"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${paymentGatewayLoading ? 'animate-spin' : ''}`} />
                  {paymentGatewayLoading ? 'Refreshing…' : 'Refresh'}
                </button>
                <button
                  onClick={verifyPaymentGateway}
                  disabled={paymentGatewayVerifying}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-60 transition-colors duration-200"
                >
                  {paymentGatewayVerifying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {paymentGatewayVerifying ? 'Verifying…' : 'Verify Connection'}
                </button>
                <button
                  onClick={savePaymentGateway}
                  disabled={paymentGatewaySaving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-violet-500/20 hover:brightness-110 disabled:opacity-60 transition-all duration-200"
                >
                  {paymentGatewaySaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {paymentGatewaySaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {pgBanner && (
              <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
                pgBanner.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                  : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
              }`}>
                {pgBanner.message}
              </div>
            )}

            {(paymentGateway?.connectivity || pgBanner) && (
              <div className={`mb-5 rounded-2xl border p-4 ${
                paymentGateway?.connectivity?.ok
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                  : 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
              } transition-colors duration-300`}>
                <div className="flex flex-wrap items-start gap-3 justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Stripe connectivity</div>
                    <div className={`text-xs mt-1 ${paymentGateway?.connectivity?.ok ? 'text-emerald-700 dark:text-emerald-200' : 'text-amber-700 dark:text-amber-200'}`}>
                      {paymentGateway?.connectivity?.message || (
                        paymentGatewayLoading ? 'Checking connectivity…' : 'Save credentials and click Verify Connection.'
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                      pgForm.provider === 'stripe'
                        ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200'
                        : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    } transition-colors duration-200`}>Provider: {pgForm.provider}</span>
                    <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                      pgForm.mode === 'live'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
                    } transition-colors duration-200`}>Mode: {pgForm.mode}</span>
                    {(paymentGateway?.settings?.sources || {}).stripe_secret_key && (
                      <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 transition-colors duration-200">
                        Secret: {paymentGateway.settings.sources.stripe_secret_key === 'env' ? 'Env var' : paymentGateway.settings.sources.stripe_secret_key === 'db' ? 'Platform DB' : 'Default'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Provider</label>
                <div className="flex gap-2">
                  {[
                    { key: 'stripe', label: 'Stripe' },
                    { key: 'manual', label: 'Manual Billing' }
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPgForm((p) => ({ ...p, provider: opt.key }))}
                      className={`flex-1 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors duration-200 ${
                        pgForm.provider === opt.key
                          ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-100'
                          : 'border-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Mode</label>
                <div className="flex gap-2">
                  {[
                    { key: 'test', label: 'Test' },
                    { key: 'live', label: 'Live' }
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPgForm((p) => ({ ...p, mode: opt.key }))}
                      className={`flex-1 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors duration-200 ${
                        pgForm.mode === opt.key
                          ? (opt.key === 'live' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100')
                          : 'border-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <MaskedInputField
                label="Publishable Key (PK_*)"
                value={pgForm.stripe_publishable_key || ''}
                onChange={(v) => setPgForm((p) => ({ ...p, stripe_publishable_key: v }))}
                placeholder="pk_test_… or pk_live_…"
                source={(paymentGateway?.settings?.sources || {}).stripe_publishable_key}
                fieldKey="stripe_publishable_key"
                autoComplete="off"
                apiFetch={apiFetch}
                onBanner={setPgBanner}
              />

              <MaskedInputField
                label="Secret Key (SK_*)"
                value={pgForm.stripe_secret_key || ''}
                onChange={(v) => setPgForm((p) => ({ ...p, stripe_secret_key: v }))}
                placeholder="sk_test_… / sk_live_… (leave masked to keep existing)"
                source={(paymentGateway?.settings?.sources || {}).stripe_secret_key}
                fieldKey="stripe_secret_key"
                autoComplete="new-password"
                apiFetch={apiFetch}
                onBanner={setPgBanner}
              />

              <MaskedInputField
                label="Webhook Secret (WHSEC_*)"
                value={pgForm.stripe_webhook_secret || ''}
                onChange={(v) => setPgForm((p) => ({ ...p, stripe_webhook_secret: v }))}
                placeholder="whsec_… (leave masked to keep existing)"
                source={(paymentGateway?.settings?.sources || {}).stripe_webhook_secret}
                fieldKey="stripe_webhook_secret"
                autoComplete="new-password"
                apiFetch={apiFetch}
                onBanner={setPgBanner}
              />

              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Frontend Base URL</label>
                  {(paymentGateway?.settings?.sources || {}).frontend_url && (
                    <SourcePill source={paymentGateway.settings.sources.frontend_url} />
                  )}
                </div>
                <input
                  type="text"
                  value={pgForm.frontend_url || ''}
                  onChange={(e) => setPgForm((p) => ({ ...p, frontend_url: e.target.value }))}
                  placeholder="https://tabletalk.app"
                  className="w-full rounded-xl border border-border bg-input px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 font-mono transition-colors duration-200"
                />
              </div>

              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Webhook Endpoint URL (paste this into Stripe)</label>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0 rounded-xl border border-border bg-input px-4 py-3 text-sm font-mono text-foreground truncate">
                    {derivedWebhookEndpointUrl}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        navigator.clipboard?.writeText(derivedWebhookEndpointUrl);
                        setPgBanner({ kind: 'success', message: 'Webhook endpoint URL copied to clipboard.' });
                      } catch (_) {
                        setPgBanner({ kind: 'error', message: 'Unable to copy URL. Copy it manually.' });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-muted px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors duration-200"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Copy
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-card/60 border border-border rounded-3xl p-6 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30">
                    <Building2 className="w-6 h-6 text-cyan-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">Registered Restaurants</h2>
                    <p className="text-xs text-muted-foreground mt-1">Pending restaurants are waiting for the invite link to be completed.</p>
                  </div>
                </div>
              </div>
              {pageLoading && <span className="text-xs text-muted-foreground">Refreshing…</span>}
            </div>

            {(tenantActionError || tenantActionSuccess) && (
              <div className={`mb-4 rounded-xl px-4 py-3 text-sm border ${
                tenantActionError
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              }`}>
                {tenantActionError || tenantActionSuccess}
              </div>
            )}

            <div className="grid grid-cols-12 gap-2 px-4 mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <div className="col-span-2">Name</div>
              <div className="col-span-2">Manager</div>
              <div className="col-span-2">Contact</div>
              <div className="col-span-3">Address</div>
              <div className="col-span-3">Status & Actions</div>
            </div>

            <div className="space-y-2">
              {tenants.map((tenant) => (
                <div key={tenant.id}>
                  <div
                    className={`grid grid-cols-12 grid-rows-1 gap-2 items-start px-4 py-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                      expandedId === tenant.id
                        ? 'bg-muted border-violet-500/40'
                        : 'bg-card/40 border-border hover:border-violet-500/30 hover:bg-muted/50'
                    }`}
                    onClick={() => setExpandedId(expandedId === tenant.id ? null : tenant.id)}
                  >
                    <div className="col-span-2 font-semibold text-foreground truncate min-w-0 leading-tight pt-1.5">{tenant.name}</div>
                    <div className="col-span-2 text-sm text-muted-foreground truncate min-w-0 leading-tight pt-1.5">{tenant.manager_name || 'Awaiting onboarding'}</div>
                    <div className="col-span-2 text-xs text-muted-foreground truncate min-w-0 leading-tight pt-1.5">
                      {tenant.contact_email ? <span className="text-foreground/80">{tenant.contact_email}</span> : '—'}
                      {tenant.contact_phone && <span className="ml-1 text-muted-foreground">· {tenant.contact_phone}</span>}
                    </div>
                    <div className="col-span-3 text-xs text-muted-foreground truncate min-w-0 leading-tight pt-1.5">{tenant.address || 'No address yet'}</div>
                    <div className="col-span-3 flex flex-col gap-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PlanBadge plan={tenant.plan} />
                        <StatusBadge status={tenant.computed_status || tenant.billing_status || 'pending'} plan={tenant.plan} />
                      </div>
                      <div className="flex flex-wrap items-center justify-start sm:justify-end gap-1.5">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openTenantBilling(tenant);
                          }}
                          title="Manage billing & plan"
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border border-violet-500/35 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 transition-colors duration-200 whitespace-nowrap"
                        >
                          <CreditCard className="w-3 h-3" />
                          Billing
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleBilling(tenant);
                          }}
                          title={(tenant.computed_status || tenant.billing_status) === 'active' ? 'Suspend tenant' : 'Activate tenant'}
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border transition-colors duration-200 whitespace-nowrap ${
                            (tenant.computed_status || tenant.billing_status) === 'active'
                              ? 'border-rose-500/30 hover:bg-rose-500/10 text-rose-400'
                              : 'border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-400'
                          }`}
                        >
                          {(tenant.computed_status || tenant.billing_status) === 'active' ? <Ban className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                          {(tenant.computed_status || tenant.billing_status) === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openEdit(tenant);
                          }}
                          title="Edit restaurant"
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border border-border hover:border-violet-500/50 hover:bg-violet-500/10 text-muted-foreground hover:text-violet-300 transition-colors duration-200 whitespace-nowrap"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handlePermanentDeleteTenant(tenant);
                          }}
                          disabled={tenant.slug === 'default' || tenantActionLoading}
                          title="Permanently remove tenant"
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border border-rose-500/30 hover:bg-rose-500/10 text-rose-300 transition-colors duration-200 disabled:opacity-40 whitespace-nowrap"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  <AnimatePresence>
                    {expandedId === tenant.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 py-4">
                          <div className="space-y-2 text-sm">
                            <h4 className="font-bold text-slate-300 text-xs uppercase tracking-wider">Location</h4>
                            {tenant.latitude && tenant.longitude ? (
                              <div className="text-xs text-slate-500 mb-1">
                                {parseFloat(tenant.latitude).toFixed(5)}, {parseFloat(tenant.longitude).toFixed(5)}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-500 mb-1">Coordinates are generated from the saved address.</div>
                            )}
                            <MapDisplay latitude={tenant.latitude} longitude={tenant.longitude} address={tenant.address} height={160} />
                          </div>
                          <div className="space-y-2 text-sm">
                            <h4 className="font-bold text-slate-300 text-xs uppercase tracking-wider">Details</h4>
                            <div className="space-y-1.5 text-xs">
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Slug</span><span className="text-slate-300">/{tenant.slug}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Manager</span><span className="text-slate-300">{tenant.manager_name || '—'}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Email</span><span className="text-slate-300">{tenant.contact_email || '—'}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Phone</span><span className="text-slate-300">{tenant.contact_phone || '—'}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Address</span><span className="text-slate-300">{tenant.address || '—'}</span></div>
                              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Created</span><span className="text-slate-300">{tenant.created_at ? new Date(tenant.created_at).toLocaleDateString() : '—'}</span></div>
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
          </section>
          </div>
          <div>
            <div className="bg-card/60 border border-border rounded-3xl p-6 shadow-xl backdrop-blur-md sticky top-6 space-y-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30">
                    <Plus className="w-6 h-6 text-violet-400" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground">Create Subscription Invite</h2>
                </div>
                <p className="text-xs text-muted-foreground">Enter the restaurant name and email, then send the generated onboarding link by URL, email, or QR code.</p>
              </div>

              {inviteError && <Banner tone="error" message={inviteError} />}
              {inviteSuccess && <Banner tone="success" message={inviteSuccess} />}

              <form onSubmit={handleCreateInvite} className="space-y-3">
                <FormField
                  label="Restaurant Name *"
                  placeholder="The French Bistro"
                  value={inviteForm.name}
                  onChange={(value) => setInviteForm((current) => ({ ...current, name: value }))}
                />
                <FormField
                  label="Restaurant Email *"
                  placeholder="owner@frenchbistro.com"
                  type="email"
                  value={inviteForm.email}
                  onChange={(value) => setInviteForm((current) => ({ ...current, email: value }))}
                />

                <button
                  type="submit"
                  disabled={inviteLoading}
                  className="inline-flex items-center justify-center gap-2 w-full bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white font-bold py-3 px-4 rounded-xl transition-all duration-200 disabled:opacity-50 text-sm mt-2"
                >
                  {inviteLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                  {inviteLoading ? 'Generating Invite...' : 'Generate Subscription Link'}
                </button>
              </form>

              {generatedInvite && (
                <div className="space-y-4 pt-4 border-t border-border">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Invite Ready</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Expires on {new Date(generatedInvite.invite.expires_at).toLocaleString()}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Subscription URL</label>
                    <ReadOnlyBlock value={generatedInvite.invite.url} />
                    <button
                      type="button"
                      onClick={() => copyText(generatedInvite.invite.url, 'Subscription URL copied to clipboard.')}
                      className="mt-2 text-xs font-semibold text-violet-600 hover:text-violet-700 dark:text-purple-300 dark:hover:text-purple-200 transition-colors duration-200"
                    >
                      Copy URL
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Direct Email Link</label>
                    <ReadOnlyBlock value={generatedInvite.invite.mailto_url} />
                    <div className="flex gap-3 mt-2 text-xs font-semibold">
                      <a
                        href={generatedInvite.invite.mailto_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => {
                          event.preventDefault();
                          const draftWindow = window.open(
                            generatedInvite.invite.mailto_url,
                            '_blank',
                            'noopener,noreferrer'
                          );

                          if (!draftWindow) {
                            window.location.href = generatedInvite.invite.mailto_url;
                          }
                        }}
                        className="text-violet-600 hover:text-violet-700 dark:text-cyan-300 dark:hover:text-cyan-200 transition-colors duration-200"
                      >
                        Open Email Draft
                      </a>
                      <button
                        type="button"
                        onClick={() => copyText(generatedInvite.invite.email_body, 'Email message copied to clipboard.')}
                        className="text-violet-600 hover:text-violet-700 dark:text-purple-300 dark:hover:text-purple-200 transition-colors duration-200"
                      >
                        Copy Email Text
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">QR Code</label>
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white p-4 inline-flex shadow-sm transition-colors duration-300">
                      <img src={generatedInvite.invite.qr_code_data_url} alt="Subscription QR code" className="w-48 h-48" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === TAB_QUESTIONS && (
        <div className="w-full">
          <section className="bg-card border border-border rounded-3xl p-6 shadow-[0_4px_24px_rgba(15,23,42,0.03)] dark:bg-slate-900/60 dark:border-slate-800 dark:shadow-xl dark:backdrop-blur-md transition-colors duration-300">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-foreground">Global Question Library</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Structured by <span className="text-slate-800 dark:text-slate-300 font-medium">Context → Question Type → Difficulty</span>. CSV headers supported: <span className="text-slate-800 dark:text-slate-300 font-mono">question_text, answer_text, category, sub_category, difficulty, question_type, context, options, active, sort_order</span>
                </p>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{globalQuestions.length} questions loaded</div>
            </div>

            {questionError && <Banner tone="error" message={questionError} />}
            {questionSuccess && <Banner tone="success" message={questionSuccess} />}

            <div className="rounded-2xl border border-border bg-card/80 p-4 mb-6">
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">CSV File</label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setCsvFile(event.target.files?.[0] || null)}
                    className="block w-full text-sm text-foreground/80 file:mr-4 file:rounded-xl file:border-0 file:bg-violet-500 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-violet-600 file:cursor-pointer cursor-pointer transition-colors duration-200"
                  />
                  <div className="text-xs text-muted-foreground mt-2">
                    {csvFile ? `Selected: ${csvFile.name}` : 'Upload a CSV exported from Excel, Google Sheets, or another spreadsheet tool.'}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replaceQuestions}
                    onChange={(event) => setReplaceQuestions(event.target.checked)}
                    className="rounded border-border bg-input text-violet-500 focus:ring-violet-500 focus:ring-offset-background transition-colors duration-200"
                  />
                  Replace existing global questions
                </label>
                <button
                  type="button"
                  onClick={handleCsvImport}
                  disabled={questionLoading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50 transition-all duration-200"
                >
                  {questionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {questionLoading ? 'Uploading...' : 'Upload CSV'}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card/70 p-4 mb-6 space-y-4">
              <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Search Questions</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={questionSearch}
                      onChange={(event) => setQuestionSearch(event.target.value)}
                      placeholder="Search question text, follow-up, options, context, type, or difficulty"
                      className="w-full pl-10 bg-input border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500 transition-colors duration-200 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 xl:w-[360px]">
                  <QuestionStatCard label="Contexts" value={groupedQuestionData.stats.contexts} />
                  <QuestionStatCard label="Types" value={groupedQuestionData.stats.typeGroups} />
                  <QuestionStatCard label="Visible" value={groupedQuestionData.stats.questions} />
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <FilterGroup
                  label="Context"
                  options={['All', 'Exploring', 'Established', 'Mature', 'Unassigned']}
                  selected={selectedContext}
                  onSelect={setSelectedContext}
                />
                <FilterGroup
                  label="Question Type"
                  options={['All', 'open-ended', 'multiple-choice']}
                  selected={selectedQuestionType}
                  onSelect={setSelectedQuestionType}
                  formatter={formatQuestionType}
                />
                <FilterGroup
                  label="Difficulty"
                  options={['All', 'easy', 'medium', 'deep']}
                  selected={selectedDifficulty}
                  onSelect={setSelectedDifficulty}
                  formatter={formatDifficulty}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <DifficultyStatCard label="Easy" value={groupedQuestionData.stats.difficultyBreakdown.easy} tone="easy" />
                <DifficultyStatCard label="Medium" value={groupedQuestionData.stats.difficultyBreakdown.medium} tone="medium" />
                <DifficultyStatCard label="Deep" value={groupedQuestionData.stats.difficultyBreakdown.deep} tone="deep" />
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 px-4 py-3 transition-colors duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-1 min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">Question Actions</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {selectedQuestionIds.length > 0
                        ? `${selectedQuestionIds.length} selected for bulk delete`
                        : `${groupedQuestionData.filteredQuestions.length} question(s) match the current filters.`}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <SelectionCountBar
                      label="Matching filters"
                      total={groupedQuestionData.filteredQuestions.length}
                      selected={countSelectedInGroup(groupedQuestionData.filteredQuestions.map((q) => q.question_id))}
                      onSelectAll={selectAllMatchingFilters}
                      onClear={() => setSelectedQuestionIds([])}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={exportQuestionsCsv}
                    disabled={groupedQuestionData.filteredQuestions.length === 0}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-40 transition-colors duration-200"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedQuestionIds([])}
                    disabled={selectedQuestionIds.length === 0}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-transparent px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500 disabled:opacity-40 transition-colors duration-200"
                  >
                    Clear Selection
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDeleteQuestions}
                    disabled={selectedQuestionIds.length === 0 || questionActionLoading}
                    className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-40 transition-colors duration-200"
                  >
                    {questionActionLoading ? 'Working...' : 'Bulk Delete'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {groupedQuestionData.contexts.map((contextGroup) => {
                const contextIds = collectGroupIds(contextGroup);
                const contextSelected = countSelectedInGroup(contextIds);
                return (
                <div
                  key={contextGroup.label}
                  className={`rounded-3xl border overflow-hidden ${getContextSectionClasses(contextGroup.label)} transition-colors duration-300`}
                >
                  <div className="px-5 py-4 border-b border-slate-200/60 dark:border-white/10 flex flex-col gap-3 transition-colors duration-300">
                    <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
                      <div className="min-w-0 shrink-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="text-lg font-bold text-slate-900 dark:text-white whitespace-nowrap">{contextGroup.label}</div>
                          <ContextPill label={contextGroup.label} />
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-200/80 mt-1">
                          {contextGroup.types.length} question types · {contextGroup.questionCount} questions
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-white/70 tracking-wide whitespace-nowrap shrink-0">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                          contextSelected === contextGroup.questionCount && contextSelected > 0
                            ? 'bg-indigo-500 dark:bg-violet-400'
                            : contextSelected > 0
                              ? 'bg-amber-500 dark:bg-amber-400'
                              : 'bg-slate-400 dark:bg-slate-600'
                        }`} />
                        {contextSelected}/{contextGroup.questionCount} · Context
                      </span>
                    </div>
                    <div className="flex items-center gap-2 justify-end shrink-0">
                      <button
                        type="button"
                        onClick={() => selectQuestionIds(contextIds, 'add')}
                        disabled={!contextGroup.questionCount}
                        className="inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-40 transition-colors duration-200 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => selectQuestionIds(contextIds, 'remove')}
                        disabled={contextSelected === 0}
                        className="inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-40 transition-colors duration-200 border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800/80"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-4 bg-white/40 dark:bg-slate-950/30 transition-colors duration-300">
                    {contextGroup.types.map((typeGroup) => {
                      const typeIds = collectGroupIds(typeGroup);
                      const typeSelected = countSelectedInGroup(typeIds);
                      return (
                      <div key={`${contextGroup.label}-${typeGroup.label}`} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 overflow-hidden shadow-[0_2px_12px_rgba(15,23,42,0.03)] dark:shadow-none transition-colors duration-300">
                        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-2 transition-colors duration-300">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <div className="flex items-center gap-2 min-w-0 shrink-0 flex-wrap">
                              <div>
                                <div className="text-sm font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">{formatQuestionType(typeGroup.label)}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{typeGroup.questionCount} questions</div>
                              </div>
                              <QuestionChip label={formatQuestionTypeCompact(typeGroup.label)} tone="accent" compact />
                            </div>
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-white/70 tracking-wide whitespace-nowrap shrink-0">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                                typeSelected === typeGroup.questionCount && typeSelected > 0
                                  ? 'bg-indigo-500 dark:bg-violet-400'
                                  : typeSelected > 0
                                    ? 'bg-amber-500 dark:bg-amber-400'
                                    : 'bg-slate-400 dark:bg-slate-600'
                              }`} />
                              {typeSelected}/{typeGroup.questionCount} · Type
                            </span>
                          </div>
                          <div className="flex items-center gap-2 justify-end shrink-0">
                            <button
                              type="button"
                              onClick={() => selectQuestionIds(typeIds, 'add')}
                              disabled={!typeGroup.questionCount}
                              className="inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-40 transition-colors duration-200 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              onClick={() => selectQuestionIds(typeIds, 'remove')}
                              disabled={typeSelected === 0}
                              className="inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-40 transition-colors duration-200 border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800/80"
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 p-4">
                          {DIFFICULTY_ORDER.map((difficulty) => {
                            const difficultyGroup = typeGroup.difficulties.find((item) => item.label === difficulty);
                            const sectionKey = `${contextGroup.label}-${typeGroup.label}-${difficulty}`;
                            const visibleCount = questionDisplayLimits[sectionKey] || DEFAULT_SECTION_VISIBLE_COUNT;
                            const visibleQuestions = difficultyGroup ? difficultyGroup.questions.slice(0, visibleCount) : [];
                            const hiddenCount = difficultyGroup ? Math.max(difficultyGroup.questions.length - visibleQuestions.length, 0) : 0;
                            return (
                              <div
                                key={sectionKey}
                                className={`rounded-2xl border min-h-[180px] overflow-hidden ${getDifficultySectionClasses(difficulty)} transition-colors duration-300`}
                              >
                                <div className="px-4 py-3 border-b border-slate-200/60 dark:border-white/10 flex flex-col gap-2 transition-colors duration-300">
                                  <div className="flex items-center justify-between gap-2 min-w-0">
                                    <div className="flex items-center gap-2 min-w-0 shrink-0">
                                      <div className="text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatDifficulty(difficulty)}</div>
                                      <span className="text-xs font-semibold text-slate-500 dark:text-white/70 tabular-nums">{difficultyGroup ? difficultyGroup.questions.length : 0}</span>
                                    </div>
                                    {difficultyGroup && (
                                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-white/70 tracking-wide whitespace-nowrap shrink-0">
                                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                                          countSelectedInGroup(difficultyGroup.questions.map((q) => q.question_id)) === difficultyGroup.questions.length
                                            ? 'bg-indigo-500 dark:bg-violet-400'
                                            : countSelectedInGroup(difficultyGroup.questions.map((q) => q.question_id)) > 0
                                              ? 'bg-amber-500 dark:bg-amber-400'
                                              : 'bg-slate-400 dark:bg-slate-600'
                                        }`} />
                                        {countSelectedInGroup(difficultyGroup.questions.map((q) => q.question_id))}/{difficultyGroup.questions.length}
                                      </span>
                                    )}
                                  </div>
                                  {difficultyGroup && (
                                    <div className="flex items-center gap-2 justify-end shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => selectQuestionIds(difficultyGroup.questions.map((q) => q.question_id), 'add')}
                                        disabled={difficultyGroup.questions.length === 0}
                                        className="inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-40 transition-colors duration-200 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
                                      >
                                        Select all
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => selectQuestionIds(difficultyGroup.questions.map((q) => q.question_id), 'remove')}
                                        disabled={countSelectedInGroup(difficultyGroup.questions.map((q) => q.question_id)) === 0}
                                        className="inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-40 transition-colors duration-200 border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800/80"
                                      >
                                        Clear
                                      </button>
                                    </div>
                                  )}
                                </div>

                                <div className="p-3 space-y-3">
                                  {difficultyGroup ? (
                                    visibleQuestions.map((question) => {
                                      const questionIndex = globalQuestions.findIndex(
                                        (item) => item.question_id === question.question_id
                                      );
                                      const isExpanded = Boolean(expandedQuestions[question.question_id]);
                                      const isSelected = selectedQuestionIds.includes(question.question_id);
                                      const qStatus =
                                        question.flagged === true
                                          ? 'flagged'
                                          : question.active === false ||
                                              (question.answer_text == null || String(question.answer_text).trim() === '')
                                            ? 'draft'
                                            : 'active';
                                      const statusCfg =
                                        qStatus === 'active'
                                          ? {
                                              label: 'Active',
                                              classes:
                                                'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/30',
                                              Icon: CheckCircle2
                                            }
                                          : qStatus === 'draft'
                                            ? {
                                                label: 'Draft',
                                                classes:
                                                  'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/30',
                                                Icon: Clock
                                              }
                                            : {
                                                label: 'Flagged',
                                                classes:
                                                  'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:border-rose-500/30',
                                                Icon: AlertCircle
                                              };
                                      const StatusIcon = statusCfg.Icon;

                                      return (
                                        <div
                                          key={question.question_id}
                                          className={`rounded-xl border overflow-hidden transition-all duration-200 ${
                                            isSelected
                                              ? 'border-indigo-300 bg-indigo-50/80 dark:border-violet-500/40 dark:bg-violet-500/8'
                                              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/80 dark:hover:border-slate-700'
                                          }`}
                                        >
                                          <div className="flex flex-col px-3.5 py-3 min-w-0">
                                            <div className="flex items-center justify-between gap-2 min-w-0">
                                              <div className="flex items-center gap-2 shrink-0 min-w-0">
                                                <input
                                                  type="checkbox"
                                                  checked={isSelected}
                                                  onChange={() => toggleQuestionSelection(question.question_id)}
                                                  className="shrink-0 rounded border-slate-300 bg-white text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-purple-500 focus:ring-indigo-500 dark:focus:ring-purple-500"
                                                />
                                                <span
                                                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] whitespace-nowrap ${statusCfg.classes}`}
                                                >
                                                  <StatusIcon size={10} />
                                                  {statusCfg.label}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-0.5 shrink-0">
                                                <button
                                                  onClick={() => moveQuestion(question.question_id, -1)}
                                                  disabled={questionIndex <= 0}
                                                  aria-label="Move question up"
                                                  className="hidden xl:inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-800 dark:hover:border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-all w-6 h-6"
                                                >
                                                  <ChevronDown size={12} className="-rotate-90" />
                                                </button>
                                                <button
                                                  onClick={() => moveQuestion(question.question_id, 1)}
                                                  disabled={questionIndex === -1 || questionIndex >= globalQuestions.length - 1}
                                                  aria-label="Move question down"
                                                  className="hidden xl:inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-800 dark:hover:border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-all w-6 h-6"
                                                >
                                                  <ChevronDown size={12} className="rotate-90" />
                                                </button>
                                                <div className="hidden xl:block w-px h-5 bg-slate-200 dark:bg-slate-800 mx-0.5" />
                                                <button
                                                  type="button"
                                                  onClick={() => openQuestionEditor(question)}
                                                  aria-label="Edit question"
                                                  title="Edit"
                                                  className="inline-flex items-center justify-center rounded-md border border-cyan-200 bg-cyan-50 hover:bg-cyan-100 dark:border-cyan-500/20 dark:bg-cyan-500/5 dark:hover:bg-cyan-500/10 w-7 h-7 text-cyan-700 dark:text-cyan-200 transition-all"
                                                >
                                                  <Pencil size={12} />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleDeleteQuestion(question.question_id)}
                                                  aria-label="Delete question"
                                                  title="Delete"
                                                  className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/5 dark:hover:bg-rose-500/10 w-7 h-7 text-rose-700 dark:text-rose-200 transition-all"
                                                >
                                                  <Trash2 size={12} />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => toggleQuestionExpanded(question.question_id)}
                                                  aria-label={isExpanded ? 'Hide details' : 'View details'}
                                                  title={isExpanded ? 'Hide' : 'More'}
                                                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:bg-slate-800 dark:hover:border-slate-600 w-7 h-7 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-all"
                                                >
                                                  <MoreHorizontal
                                                    size={12}
                                                    className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                                                  />
                                                </button>
                                              </div>
                                            </div>

                                            <button
                                              type="button"
                                              onClick={() => toggleQuestionExpanded(question.question_id)}
                                              className="w-full text-left mt-2.5 min-w-0"
                                            >
                                              <div className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-[1.45] line-clamp-2 min-h-[2.1em]">
                                                {question.question_text ? (
                                                  question.question_text
                                                ) : (
                                                  <span className="text-slate-400 dark:text-slate-500 italic text-[13px]">No question text — click Edit to add</span>
                                                )}
                                              </div>
                                            </button>

                                            <div className="mt-2.5 flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-none">
                                              <QuestionChip label={contextGroup.label} compact />
                                              <QuestionChip label={formatQuestionTypeCompact(typeGroup.label)} tone="accent" compact />
                                              <QuestionChip label={formatDifficulty(difficulty)} tone={difficulty} compact />
                                            </div>
                                          </div>

                                          <AnimatePresence>
                                            {isExpanded && (
                                              <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="overflow-hidden"
                                              >
                                                <div className="px-4 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800/70 mt-0.5 space-y-2.5 transition-colors duration-300">
                                                  <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-400 leading-5 transition-colors duration-300">
                                                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-500 mb-0.5">Full Question</span>
                                                    <div className="text-slate-800 dark:text-slate-200 leading-6">{question.question_text}</div>
                                                  </div>
                                                  {question.answer_text && (
                                                    <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-400 leading-5 transition-colors duration-300">
                                                      <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-500 mb-0.5">Follow-up / Tip</span>
                                                      <div className="text-slate-800 dark:text-slate-300 leading-6">{question.answer_text}</div>
                                                    </div>
                                                  )}
                                                  {getOptionsPreview(question.options) && (
                                                    <div className="text-xs text-slate-500 dark:text-slate-500 leading-5 px-1">
                                                      <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-500 mr-2">Options</span>
                                                      <span className="text-slate-700 dark:text-slate-300">{getOptionsPreview(question.options)}</span>
                                                    </div>
                                                  )}
                                                </div>
                                              </motion.div>
                                            )}
                                          </AnimatePresence>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 dark:border-white/10 dark:bg-slate-950/40 px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400 transition-colors duration-300">
                                      No {formatDifficulty(difficulty).toLowerCase()} questions in this section.
                                    </div>
                                  )}

                                  {hiddenCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => handleShowMoreQuestions(sectionKey)}
                                      className="w-full rounded-xl border border-slate-200 bg-white hover:border-slate-400 dark:border-slate-700 dark:bg-slate-950/80 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 dark:hover:border-slate-500 transition-colors duration-200"
                                    >
                                      Show {Math.min(DEFAULT_SECTION_VISIBLE_COUNT, hiddenCount)} More
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
                );
              })}

              {groupedQuestionData.stats.questions === 0 && (
                <div className="py-10 text-center text-sm text-slate-500">
                  {globalQuestions.length === 0
                    ? 'No global questions found. Import your first CSV to create the question bank.'
                    : 'No questions match your current search and filters.'}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <AnimatePresence>
        {editingQuestion && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-bold">Edit Question</h3>
                  <p className="text-xs text-slate-500 mt-1">Update question content, difficulty, context, and answer options.</p>
                </div>
                <button onClick={() => setEditingQuestion(null)} className="text-slate-500 hover:text-white text-2xl leading-none">&times;</button>
              </div>

              <form onSubmit={handleSaveQuestion} className="space-y-4">
                <TextAreaField
                  label="Question Text"
                  placeholder="Enter the main question"
                  value={questionForm.question_text}
                  onChange={(value) => setQuestionForm((current) => ({ ...current, question_text: value }))}
                />
                <TextAreaField
                  label="Follow-up / Tip"
                  placeholder="Optional follow-up guidance"
                  value={questionForm.answer_text}
                  onChange={(value) => setQuestionForm((current) => ({ ...current, answer_text: value }))}
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <SelectField
                    label="Context"
                    value={questionForm.context}
                    options={['Exploring', 'Established', 'Mature']}
                    onChange={(value) => setQuestionForm((current) => ({ ...current, context: value }))}
                  />
                  <SelectField
                    label="Question Type"
                    value={questionForm.question_type}
                    options={['open-ended', 'multiple-choice']}
                    onChange={(value) => setQuestionForm((current) => ({ ...current, question_type: value }))}
                    formatter={formatQuestionType}
                  />
                  <SelectField
                    label="Difficulty"
                    value={questionForm.difficulty}
                    options={['easy', 'medium', 'deep']}
                    onChange={(value) => setQuestionForm((current) => ({ ...current, difficulty: value }))}
                    formatter={formatDifficulty}
                  />
                </div>
                {questionForm.question_type === 'multiple-choice' && (
                  <TextAreaField
                    label="Options"
                    placeholder="Separate choices with | or paste JSON array"
                    value={questionForm.options}
                    onChange={(value) => setQuestionForm((current) => ({ ...current, options: value }))}
                  />
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingQuestion(null)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl transition-all text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={questionActionLoading}
                    className="flex-1 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 text-sm"
                  >
                    {questionActionLoading ? 'Saving...' : 'Save Question'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {editingTenant && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Edit Restaurant</h3>
                <button onClick={() => setEditingTenant(null)} className="text-slate-500 hover:text-white text-2xl leading-none">&times;</button>
              </div>

              {editError && <Banner tone="error" message={editError} />}
              {editSuccess && <Banner tone="success" message={editSuccess} />}

              <form onSubmit={handleUpdate} className="space-y-3">
                <FormField label="Restaurant Name" placeholder="Name" value={editForm.name} onChange={(value) => setEditForm((current) => ({ ...current, name: value }))} />
                <FormField label="URL Slug" placeholder="slug" value={editForm.slug} onChange={(value) => setEditForm((current) => ({ ...current, slug: value }))} />
                <FormField label="Manager / Owner Name" placeholder="Name" value={editForm.managerName} onChange={(value) => setEditForm((current) => ({ ...current, managerName: value }))} />
                <FormField label="Contact Email" placeholder="email" type="email" value={editForm.contactEmail} onChange={(value) => setEditForm((current) => ({ ...current, contactEmail: value }))} />
                <FormField label="Contact Phone" placeholder="phone" value={editForm.contactPhone} onChange={(value) => setEditForm((current) => ({ ...current, contactPhone: value }))} />
                <TextAreaField label="Street Address" placeholder="Full address" value={editForm.address} onChange={(value) => setEditForm((current) => ({ ...current, address: value }))} />
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs text-slate-400">
                  {tenantAddressLookup.loading
                    ? 'Looking up latitude and longitude from the address...'
                    : tenantAddressLookup.error
                      ? tenantAddressLookup.error
                      : 'Latitude and longitude are filled automatically when the address is recognized.'}
                </div>
                {(editForm.latitude && editForm.longitude) && (
                  <div className="text-xs text-slate-500">
                    {Number(editForm.latitude).toFixed(5)}, {Number(editForm.longitude).toFixed(5)}
                  </div>
                )}
                {((editForm.latitude && editForm.longitude) || editForm.address) && (
                  <div className="rounded-xl overflow-hidden border border-slate-700">
                    <MapDisplay
                      latitude={editForm.latitude ? Number(editForm.latitude) : null}
                      longitude={editForm.longitude ? Number(editForm.longitude) : null}
                      address={editForm.address}
                      height={140}
                    />
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingTenant(null)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl transition-all text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pageLoading}
                    className="flex-1 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 text-sm"
                  >
                    {pageLoading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {billingDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center px-4 py-6 bg-black/70 backdrop-blur-sm overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-900 border border-slate-700 w-full max-w-5xl rounded-3xl p-6 shadow-2xl my-auto"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-2xl font-extrabold tracking-tight text-white">{billingDetail.tenant?.name || billingDetail.billing?.name || 'Restaurant Billing'}</h3>
                    <PlanBadge plan={billingDetail.billing?.plan || 'trial'} />
                    <StatusBadge status={billingDetail.billing?.computed_status || billingDetail.billing?.billing_status || 'pending'} plan={billingDetail.billing?.plan} />
                  </div>
                  <p className="text-xs text-slate-400">
                    ID: {billingDetail.tenant?.id || billingDetail.billing?.id} · Slug: /{billingDetail.tenant?.slug || billingDetail.billing?.slug}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right text-xs text-slate-500">
                    <div>Stripe: {billingDetail.billing?.stripe_subscription_id ? 'linked' : 'not linked'}</div>
                    <div>Provider: {billingDetail.billing?.billing_provider || 'manual'}</div>
                  </div>
                  <button onClick={() => setBillingDetail(null)} className="text-slate-500 hover:text-white text-2xl leading-none">&times;</button>
                </div>
              </div>

              {billingError && <Banner tone="error" message={billingError} />}
              {billingSuccess && <Banner tone="success" message={billingSuccess} />}

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 transition-colors duration-300 p-5 mb-6">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">Current Plan &amp; Entitlements</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <BillingStat label="Plan" value={formatPlanLabel(billingDetail.billing?.plan)} accent="violet" />
                  <BillingStat label="Status" value={billingDetail.billing?.computed_status || billingDetail.billing?.billing_status} accent={billingDetail.billing?.computed_status === 'active' ? 'emerald' : billingDetail.billing?.computed_status === 'trialing' ? 'amber' : 'rose'} />
                  <BillingStat label="Max Tables" value={billingDetail.billing?.max_tables ?? '—'} accent="cyan" />
                  <BillingStat label="Monthly Sessions" value={billingDetail.billing?.max_monthly_sessions ?? '—'} accent="cyan" />
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <EntitlementChip label="Generate QR" enabled={Boolean(billingDetail.billing?.can_generate_qr)} />
                  <EntitlementChip label="Export Analytics" enabled={Boolean(billingDetail.billing?.can_export_analytics)} />
                  <EntitlementChip label="Custom QR Brand" enabled={Boolean(billingDetail.billing?.can_use_custom_qr_branding)} />
                  <EntitlementChip label="Dual-Phone" enabled={Boolean(billingDetail.billing?.can_use_dual_phone_sessions)} />
                  <EntitlementChip label="Support" enabled={Boolean(billingDetail.billing?.can_access_support)} value={billingDetail.billing?.support_tier} />
                </div>
                <div className="mt-4 space-y-1 text-xs text-slate-400">
                  {billingDetail.billing?.trial_ends_at && <div>Trial ends on: {new Date(billingDetail.billing.trial_ends_at).toLocaleString()}</div>}
                  {billingDetail.billing?.subscription_started_at && <div>Subscription started: {new Date(billingDetail.billing.subscription_started_at).toLocaleDateString()}</div>}
                  {billingDetail.billing?.subscription_current_period_end && <div>Renewal: {new Date(billingDetail.billing.subscription_current_period_end).toLocaleString()}</div>}
                  {billingDetail.billing?.subscription_cancel_at_period_end && <div className="text-amber-300">Cancels at period end.</div>}
                </div>
              </div>

              <div className="space-y-3 mb-6">
                {/* Panel: Select Plan */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 transition-colors duration-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenPanel(openPanel === 'plan' ? null : 'plan')}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-900/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300">
                        <Crown size={18} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">Select Plan</div>
                        <div className="text-xs text-slate-500 mt-0.5">Choose subscription tier and apply plan changes</div>
                      </div>
                    </div>
                    <ChevronDown
                      size={20}
                      className={`text-slate-400 transition-transform duration-200 ${openPanel === 'plan' ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {openPanel === 'plan' && (
                    <div className="px-5 pb-5 pt-1 border-t border-slate-800 space-y-4">
                      <div className="flex flex-wrap items-center justify-center gap-2 py-1 rounded-xl bg-slate-900/60 border border-slate-800 p-1">
                        {(['trial', 'starter', 'premium']).map((planKey) => {
                          const active = billingPlanForm.plan === planKey;
                          const Icon = planKey === 'trial' ? Clock : planKey === 'starter' ? Zap : Rocket;
                          const activeClasses = active
                            ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-lg shadow-violet-500/20 border-transparent'
                            : 'text-slate-300 hover:text-white border-transparent hover:bg-slate-800/60';
                          return (
                            <button
                              key={planKey}
                              type="button"
                              onClick={() => setBillingPlanForm((f) => ({ ...f, plan: planKey }))}
                              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all border ${activeClasses}`}
                            >
                              <Icon size={14} />
                              {formatPlanLabel(planKey)}
                            </button>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {([
                          { key: 'trial', accent: 'amber', Icon: Clock, desc: '14-day evaluation, full feature access', price: '$0' },
                          { key: 'starter', accent: 'cyan', Icon: Zap, desc: 'Up to 10 tables · 500 sessions/mo', price: '$49/mo' },
                          { key: 'premium', accent: 'violet', Icon: Rocket, desc: 'Unlimited tables · priority support', price: '$149/mo' },
                        ]).map(({ key, accent, Icon, desc, price }) => {
                          const active = billingPlanForm.plan === key;
                          const accentRing =
                            accent === 'amber'
                              ? 'border-amber-500/50 bg-amber-500/5 shadow-[0_0_0_1px_rgba(245,158,11,0.2)]'
                              : accent === 'cyan'
                                ? 'border-cyan-500/50 bg-cyan-500/5 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]'
                                : 'border-violet-500/50 bg-violet-500/5 shadow-[0_0_0_1px_rgba(168,85,247,0.2)]';
                          const iconTint =
                            accent === 'amber'
                              ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                              : accent === 'cyan'
                                ? 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30'
                                : 'text-violet-300 bg-violet-500/15 border-violet-500/30';
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setBillingPlanForm((f) => ({ ...f, plan: key }))}
                              className={`text-left rounded-2xl border p-4 transition-all ${
                                active ? accentRing : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${iconTint}`}>
                                  <Icon size={18} />
                                </div>
                                <div className="text-right">
                                  <div className="text-lg font-extrabold text-white">{price}</div>
                                </div>
                              </div>
                              <div className="mt-3 text-sm font-bold text-white">{formatPlanLabel(key)}</div>
                              <div className="mt-1 text-xs text-slate-400 leading-5">{desc}</div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Trial Days</label>
                          <div className="relative">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                              <Clock size={16} />
                            </div>
                            <input
                              type="number"
                              value={billingPlanForm.trialDays}
                              onChange={(event) => setBillingPlanForm((f) => ({ ...f, trialDays: event.target.value }))}
                              placeholder="14"
                              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-700/60 bg-slate-950/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Stripe Price ID Override (optional)</label>
                          <div className="relative">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                              <FileText size={16} />
                            </div>
                            <input
                              type="text"
                              value={billingPlanForm.stripePriceId}
                              onChange={(event) => setBillingPlanForm((f) => ({ ...f, stripePriceId: event.target.value }))}
                              placeholder="price_xxx"
                              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-700/60 bg-slate-950/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleSetPlan}
                        disabled={billingActionLoading}
                        className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white font-bold py-3 px-4 text-sm transition-all disabled:opacity-50 shadow-lg shadow-violet-500/10"
                      >
                        {billingActionLoading ? 'Applying plan…' : `Assign ${formatPlanLabel(billingPlanForm.plan)} Plan`}
                      </button>
                    </div>
                  )}
                </div>

                {/* Panel: Table & Session Limits Entitlements */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 transition-colors duration-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenPanel(openPanel === 'entitlements-limits' ? null : 'entitlements-limits')}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-900/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300">
                        <LayoutDashboard size={18} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">Table &amp; Session Limits</div>
                        <div className="text-xs text-slate-500 mt-0.5">Override max tables and monthly session caps</div>
                      </div>
                    </div>
                    <ChevronDown
                      size={20}
                      className={`text-slate-400 transition-transform duration-200 ${openPanel === 'entitlements-limits' ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {openPanel === 'entitlements-limits' && (
                    <div className="px-5 pb-5 pt-1 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Max Tables (blank = no change)</label>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                            <Hash size={16} />
                          </div>
                          <input
                            type="number"
                            value={billingEntitlementsForm.max_tables}
                            onChange={(event) => setBillingEntitlementsForm((f) => ({ ...f, max_tables: event.target.value }))}
                            placeholder="10"
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-700/60 bg-slate-950/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Max Sessions / Month</label>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                            <Users size={16} />
                          </div>
                          <input
                            type="number"
                            value={billingEntitlementsForm.max_monthly_sessions}
                            onChange={(event) => setBillingEntitlementsForm((f) => ({ ...f, max_monthly_sessions: event.target.value }))}
                            placeholder="500"
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-700/60 bg-slate-950/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Panel: Feature Flags */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 transition-colors duration-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenPanel(openPanel === 'feature-flags' ? null : 'feature-flags')}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-900/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300">
                        <Flag size={18} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">Feature Flags</div>
                        <div className="text-xs text-slate-500 mt-0.5">Toggle entitlement switches and support tier</div>
                      </div>
                    </div>
                    <ChevronDown
                      size={20}
                      className={`text-slate-400 transition-transform duration-200 ${openPanel === 'feature-flags' ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {openPanel === 'feature-flags' && (
                    <div className="px-5 pb-5 pt-1 border-t border-slate-800 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <SelectField label="Can Generate QR?" value={billingEntitlementsForm.can_generate_qr} options={['', 'true', 'false']} onChange={(v) => setBillingEntitlementsForm((f) => ({ ...f, can_generate_qr: v }))} />
                        <SelectField label="Dual-Phone?" value={billingEntitlementsForm.can_use_dual_phone_sessions} options={['', 'true', 'false']} onChange={(v) => setBillingEntitlementsForm((f) => ({ ...f, can_use_dual_phone_sessions: v }))} />
                        <SelectField label="Export Analytics?" value={billingEntitlementsForm.can_export_analytics} options={['', 'true', 'false']} onChange={(v) => setBillingEntitlementsForm((f) => ({ ...f, can_export_analytics: v }))} />
                        <SelectField label="Support Access?" value={billingEntitlementsForm.can_access_support} options={['', 'true', 'false']} onChange={(v) => setBillingEntitlementsForm((f) => ({ ...f, can_access_support: v }))} />
                        <SelectField label="Support Tier" value={billingEntitlementsForm.support_tier} options={['', 'basic', 'standard', 'priority', 'dedicated']} onChange={(v) => setBillingEntitlementsForm((f) => ({ ...f, support_tier: v }))} />
                        <SelectField label="Billing Status" value={billingEntitlementsForm.billing_status} options={['', 'active', 'suspended', 'pending', 'past_due', 'trialing', 'canceled']} onChange={(v) => setBillingEntitlementsForm((f) => ({ ...f, billing_status: v }))} />
                      </div>
                      <button
                        type="button"
                        onClick={handleOverrideEntitlements}
                        disabled={billingActionLoading}
                        className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 font-bold py-3 px-4 text-sm transition-all disabled:opacity-50"
                      >
                        Apply Overrides
                      </button>
                    </div>
                  )}
                </div>

                {/* Panel: Trial QR Provisioning */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 transition-colors duration-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenPanel(openPanel === 'provisioning' ? null : 'provisioning')}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-900/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300">
                        <QrCode size={18} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">Trial QR Provisioning</div>
                        <div className="text-xs text-slate-500 mt-0.5">Create single or batch table QR codes for trial tenants</div>
                      </div>
                    </div>
                    <ChevronDown
                      size={20}
                      className={`text-slate-400 transition-transform duration-200 ${openPanel === 'provisioning' ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {openPanel === 'provisioning' && (
                    <div className="px-5 pb-5 pt-1 border-t border-slate-800 space-y-4">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                        <div className="text-sm text-slate-300 leading-6">
                          During the trial period, tables and QR codes are provisioned here by Super Admin. The Restaurant Admin cannot self-serve QR registration unless explicitly entitled.
                        </div>
                        <div className="text-xs text-slate-500 max-w-xs shrink-0 lg:text-right">
                          Provisioned tables receive the canonical scan URL and an audit trail entry in restaurant_tables linked to your admin user.
                        </div>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Single Table</div>
                          <FormField label="Table Number / Label" value={billingProvisionForm.single} onChange={(v) => setBillingProvisionForm((f) => ({ ...f, single: v }))} placeholder="e.g. 12A, Bar-3" />
                          <button
                            type="button"
                            onClick={handleProvisionSingleTrialQr}
                            disabled={billingActionLoading}
                            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold py-2.5 transition-all disabled:opacity-50"
                          >
                            Provision 1 Trial QR
                          </button>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Batch Range</div>
                          <div className="grid grid-cols-2 gap-2">
                            <FormField label="Start" value={billingProvisionForm.start} onChange={(v) => setBillingProvisionForm((f) => ({ ...f, start: v }))} type="number" placeholder="1" />
                            <FormField label="End" value={billingProvisionForm.end} onChange={(v) => setBillingProvisionForm((f) => ({ ...f, end: v }))} type="number" placeholder="10" />
                          </div>
                          <FormField label="Label Pattern" value={billingProvisionForm.pattern} onChange={(v) => setBillingProvisionForm((f) => ({ ...f, pattern: v }))} placeholder="Table {n}" />
                          <button
                            type="button"
                            onClick={handleProvisionBatchTrialQrs}
                            disabled={billingActionLoading}
                            className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white text-sm font-bold py-2.5 transition-all disabled:opacity-50"
                          >
                            Provision Range
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Panel: Registered Tables / Print */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 transition-colors duration-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenPanel(openPanel === 'tables-print' ? null : 'tables-print')}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-900/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
                        <Printer size={18} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">Registered Tables / Print</div>
                        <div className="text-xs text-slate-500 mt-0.5">Print or download provisioned table QR codes</div>
                      </div>
                    </div>
                    <ChevronDown
                      size={20}
                      className={`text-slate-400 transition-transform duration-200 ${openPanel === 'tables-print' ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {openPanel === 'tables-print' && (
                    <div className="px-5 pb-5 pt-1 border-t border-slate-800 space-y-4">
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="text-sm text-slate-300">
                          Print or download any provisioned table QR directly from Super Admin. Paper size below applies to all print actions on this tenant.
                        </div>
                        <div className="flex flex-wrap items-center gap-2 justify-start">
                          <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Paper</span>
                            <select
                              value={saPrintPaperSize}
                              onChange={(event) => setSaPrintPaperSize(event.target.value)}
                              className="bg-transparent text-xs font-semibold text-slate-200 focus:outline-none"
                            >
                              <option value="letter">Letter</option>
                              <option value="a4">A4</option>
                              <option value="a5">A5</option>
                            </select>
                          </div>
                          {(() => {
                            const tables = Array.isArray(billingDetail?.tables) ? billingDetail.tables : [];
                            const hasTables = tables.length > 0;
                            return (
                              <>
                                <button
                                  type="button"
                                  onClick={handleSaPrintAllQr}
                                  disabled={!hasTables || saBulkPrinting}
                                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-3.5 py-2 transition-all flex items-center gap-1.5"
                                >
                                  <Printer size={14} />
                                  {saBulkPrinting ? 'Opening…' : hasTables ? `Print All (${tables.length})` : 'Print All'}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleSaDownloadAllPng}
                                  disabled={!hasTables || saBulkPrinting}
                                  className="rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-xs font-bold px-3.5 py-2 transition-all flex items-center gap-1.5"
                                >
                                  <Download size={14} />
                                  {saBulkPrinting ? 'Downloading…' : hasTables ? `Download All PNG (${tables.length})` : 'Download All PNG'}
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      {(() => {
                        const tables = Array.isArray(billingDetail?.tables) ? billingDetail.tables : [];
                        if (tables.length === 0) {
                          return (
                            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-4 py-10 text-center text-sm text-slate-500">
                              No tables have been provisioned for this tenant yet. Use the <span className="text-amber-300 font-semibold">Trial QR Provisioning</span> panel above to add the first table.
                            </div>
                          );
                        }
                        return (
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {tables.map((t) => (
                              <div
                                key={t.id}
                                className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between gap-3"
                              >
                                <div>
                                  <span className="text-xs font-bold tracking-wider text-violet-400 uppercase">Table Number</span>
                                  <h3 className="text-2xl font-black text-white mt-0.5">{t.table_number}</h3>
                                  <p className="text-[10px] text-slate-500 truncate mt-1" title={t.qr_code_url || ''}>
                                    {t.qr_code_url || '—'}
                                  </p>
                                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                    {t.provisioned_by_super_admin_id ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                        SA Provisioned
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-500/15 text-slate-300 border border-slate-500/30">
                                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                        RA Registered
                                      </span>
                                    )}
                                    {t.created_at && (
                                      <span className="text-[10px] text-slate-500 font-medium">
                                        {new Date(t.created_at).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaDownloadSingleQr(t)}
                                    disabled={saPrintingTableId === t.id || saBulkPrinting || saDeletingTableId === t.id}
                                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-xs font-bold py-2 transition-all flex items-center justify-center gap-1.5"
                                  >
                                    <Download size={13} />
                                    {saPrintingTableId === t.id ? '…' : 'PNG'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaPrintSingleQr(t)}
                                    disabled={saPrintingTableId === t.id || saBulkPrinting || saDeletingTableId === t.id}
                                    className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold py-2 transition-all flex items-center justify-center gap-1.5"
                                  >
                                    <Printer size={13} />
                                    {saPrintingTableId === t.id ? '…' : 'Print'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSaDeleteConfirmTable(t)}
                                    disabled={saDeletingTableId === t.id || saBulkPrinting || saPrintingTableId === t.id}
                                    title={`Delete ${String(t.table_number)} QR and table registration`}
                                    aria-label={`Delete table ${String(t.table_number)}`}
                                    className="shrink-0 rounded-xl border border-rose-900/60 bg-rose-950/30 hover:bg-rose-900/50 disabled:opacity-50 disabled:cursor-not-allowed text-rose-200 text-xs font-bold py-2 px-3 transition-all"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {saDeleteConfirmTable && (
                        <Modal
                          isOpen={Boolean(saDeleteConfirmTable)}
                          onClose={() => !saDeletingTableId && setSaDeleteConfirmTable(null)}
                          variant="danger"
                          size="md"
                          title={`Delete table ${String(saDeleteConfirmTable.table_number || saDeleteConfirmTable.id || '')}?`}
                          subtitle="This removes the table registration and its QR code from this tenant. Any existing scans will stop working. This action cannot be undone."
                          icon={<Trash2 size={28} className="text-rose-300" />}
                          actionLabel={saDeletingTableId ? 'Deleting…' : 'Yes, delete this table'}
                          actionVariant="danger"
                          actionLoading={Boolean(saDeletingTableId)}
                          actionDisabled={Boolean(saDeletingTableId)}
                          closeLabel={saDeletingTableId ? 'Deleting…' : 'Cancel'}
                          closeVariant="secondary"
                          closeDisabled={Boolean(saDeletingTableId)}
                          onAction={handleSaDeleteTable}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Panel: Invoices */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 transition-colors duration-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenPanel(openPanel === 'invoices' ? null : 'invoices')}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-900/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-500/15 border border-slate-700 flex items-center justify-center text-slate-300">
                        <FileText size={18} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">Invoices / Billing Events</div>
                        <div className="text-xs text-slate-500 mt-0.5">Local invoice mirror synced from Stripe webhooks</div>
                      </div>
                    </div>
                    <ChevronDown
                      size={20}
                      className={`text-slate-400 transition-transform duration-200 ${openPanel === 'invoices' ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {openPanel === 'invoices' && (
                    <div className="px-5 pb-5 pt-1 border-t border-slate-800">
                      <div className="max-h-80 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-xl">
                        {(billingDetail?.invoices || []).length === 0 && (
                          <div className="px-4 py-8 text-center text-sm text-slate-500">No invoices yet for this tenant.</div>
                        )}
                        {(billingDetail?.invoices || []).map((inv) => (
                          <div key={inv.invoice_id || inv.id} className="grid grid-cols-12 gap-2 items-center px-4 py-3 text-xs">
                            <div className="col-span-12 md:col-span-3 font-semibold text-white truncate">
                              {inv.provider_invoice_number || inv.invoice_number || inv.invoice_id || `#${inv.id || '—'}`}
                            </div>
                            <div className="col-span-4 md:col-span-2">
                              <StatusBadge status={inv.status || 'pending'} />
                            </div>
                            <div className="col-span-4 md:col-span-2 text-slate-300">
                              {inv.currency || 'USD'} {typeof inv.amount_cents === 'number' ? (inv.amount_cents / 100).toFixed(2) : inv.amount_total ?? '—'}
                            </div>
                            <div className="col-span-8 md:col-span-3 text-slate-500 truncate order-last md:order-none">
                              {inv.hosted_invoice_url ? (
                                <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:text-violet-200 underline">
                                  {inv.hosted_invoice_url.split('/')[2] || 'View invoice'}
                                </a>
                              ) : inv.invoice_pdf ? (
                                <a href={inv.invoice_pdf} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:text-violet-200 underline">Invoice PDF</a>
                              ) : (inv.stripe_subscription_id || '—')}
                            </div>
                            <div className="col-span-12 md:col-span-2 text-slate-500 md:text-right">
                              {inv.paid_at || inv.period_end || inv.created_at ? new Date(inv.paid_at || inv.period_end || inv.created_at).toLocaleDateString() : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setBillingDetail(null)}
                  className="rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-4 text-sm transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function createEmptyMetrics() {
  return {
    generated_at: null,
    overview: {
      total_restaurants: 0,
      active_restaurants: 0,
      pending_restaurants: 0,
      suspended_restaurants: 0,
      total_questions: 0,
      active_sessions_now: 0,
      active_tables_now: 0,
      live_restaurants_now: 0,
      dual_sessions_now: 0,
      sessions_window: 0,
      qr_scans_window: 0,
      question_views_window: 0
    },
    live_restaurants: [],
    context_mix: [],
    activity_timeline: [],
    recent_activity: []
  };
}

function normalizeMetricsPayload(payload) {
  return {
    ...createEmptyMetrics(),
    ...payload,
    overview: {
      ...createEmptyMetrics().overview,
      ...(payload?.overview || {})
    },
    live_restaurants: Array.isArray(payload?.live_restaurants) ? payload.live_restaurants : [],
    context_mix: Array.isArray(payload?.context_mix) ? payload.context_mix : [],
    activity_timeline: Array.isArray(payload?.activity_timeline) ? payload.activity_timeline : [],
    recent_activity: Array.isArray(payload?.recent_activity) ? payload.recent_activity : []
  };
}

function MetricCard({ label, value, helper, accent }) {
  const accentClasses = accent === 'cyan'
    ? 'border-cyan-200 dark:border-cyan-500/20 from-cyan-50 dark:from-cyan-500/15 to-white dark:to-slate-950/80 text-cyan-700 dark:text-white'
    : accent === 'violet'
      ? 'border-violet-200 dark:border-violet-500/20 from-violet-50 dark:from-violet-500/15 to-white dark:to-slate-950/80 text-violet-700 dark:text-white'
      : accent === 'emerald'
        ? 'border-emerald-200 dark:border-emerald-500/20 from-emerald-50 dark:from-emerald-500/15 to-white dark:to-slate-950/80 text-emerald-700 dark:text-white'
        : 'border-amber-200 dark:border-amber-500/20 from-amber-50 dark:from-amber-500/15 to-white dark:to-slate-950/80 text-amber-700 dark:text-white';

  return (
    <div className={`rounded-3xl border bg-gradient-to-br ${accentClasses} px-5 py-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)] dark:shadow-lg transition-colors duration-300`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-slate-600 dark:text-slate-400">{label}</div>
      <div className="mt-3 text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">{value}</div>
      <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{helper}</div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span>{label}</span>
    </span>
  );
}

function MetricsTimeline({ timeline }) {
  const maxValue = timeline.reduce((max, item) => (
    Math.max(max, item.qr_scans || 0, item.sessions_started || 0, item.question_views || 0)
  ), 1);

  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="grid gap-2 items-end h-64 min-w-full"
        style={{ gridTemplateColumns: `repeat(${Math.max(timeline.length, 1)}, minmax(34px, 1fr))` }}
      >
        {timeline.map((item) => (
          <div key={item.hour_label} className="flex flex-col items-center justify-end gap-2 min-h-0">
            <div className="flex items-end gap-1 h-48">
              <span
                className="w-2 rounded-full bg-cyan-400/90"
                style={{ height: `${Math.max((item.qr_scans / maxValue) * 100, item.qr_scans ? 8 : 0)}%` }}
              />
              <span
                className="w-2 rounded-full bg-violet-400/90"
                style={{ height: `${Math.max((item.sessions_started / maxValue) * 100, item.sessions_started ? 8 : 0)}%` }}
              />
              <span
                className="w-2 rounded-full bg-amber-400/90"
                style={{ height: `${Math.max((item.question_views / maxValue) * 100, item.question_views ? 8 : 0)}%` }}
              />
            </div>
            <div className="text-[10px] text-slate-500 rotate-[-35deg] origin-top-left whitespace-nowrap">{item.hour_label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContextMixRow({ label, count, total, rangeLabel }) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/70 p-4 shadow-[0_2px_10px_rgba(15,23,42,0.03)] dark:shadow-none transition-colors duration-300">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</span>
        <span className="text-xs font-bold text-slate-600 dark:text-slate-400 tabular-nums">{count} sessions</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-violet-500 to-amber-500 dark:from-cyan-400 dark:via-violet-400 dark:to-amber-400"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-500">{percentage}% of the last {rangeLabel}</div>
    </div>
  );
}

function LiveVenueCard({ restaurant }) {
  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 p-4 shadow-[0_4px_16px_rgba(15,23,42,0.04)] dark:shadow-lg transition-colors duration-300">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h4 className="text-base font-bold text-slate-900 dark:text-white">{restaurant.name}</h4>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">/{restaurant.slug}</div>
        </div>
        <div className="rounded-2xl border border-cyan-200 dark:border-cyan-500/20 bg-cyan-50 dark:bg-cyan-500/10 px-3 py-2 text-right shadow-sm dark:shadow-none">
          <div className="text-lg font-extrabold text-cyan-700 dark:text-cyan-200 tabular-nums">{restaurant.active_sessions}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-600/80 dark:text-cyan-300/80">Live Sessions</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <MetricMini label="Tables" value={restaurant.active_tables} />
        <MetricMini label="Last Activity" value={formatRelativeTime(restaurant.last_activity_at)} />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Location</div>
        <div className="mt-2 text-sm text-slate-300">{restaurant.address || 'Address not available yet'}</div>
        <div className="mt-2 text-xs text-slate-500">
          {restaurant.latitude && restaurant.longitude
            ? `${Number(restaurant.latitude).toFixed(4)}, ${Number(restaurant.longitude).toFixed(4)}`
            : 'Coordinates pending'}
        </div>
      </div>
    </div>
  );
}

function LiveVenueMap({ restaurants }) {
  const mappableRestaurants = restaurants.filter(
    (restaurant) => restaurant.latitude != null && restaurant.longitude != null
  );

  if (mappableRestaurants.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-10 text-center text-sm text-slate-500">
        No live restaurant coordinates available for the map yet.
      </div>
    );
  }

  const latitudes = mappableRestaurants.map((restaurant) => Number(restaurant.latitude));
  const longitudes = mappableRestaurants.map((restaurant) => Number(restaurant.longitude));
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg">
      <div className="mb-4">
        <div className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">Live Activity Map</div>
        <div className="text-xs text-slate-500 mt-1">Markers use the real saved tenant coordinates of restaurants active right now.</div>
      </div>

      <div className="relative h-[360px] overflow-hidden rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.1),_transparent_35%),linear-gradient(180deg,rgba(15,23,42,1),rgba(2,6,23,1))]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:40px_40px]" />
        {mappableRestaurants.map((restaurant) => {
          const top = 10 + ((maxLat - Number(restaurant.latitude)) / latRange) * 80;
          const left = 10 + ((Number(restaurant.longitude) - minLng) / lngRange) * 80;

          return (
            <div
              key={restaurant.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ top: `${top}%`, left: `${left}%` }}
            >
              <div className="relative group">
                <div className="absolute inset-0 rounded-full bg-cyan-400/30 blur-md animate-pulse" />
                <div className="relative flex h-4 w-4 items-center justify-center rounded-full border border-white/40 bg-cyan-400 shadow-lg shadow-cyan-500/30" />
                <div className="pointer-events-none absolute left-1/2 top-5 z-10 hidden w-44 -translate-x-1/2 rounded-2xl border border-slate-700 bg-slate-950/95 px-3 py-2 text-left shadow-2xl group-hover:block">
                  <div className="text-xs font-bold text-white">{restaurant.name}</div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {restaurant.active_sessions} sessions · {restaurant.active_tables} tables
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricMini({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function RecentActivityRow({ event }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 transition-colors duration-300 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-200">{formatMetricEventLabel(event.event_type)}</div>
          <div className="text-xs text-slate-500 mt-1">
            {event.restaurant_name || 'Unknown restaurant'}
            {event.table_token ? ` · Table ${event.table_token}` : ''}
          </div>
        </div>
        <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
          {formatRelativeTime(event.timestamp)}
        </span>
      </div>
    </div>
  );
}

function formatMetricEventLabel(eventType) {
  const map = {
    qr_scan_validated: 'QR Scan Validated',
    qr_scan_rejected: 'QR Scan Rejected',
    session_created: 'Session Started',
    question_viewed: 'Question Viewed',
    session_paired: 'Dual Session Paired',
    context_changed: 'Context Changed'
  };

  return map[eventType] || eventType.replace(/_/g, ' ');
}

function formatRelativeTime(value) {
  if (!value) {
    return 'Just now';
  }

  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) return 'Now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.round(diffHours / 24)}d ago`;
}

function formatMetricsTimestamp(value) {
  if (!value) {
    return 'just now';
  }

  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function Banner({ tone, message }) {
  const styles = tone === 'error'
    ? 'border-rose-500/50 bg-rose-500/20 text-rose-200'
    : 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200';

  return <div className={`rounded-xl border px-3 py-2 text-xs mb-4 ${styles}`}>{message}</div>;
}

function humanizeStatus(status) {
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
    incomplete_expired: 'Expired'
  };
  if (map[key]) return map[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatusBadge({ status, plan }) {
  const effectiveStatus = String(status || 'pending').toLowerCase().trim();
  let icon = null;
  let base = '';
  if (effectiveStatus === 'active') {
    icon = <Check className="w-3 h-3 shrink-0" />;
    base = 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30';
  } else if (effectiveStatus === 'trialing' || (plan === 'trial' && effectiveStatus === 'active')) {
    icon = <Clock className="w-3 h-3 shrink-0" />;
    base = 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30';
  } else if (effectiveStatus === 'pending') {
    icon = <Clock className="w-3 h-3 shrink-0" />;
    base = 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30';
  } else if (effectiveStatus === 'past_due') {
    icon = <AlertTriangle className="w-3 h-3 shrink-0" />;
    base = 'bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30';
  } else if (effectiveStatus === 'canceled' || effectiveStatus === 'cancel_at_period_end') {
    icon = <XCircle className="w-3 h-3 shrink-0" />;
    base = 'bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30';
  } else if (effectiveStatus === 'suspended' || effectiveStatus === 'unpaid') {
    icon = <Ban className="w-3 h-3 shrink-0" />;
    base = 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30';
  } else {
    icon = <AlertCircle className="w-3 h-3 shrink-0" />;
    base = 'bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:border-violet-500/30';
  }
  const label = plan === 'trial' && effectiveStatus === 'active' ? 'Trialing' : humanizeStatus(effectiveStatus);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold uppercase tracking-wider ${base} transition-colors duration-200`}
    >
      {icon}
      {label}
    </span>
  );
}

function PlanBadge({ plan }) {
  const configs = {
    trial: { label: 'Trial', icon: Clock, className: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30' },
    starter: { label: 'Starter', icon: Zap, className: 'bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30' },
    premium: { label: 'Premium', icon: Crown, className: 'bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30' },
    enterprise: { label: 'Enterprise', icon: Rocket, className: 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30' },
    free: { label: 'Free', icon: Sparkles, className: 'bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30' },
    pro: { label: 'Pro', icon: Crown, className: 'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30' }
  };
  const cfg = configs[plan] || configs.trial;
  const IconComp = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-extrabold uppercase tracking-[0.18em] ${cfg.className} transition-colors duration-200`}
    >
      <IconComp className="w-3 h-3 shrink-0" />
      {cfg.label}
    </span>
  );
}

function EntitlementChip({ label, enabled, value }) {
  const cls = enabled
    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-200 dark:border-emerald-500/25'
    : 'bg-slate-50 text-slate-600 border border-slate-200 dark:bg-slate-500/12 dark:text-slate-400 dark:border-slate-500/25';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider ${cls} transition-colors duration-200`}>
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-slate-400 dark:bg-slate-500'}`} />
      {label}{value ? ` · ${value}` : ''}
    </span>
  );
}

function BillingStat({ label, value, accent = 'slate' }) {
  const accentMap = {
    slate: 'from-slate-50 to-slate-100 dark:from-slate-500/20 dark:to-slate-400/10 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100',
    cyan: 'from-cyan-50 to-cyan-100 dark:from-cyan-500/20 dark:to-cyan-400/10 border-cyan-200 dark:border-cyan-500/30 text-cyan-800 dark:text-cyan-100',
    violet: 'from-violet-50 to-violet-100 dark:from-violet-500/20 dark:to-violet-400/10 border-violet-200 dark:border-violet-500/30 text-violet-800 dark:text-violet-100',
    emerald: 'from-emerald-50 to-emerald-100 dark:from-emerald-500/20 dark:to-emerald-400/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-100',
    amber: 'from-amber-50 to-amber-100 dark:from-amber-500/20 dark:to-amber-400/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-100',
    rose: 'from-rose-50 to-rose-100 dark:from-rose-500/20 dark:to-rose-400/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-100'
  };
  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${accentMap[accent] || accentMap.slate} px-3 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.03)] dark:shadow-none transition-colors duration-300`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600 dark:text-white/70">{label}</div>
      <div className="text-xl font-extrabold mt-1 leading-none text-slate-900 dark:inherit tabular-nums">{value}</div>
    </div>
  );
}

function SourcePill({ source }) {
  const s = String(source || '').toLowerCase();
  const map = {
    env: { label: 'Source: Env', className: 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/40' },
    db: { label: 'Source: Platform DB', className: 'bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:border-violet-500/40' },
    default: { label: 'Source: Default', className: 'bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-600/60' }
  };
  const cfg = map[s] || map.default;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] ${cfg.className} transition-colors duration-200`}
      style={{ backgroundImage: 'none', WebkitBackgroundClip: 'border-box', backgroundClip: 'border-box', WebkitTextFillColor: 'currentcolor' }}
    >
      {cfg.label}
    </span>
  );
}

/**
 * Masked text/password input with explicit one-by-one reveal.
 * Never shows plaintext by default — user must click the eye (Reveal) button
 * to POST to the single-field reveal endpoint. Plaintext auto-remasks on blur
 * or after 30 seconds. Copy button copies whatever is currently shown
 * (so masked by default, plaintext only if the user explicitly revealed).
 */
function MaskedInputField({
  label,
  value,
  onChange,
  placeholder,
  source,
  fieldKey, // one of 'stripe_publishable_key' | 'stripe_secret_key' | 'stripe_webhook_secret'
  autoComplete = 'new-password',
  apiFetch,
  onBanner,
  allowTypeTextWhenEditing = true
}) {
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [copyState, setCopyState] = useState('copy'); // 'copy' | 'copied'
  const REMASK_MS = 30000;

  useEffect(() => {
    if (!revealed) return undefined;
    const t = setTimeout(() => setRevealed(false), REMASK_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  const maskedOnly = Boolean(value) && /\*{4,}/.test(String(value));
  const inputType = revealed ? 'text' : 'password';

  const copyCurrent = async () => {
    try {
      await navigator.clipboard?.writeText(String(value || ''));
      setCopyState('copied');
      setTimeout(() => setCopyState('copy'), 1600);
    } catch (_) {
      onBanner?.({ kind: 'error', message: 'Clipboard unavailable. Copy manually.' });
    }
  };

  const triggerReveal = async () => {
    if (revealed) { setRevealed(false); return; }
    if (!maskedOnly) {
      // Value is already a fresh plaintext being edited — just show/hide.
      setRevealed(true);
      return;
    }
    // Only when showing the backend's masked token do we hit the reveal endpoint.
    try {
      setRevealing(true);
      const res = await apiFetch(`/admin/platform/payment-gateway/reveal-field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: fieldKey })
      });
      if (!res.ok) throw new Error('Unable to reveal field');
      const data = await res.json();
      const plaintext = typeof data?.value === 'string' ? data.value : '';
      setRevealing(false);
      if (plaintext) {
        // Put the plaintext into the form value ONLY in the reveal state;
        // when remasking occurs, we re-apply the original masked string
        // via onChange below.
        onChange?.(plaintext);
        setRevealed(true);
        onBanner?.({
          kind: 'success',
          message: `Revealed ${label}. Plaintext will re-mask after 30s or when you focus away.`
        });
      } else {
        onBanner?.({ kind: 'warn', message: `${label} is not configured on this environment.` });
      }
    } catch (err) {
      setRevealing(false);
      const msg = err?.message || 'Reveal failed';
      if (/too many reveal/i.test(msg)) onBanner?.({ kind: 'warn', message: 'Too many reveals. Wait 60 seconds.' });
      else onBanner?.({ kind: 'error', message: `Could not reveal ${label}. ${msg}` });
    }
  };

  const handleBlur = () => {
    // On blur: if the value was plaintext (from a reveal) and hasn't been edited into
    // a NEW valid plaintext (presence of * or length change), revert to masked token.
    // Simplest UX: always re-mask on blur. The user must re-reveal to see again.
    setRevealed(false);
  };

  return (
    <div className="md:col-span-1">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">{label}</label>
        {source && <SourcePill source={source} />}
      </div>
      <div className="relative">
        <input
          type={allowTypeTextWhenEditing && !maskedOnly ? 'text' : inputType}
          autoComplete={autoComplete}
          value={value || ''}
          onChange={(e) => {
            // Any user keystroke counts as "editing a new value" so we don't
            // re-use the reveal endpoint round-trip again for this value.
            onChange?.(e.target.value);
          }}
          onBlur={handleBlur}
          placeholder={placeholder}
          spellCheck={false}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-950/80 pr-[7.5rem] px-4 py-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 dark:focus:border-violet-500/60 focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-2 dark:focus:ring-violet-500/20 font-mono shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors duration-200"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pr-1">
          <button
            type="button"
            title={revealed ? 'Hide' : 'Reveal (audited)'}
            onClick={triggerReveal}
            disabled={revealing}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 text-slate-700 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800/80 disabled:opacity-50 transition-colors duration-200"
            style={{ backgroundImage: 'none', WebkitBackgroundClip: 'border-box', backgroundClip: 'border-box', WebkitTextFillColor: 'currentcolor' }}
          >
            {revealing
              ? <span className="text-[10px] font-bold">…</span>
              : revealed
                ? <span aria-hidden className="text-sm leading-none">🙈</span>
                : <span aria-hidden className="text-sm leading-none">👁</span>}
          </button>
          <button
            type="button"
            title={copyState === 'copied' ? 'Copied!' : 'Copy (masked unless revealed)'}
            onClick={copyCurrent}
            className={`inline-flex items-center justify-center h-9 px-2.5 rounded-lg border text-[10px] font-bold uppercase tracking-[0.18em] transition-colors duration-200 ${
              copyState === 'copied'
                ? 'border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 text-slate-700 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800/80'
            }`}
            style={{ backgroundImage: 'none', WebkitBackgroundClip: 'border-box', backgroundClip: 'border-box', WebkitTextFillColor: 'currentcolor' }}
          >
            {copyState === 'copied' ? 'OK' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectionCountBar({ label, total, selected, onSelectAll, onClear, size = 'sm' }) {
  if (total === null || total === undefined) return null;
  const isFull = selected > 0 && selected === total;
  const isPartial = selected > 0 && selected < total;
  const sizeClasses = size === 'xs'
    ? 'gap-1.5 text-[11px]'
    : 'gap-2 text-xs';
  return (
    <div className={`flex items-center flex-wrap ${sizeClasses}`}>
      <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-white/70 font-semibold tracking-wide whitespace-nowrap">
        <span className={`inline-block w-2 h-2 rounded-full ${isFull ? 'bg-indigo-500 dark:bg-violet-400' : isPartial ? 'bg-amber-500 dark:bg-amber-400' : 'bg-slate-400 dark:bg-slate-600'}`} />
        <span>
          {selected}/{total} selected{label ? ` · ${label}` : ''}
        </span>
      </span>
      <button
        type="button"
        onClick={onSelectAll}
        disabled={!total}
        className="inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.15em] hover:bg-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-40 transition-colors duration-200"
        style={{ backgroundImage: 'none', WebkitBackgroundClip: 'border-box', backgroundClip: 'border-box', WebkitTextFillColor: 'currentcolor' }}
      >
        Select all
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={!selected}
        className="inline-flex items-center rounded-lg border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.15em] hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/80 disabled:opacity-40 transition-colors duration-200"
        style={{ backgroundImage: 'none', WebkitBackgroundClip: 'border-box', backgroundClip: 'border-box', WebkitTextFillColor: 'currentcolor' }}
      >
        Clear
      </button>
    </div>
  );
}

function formatPlanLabel(plan) {
  const map = { trial: 'Trial', starter: 'Starter', premium: 'Premium', enterprise: 'Enterprise', free: 'Free', pro: 'Pro' };
  return map[plan] || 'Trial';
}

function FormField({ label, placeholder, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10 transition-all text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      />
    </div>
  );
}

function TextAreaField({ label, placeholder, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10 transition-all text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange, formatter = (option) => option }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10 transition-all text-sm"
      >
        {options.map((option) => (
          <option key={`${label}-${option}`} value={option}>
            {formatter(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReadOnlyBlock({ value }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-3 text-xs text-slate-700 dark:text-slate-300 break-all shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-none">
      {value}
    </div>
  );
}

function QuestionStatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 px-3 py-3 text-center shadow-[0_2px_8px_rgba(15,23,42,0.03)] dark:shadow-none transition-colors duration-300">
      <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function QuestionChip({ label, tone = 'default', compact = false }) {
  const classes = tone === 'accent'
    ? 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200'
    : tone === 'easy'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
      : tone === 'medium'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
        : tone === 'deep'
          ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:text-fuchsia-200'
          : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300';

  const size = compact
    ? 'px-2 py-0.5 text-[9px] tracking-[0.14em] whitespace-nowrap'
    : 'px-2.5 py-1 text-[11px] tracking-wider';

  return (
    <span className={`inline-flex items-center rounded-full border ${size} uppercase ${classes} transition-colors duration-200`}>
      {label}
    </span>
  );
}

function FilterGroup({ label, options, selected, onSelect, formatter = (value) => value }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option === selected;
          return (
            <button
              key={`${label}-${option}`}
              type="button"
              onClick={() => onSelect(option)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                active
                  ? 'bg-indigo-600 text-white shadow-[0_4px_12px_rgba(79,70,229,0.2)] dark:bg-purple-500 dark:shadow-lg dark:shadow-purple-500/20'
                  : 'bg-slate-100 text-slate-700 border border-slate-200 hover:border-slate-400 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800 dark:hover:border-slate-600'
              }`}
            >
              {formatter(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DifficultyStatCard({ label, value, tone }) {
  return (
    <div className={`rounded-xl border px-3 py-3 text-center ${getDifficultySectionClasses(tone)}`}>
      <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-slate-700 dark:text-white/75 mt-1">{label}</div>
    </div>
  );
}

function ContextPill({ label }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${getContextPillClasses(label)}`}>
      {label}
    </span>
  );
}

function formatQuestionType(value) {
  if (value === 'All') {
    return 'All';
  }
  if (!value) {
    return 'Open Ended';
  }

  return value
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatQuestionTypeCompact(value) {
  if (value === 'All') {
    return 'All';
  }
  const normalized = String(value || '').toLowerCase();
  if (!normalized || normalized === 'open-ended' || normalized === 'open_ended' || normalized === 'open') {
    return 'Open';
  }
  if (normalized.includes('multiple')) {
    return 'MCQ';
  }
  if (normalized === 'would-you-rather' || normalized === 'would_you_rather' || normalized.includes('rather')) {
    return 'WYR';
  }
  if (normalized === 'this-or-that' || normalized === 'this_or_that' || normalized.includes('this')) {
    return 'TOT';
  }
  return formatQuestionType(value).slice(0, 6);
}

function formatDifficulty(value) {
  if (value === 'All') {
    return 'All';
  }
  const normalized = normalizeDifficulty(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeDifficulty(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'easy' || normalized === 'medium' || normalized === 'deep') {
    return normalized;
  }
  return 'easy';
}

function getOptionsPreview(options) {
  if (!options) {
    return '';
  }

  if (Array.isArray(options)) {
    return options.join(' | ');
  }

  if (typeof options === 'string') {
    return options;
  }

  return '';
}

function serializeQuestionOptions(options) {
  if (!options) {
    return '';
  }

  if (typeof options === 'string') {
    return options;
  }

  if (Array.isArray(options) || typeof options === 'object') {
    return JSON.stringify(options);
  }

  return String(options);
}

function formatOptionsForPrintableCsv(options) {
  if (!options) {
    return '';
  }

  if (typeof options === 'string') {
    const trimmed = options.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        return formatOptionsForPrintableCsv(parsed);
      } catch {
        return options;
      }
    }

    return options;
  }

  if (Array.isArray(options)) {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    return options
      .map((value, index) => {
        const label = labels[index] || String(index + 1);
        const text = String(value ?? '').trim();
        return { label, text };
      })
      .filter((entry) => entry.text.length > 0)
      .map((entry) => `${entry.label}: ${entry.text}`)
      .join(' | ');
  }

  if (typeof options === 'object') {
    const entries = Object.entries(options);
    if (entries.length === 0) {
      return '';
    }
    return entries
      .map(([key, value]) => `${String(key).toUpperCase()}: ${String(value ?? '').trim()}`)
      .join(' | ');
  }

  return String(options);
}

function toCsvLine(values) {
  return values
    .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
    .join(',');
}

function downloadTextFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const DIFFICULTY_ORDER = ['easy', 'medium', 'deep'];
const DEFAULT_SECTION_VISIBLE_COUNT = 4;

function getContextRank(context) {
  const order = {
    Exploring: 0,
    Established: 1,
    Mature: 2,
    Unassigned: 3
  };

  return order[context] ?? 99;
}

function getQuestionTypeRank(type) {
  const order = {
    'open-ended': 0,
    'multiple-choice': 1
  };

  return order[type] ?? 99;
}

function getContextSectionClasses(context) {
  if (context === 'Exploring') {
    return 'border-cyan-200 dark:border-cyan-500/20 bg-gradient-to-br from-cyan-50 via-white to-white dark:from-cyan-500/10 dark:via-slate-950 dark:to-slate-950';
  }
  if (context === 'Established') {
    return 'border-violet-200 dark:border-violet-500/20 bg-gradient-to-br from-violet-50 via-white to-white dark:from-violet-500/10 dark:via-slate-950 dark:to-slate-950';
  }
  if (context === 'Mature') {
    return 'border-amber-200 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 via-white to-white dark:from-amber-500/10 dark:via-slate-950 dark:to-slate-950';
  }
  return 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950';
}

function getContextPillClasses(context) {
  if (context === 'Exploring') {
    return 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200';
  }
  if (context === 'Established') {
    return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200';
  }
  if (context === 'Mature') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300';
}

function getDifficultySectionClasses(difficulty) {
  if (difficulty === 'easy') {
    return 'border-emerald-200 dark:border-emerald-500/20 bg-gradient-to-b from-emerald-50 to-white dark:from-emerald-500/10 dark:to-slate-950';
  }
  if (difficulty === 'medium') {
    return 'border-amber-200 dark:border-amber-500/20 bg-gradient-to-b from-amber-50 to-white dark:from-amber-500/10 dark:to-slate-950';
  }
  if (difficulty === 'deep') {
    return 'border-fuchsia-200 dark:border-fuchsia-500/20 bg-gradient-to-b from-fuchsia-50 to-white dark:from-fuchsia-500/10 dark:to-slate-950';
  }
  return 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950';
}
