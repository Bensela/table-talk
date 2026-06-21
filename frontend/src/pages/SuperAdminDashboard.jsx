import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '../api';
import { useAdminAuth, getAdminHeaders } from '../hooks/useAdminAuth';
import MapDisplay from '../components/MapDisplay';

export default function SuperAdminDashboard() {
  const { checking, logout } = useAdminAuth();
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
      const [tenantsRes, questionsRes, metricsRes] = await Promise.all([
        apiFetch('/admin/tenants', { headers: getAdminHeaders() }),
        apiFetch('/admin/questions', { headers: getAdminHeaders() }),
        apiFetch(`/admin/metrics/overview?range=${encodeURIComponent(metricsRange)}`, { headers: getAdminHeaders() })
      ]);

      const tenantsData = await tenantsRes.json();
      const questionsData = await questionsRes.json();
      const metricsData = await metricsRes.json();

      setTenants(Array.isArray(tenantsData) ? tenantsData : []);
      setGlobalQuestions(Array.isArray(questionsData) ? questionsData : []);
      setMetrics(normalizeMetricsPayload(metricsData));
    } catch (err) {
      console.error(err);
    } finally {
      setPageLoading(false);
    }
  };

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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      <header className="flex justify-between items-center mb-10 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Super Admin Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Manage restaurant onboarding, subscriptions, billing, and global questions</p>
        </div>
        <button
          onClick={() => logout()}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-4 py-2 rounded-xl transition-all"
        >
          Sign Out
        </button>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        <div className="xl:col-span-3 space-y-8">
          <section className="relative overflow-hidden rounded-[32px] border border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(168,85,247,0.18),_transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-6 shadow-2xl">
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:28px_28px] opacity-30" />
            <div className="relative z-10">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-200 mb-3">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    Live Platform Metrics
                  </div>
                  <h2 className="text-2xl font-extrabold tracking-tight text-white">Real-Time Usage Command Center</h2>
                  <p className="text-sm text-slate-400 mt-2 max-w-2xl">
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
                        className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] transition-all ${
                          metricsRange === option
                            ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20'
                            : 'border border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500'
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
                      className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-emerald-200 hover:bg-emerald-500/20"
                    >
                      Export CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => exportMetrics('json')}
                      className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-violet-200 hover:bg-violet-500/20"
                    >
                      Export JSON
                    </button>
                  </div>
                  <div className="text-xs text-slate-500">
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
                <div className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">{metricsRange} Activity Pulse</h3>
                      <p className="text-xs text-slate-500 mt-1">QR validations, session starts, and question views across the selected reporting window.</p>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-500">
                      <LegendDot color="bg-cyan-400" label="Scans" />
                      <LegendDot color="bg-violet-400" label="Sessions" />
                      <LegendDot color="bg-amber-400" label="Views" />
                    </div>
                  </div>
                  <MetricsTimeline timeline={metrics.activity_timeline} />
                </div>

                <div className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5">
                  <div className="mb-4">
                      <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">Context Mix · {metricsRange}</h3>
                      <p className="text-xs text-slate-500 mt-1">Relationship contexts currently driving usage in the selected range.</p>
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
                <div className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">Live Venue Feed</h3>
                      <p className="text-xs text-slate-500 mt-1">Where the app is active right now based on recent tenant session activity.</p>
                    </div>
                    <div className="text-xs text-slate-500">
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
                      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-10 text-center text-sm text-slate-500">
                        No restaurants are live at this moment.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">Recent Platform Events</h3>
                    <p className="text-xs text-slate-500 mt-1">Latest validated scans, session events, and engagement signals.</p>
                  </div>
                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {metrics.recent_activity.length > 0 ? (
                      metrics.recent_activity.map((event, index) => (
                        <RecentActivityRow key={`${event.event_type}-${event.timestamp}-${index}`} event={event} />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-sm text-slate-500">
                        No recent activity available.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold">Registered Restaurants</h2>
                <p className="text-xs text-slate-400 mt-1">Pending restaurants are waiting for the invite link to be completed.</p>
              </div>
              {pageLoading && <span className="text-xs text-slate-500">Refreshing…</span>}
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
              <div className="col-span-1">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <div className="space-y-2">
              {tenants.map((tenant) => (
                <div key={tenant.id}>
                  <div
                    className={`grid grid-cols-12 gap-2 items-center px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                      expandedId === tenant.id
                        ? 'bg-slate-800 border-purple-500/40'
                        : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                    }`}
                    onClick={() => setExpandedId(expandedId === tenant.id ? null : tenant.id)}
                  >
                    <div className="col-span-2 font-semibold text-white truncate">{tenant.name}</div>
                    <div className="col-span-2 text-sm text-slate-400 truncate">{tenant.manager_name || 'Awaiting onboarding'}</div>
                    <div className="col-span-2 text-xs text-slate-500 truncate">
                      {tenant.contact_email ? <span className="text-slate-300">{tenant.contact_email}</span> : '—'}
                      {tenant.contact_phone && <span className="ml-1 text-slate-500">· {tenant.contact_phone}</span>}
                    </div>
                    <div className="col-span-3 text-xs text-slate-500 truncate">{tenant.address || 'No address yet'}</div>
                    <div className="col-span-1">
                      <StatusBadge status={tenant.billing_status} />
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-2">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleBilling(tenant);
                        }}
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg border transition-all ${
                          tenant.billing_status === 'active'
                            ? 'border-rose-500/30 hover:bg-rose-500/10 text-rose-400'
                            : 'border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-400'
                        }`}
                      >
                        {tenant.billing_status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(tenant);
                        }}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-600 hover:border-purple-500 hover:bg-purple-500/10 text-slate-400 hover:text-purple-300 transition-all"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          handlePermanentDeleteTenant(tenant);
                        }}
                        disabled={tenant.slug === 'default' || tenantActionLoading}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-300 transition-all disabled:opacity-40"
                      >
                        Delete
                      </button>
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
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold">Global Question Library</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Structured by <span className="text-slate-300">Context → Question Type → Difficulty</span>. CSV headers supported: <span className="text-slate-300">question_text, answer_text, category, sub_category, difficulty, question_type, context, options, active, sort_order</span>
                </p>
              </div>
              <div className="text-xs text-slate-500">{globalQuestions.length} questions loaded</div>
            </div>

            {questionError && <Banner tone="error" message={questionError} />}
            {questionSuccess && <Banner tone="success" message={questionSuccess} />}

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 mb-6">
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">CSV File</label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setCsvFile(event.target.files?.[0] || null)}
                    className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-xl file:border-0 file:bg-purple-500 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-purple-600"
                  />
                  <div className="text-xs text-slate-500 mt-2">
                    {csvFile ? `Selected: ${csvFile.name}` : 'Upload a CSV exported from Excel, Google Sheets, or another spreadsheet tool.'}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={replaceQuestions}
                    onChange={(event) => setReplaceQuestions(event.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-purple-500 focus:ring-purple-500"
                  />
                  Replace existing global questions
                </label>
                <button
                  type="button"
                  onClick={handleCsvImport}
                  disabled={questionLoading}
                  className="rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {questionLoading ? 'Uploading...' : 'Upload CSV'}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 mb-6 space-y-4">
              <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Search Questions</label>
                  <input
                    type="text"
                    value={questionSearch}
                    onChange={(event) => setQuestionSearch(event.target.value)}
                    placeholder="Search question text, follow-up, options, context, type, or difficulty"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-all text-sm"
                  />
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

              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-white">Question Actions</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {selectedQuestionIds.length > 0
                      ? `${selectedQuestionIds.length} selected for bulk delete`
                      : `${groupedQuestionData.filteredQuestions.length} question(s) match the current filters.`}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={exportQuestionsCsv}
                    disabled={groupedQuestionData.filteredQuestions.length === 0}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedQuestionIds([])}
                    disabled={selectedQuestionIds.length === 0}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:border-slate-500 disabled:opacity-40"
                  >
                    Clear Selection
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDeleteQuestions}
                    disabled={selectedQuestionIds.length === 0 || questionActionLoading}
                    className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
                  >
                    {questionActionLoading ? 'Working...' : 'Bulk Delete'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {groupedQuestionData.contexts.map((contextGroup) => (
                <div
                  key={contextGroup.label}
                  className={`rounded-3xl border overflow-hidden ${getContextSectionClasses(contextGroup.label)}`}
                >
                  <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-lg font-bold text-white">{contextGroup.label}</div>
                      <div className="text-xs text-slate-200/80 mt-1">
                        {contextGroup.types.length} question types · {contextGroup.questionCount} questions
                      </div>
                    </div>
                    <ContextPill label={contextGroup.label} />
                  </div>

                  <div className="p-4 space-y-4 bg-slate-950/30">
                    {contextGroup.types.map((typeGroup) => (
                      <div key={`${contextGroup.label}-${typeGroup.label}`} className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-bold text-slate-100">{formatQuestionType(typeGroup.label)}</div>
                            <div className="text-xs text-slate-500 mt-1">{typeGroup.questionCount} questions</div>
                          </div>
                          <QuestionChip label={formatQuestionType(typeGroup.label)} tone="accent" />
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
                                className={`rounded-2xl border min-h-[180px] ${getDifficultySectionClasses(difficulty)}`}
                              >
                                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                                  <div className="text-sm font-semibold text-white">{formatDifficulty(difficulty)}</div>
                                  <span className="text-xs text-white/80">{difficultyGroup ? difficultyGroup.questions.length : 0}</span>
                                </div>

                                <div className="p-3 space-y-3">
                                  {difficultyGroup ? (
                                    visibleQuestions.map((question) => {
                                      const questionIndex = globalQuestions.findIndex(
                                        (item) => item.question_id === question.question_id
                                      );
                                      const isExpanded = Boolean(expandedQuestions[question.question_id]);
                                      const isSelected = selectedQuestionIds.includes(question.question_id);

                                      return (
                                        <div
                                          key={question.question_id}
                                          className={`rounded-xl border px-3 py-3 shadow-sm transition-all ${
                                            isSelected
                                              ? 'border-purple-500/40 bg-purple-500/10'
                                              : 'border-slate-800 bg-slate-950/90'
                                          }`}
                                        >
                                          <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-start gap-3 min-w-0 flex-1">
                                              <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleQuestionSelection(question.question_id)}
                                                className="mt-1 rounded border-slate-700 bg-slate-900 text-purple-500 focus:ring-purple-500"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => toggleQuestionExpanded(question.question_id)}
                                                className="min-w-0 flex-1 text-left"
                                              >
                                                <div className="text-sm font-medium text-slate-100 leading-6 line-clamp-2">
                                                  {question.question_text}
                                                </div>
                                              </button>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                              <button
                                                type="button"
                                                onClick={() => openQuestionEditor(question)}
                                                className="rounded-lg border border-cyan-500/30 px-2 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/10"
                                              >
                                                Edit
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleDeleteQuestion(question.question_id)}
                                                className="rounded-lg border border-rose-500/30 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/10"
                                              >
                                                Delete
                                              </button>
                                              <button
                                                onClick={() => moveQuestion(question.question_id, -1)}
                                                disabled={questionIndex <= 0}
                                                className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-400 hover:text-white"
                                              >
                                                ▲
                                              </button>
                                              <button
                                                onClick={() => moveQuestion(question.question_id, 1)}
                                                disabled={questionIndex === -1 || questionIndex >= globalQuestions.length - 1}
                                                className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-400 hover:text-white"
                                              >
                                                ▼
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => toggleQuestionExpanded(question.question_id)}
                                                className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:border-slate-500"
                                              >
                                                {isExpanded ? 'Hide' : 'View'}
                                              </button>
                                            </div>
                                          </div>

                                          <div className="flex flex-wrap gap-2 mt-3">
                                            <QuestionChip label={contextGroup.label} />
                                            <QuestionChip label={formatQuestionType(typeGroup.label)} />
                                            <QuestionChip label={formatDifficulty(difficulty)} tone={difficulty} />
                                          </div>

                                          {isExpanded && (
                                            <>
                                              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400 leading-5">
                                                Full Question: <span className="text-slate-200">{question.question_text}</span>
                                              </div>
                                              {question.answer_text && (
                                                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400 leading-5">
                                                  Follow-up / Tip: <span className="text-slate-300">{question.answer_text}</span>
                                                </div>
                                              )}
                                              {getOptionsPreview(question.options) && (
                                                <div className="mt-3 text-xs text-slate-500 leading-5">
                                                  Options: <span className="text-slate-300">{getOptionsPreview(question.options)}</span>
                                                </div>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-8 text-center text-xs text-slate-400">
                                      No {formatDifficulty(difficulty).toLowerCase()} questions in this section.
                                    </div>
                                  )}

                                  {hiddenCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => handleShowMoreQuestions(sectionKey)}
                                      className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2 text-xs font-semibold text-slate-300 hover:border-slate-500"
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
                    ))}
                  </div>
                </div>
              ))}

              {groupedQuestionData.stats.questions === 0 && (
                <div className="py-10 text-center text-sm text-slate-500">
                  {globalQuestions.length === 0
                    ? 'No global questions found. Import your first CSV to create the question bank.'
                    : 'No questions match your current search and filters.'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-md sticky top-6 space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-2">Create Subscription Invite</h2>
              <p className="text-xs text-slate-400">Enter the restaurant name and email, then send the generated onboarding link by URL, email, or QR code.</p>
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
                className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 text-sm mt-2"
              >
                {inviteLoading ? 'Generating Invite...' : 'Generate Subscription Link'}
              </button>
            </form>

            {generatedInvite && (
              <div className="space-y-4 pt-4 border-t border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white">Invite Ready</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Expires on {new Date(generatedInvite.invite.expires_at).toLocaleString()}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Subscription URL</label>
                  <ReadOnlyBlock value={generatedInvite.invite.url} />
                  <button
                    type="button"
                    onClick={() => copyText(generatedInvite.invite.url, 'Subscription URL copied to clipboard.')}
                    className="mt-2 text-xs font-semibold text-purple-300 hover:text-purple-200"
                  >
                    Copy URL
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Direct Email Link</label>
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
                      className="text-cyan-300 hover:text-cyan-200"
                    >
                      Open Email Draft
                    </a>
                    <button
                      type="button"
                      onClick={() => copyText(generatedInvite.invite.email_body, 'Email message copied to clipboard.')}
                      className="text-purple-300 hover:text-purple-200"
                    >
                      Copy Email Text
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">QR Code</label>
                  <div className="rounded-2xl border border-slate-800 bg-white p-4 inline-flex">
                    <img src={generatedInvite.invite.qr_code_data_url} alt="Subscription QR code" className="w-48 h-48" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
    ? 'border-cyan-500/20 from-cyan-500/15'
    : accent === 'violet'
      ? 'border-violet-500/20 from-violet-500/15'
      : accent === 'emerald'
        ? 'border-emerald-500/20 from-emerald-500/15'
        : 'border-amber-500/20 from-amber-500/15';

  return (
    <div className={`rounded-3xl border bg-gradient-to-br ${accentClasses} to-slate-950/80 px-5 py-5 shadow-lg`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-slate-400">{label}</div>
      <div className="mt-3 text-4xl font-extrabold tracking-tight text-white">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{helper}</div>
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
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm font-semibold text-slate-200">{label}</span>
        <span className="text-xs font-bold text-slate-400">{count} sessions</span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-violet-400 to-amber-400"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-slate-500">{percentage}% of the last {rangeLabel}</div>
    </div>
  );
}

function LiveVenueCard({ restaurant }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h4 className="text-base font-bold text-white">{restaurant.name}</h4>
          </div>
          <div className="text-xs text-slate-500 mt-1">/{restaurant.slug}</div>
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-right">
          <div className="text-lg font-extrabold text-cyan-200">{restaurant.active_sessions}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/80">Live Sessions</div>
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
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
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

function StatusBadge({ status }) {
  const classes = status === 'active'
    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
    : status === 'pending'
      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30';

  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${classes}`}>{status}</span>;
}

function FormField({ label, placeholder, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-all text-sm"
      />
    </div>
  );
}

function TextAreaField({ label, placeholder, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-all text-sm"
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange, formatter = (option) => option }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-purple-500 transition-all text-sm"
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
    <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs text-slate-300 break-all">
      {value}
    </div>
  );
}

function QuestionStatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-center">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function QuestionChip({ label, tone = 'default' }) {
  const classes = tone === 'accent'
    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
    : tone === 'easy'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : tone === 'medium'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
        : tone === 'deep'
          ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200'
          : 'border-slate-700 bg-slate-900 text-slate-300';

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wider ${classes}`}>
      {label}
    </span>
  );
}

function FilterGroup({ label, options, selected, onSelect, formatter = (value) => value }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option === selected;
          return (
            <button
              key={`${label}-${option}`}
              type="button"
              onClick={() => onSelect(option)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                active
                  ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                  : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-600'
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
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-white/75 mt-1">{label}</div>
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
    return 'border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-slate-950 to-slate-950';
  }
  if (context === 'Established') {
    return 'border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-slate-950 to-slate-950';
  }
  if (context === 'Mature') {
    return 'border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-slate-950 to-slate-950';
  }
  return 'border-slate-800 bg-slate-950';
}

function getContextPillClasses(context) {
  if (context === 'Exploring') {
    return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  }
  if (context === 'Established') {
    return 'border-violet-500/30 bg-violet-500/10 text-violet-200';
  }
  if (context === 'Mature') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  }
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function getDifficultySectionClasses(difficulty) {
  if (difficulty === 'easy') {
    return 'border-emerald-500/20 bg-gradient-to-b from-emerald-500/10 to-slate-950';
  }
  if (difficulty === 'medium') {
    return 'border-amber-500/20 bg-gradient-to-b from-amber-500/10 to-slate-950';
  }
  if (difficulty === 'deep') {
    return 'border-fuchsia-500/20 bg-gradient-to-b from-fuchsia-500/10 to-slate-950';
  }
  return 'border-slate-800 bg-slate-950';
}
