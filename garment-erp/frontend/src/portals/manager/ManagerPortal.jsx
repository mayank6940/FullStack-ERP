import React, { useEffect, useMemo, useState } from 'react';
import { DesktopHeader } from '../../components/Header';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';
import { downloadCsv } from '../../utils/csvExport';

const ManagerPortal = () => {
  const { t } = useLanguage();
  const [activePage, setActivePage] = useState('dashboard');
  const [orders, setOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [workloads, setWorkloads] = useState([]);
  const [activities, setActivities] = useState([]);
  const [openIssues, setOpenIssues] = useState([]);
  const [issueResolutionDrafts, setIssueResolutionDrafts] = useState({});
  const [issueActionLoadingId, setIssueActionLoadingId] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [error, setError] = useState('');

  const [csvContent, setCsvContent] = useState('OrderCode,ArticleName,Quantity,FabricType,Size,DeliveryDate\n');
  const [headers, setHeaders] = useState([]);
  const [headerOptions, setHeaderOptions] = useState([]);
  const [mapping, setMapping] = useState({});
  const [previewResult, setPreviewResult] = useState(null);
  const [invalidRows, setInvalidRows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedTimeline, setSelectedTimeline] = useState([]);
  const [visibilityRole, setVisibilityRole] = useState('FABRIC_MAN');
  const [visibilityRoles, setVisibilityRoles] = useState(['FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR']);
  const [availableColumns, setAvailableColumns] = useState([]);
  const [selectedVisibleColumns, setSelectedVisibleColumns] = useState([]);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [rejectionStats, setRejectionStats] = useState({
    summary: {
      rejectedToday: 0,
      rejectionRateThisWeek: 0
    },
    employeeStats: []
  });
  const [rejectionLoading, setRejectionLoading] = useState(false);
  const [rejectionFilters, setRejectionFilters] = useState({
    fromDate: '',
    toDate: '',
    role: ''
  });
  const [reportLoading, setReportLoading] = useState(false);
  const [reportFilters, setReportFilters] = useState({
    fromDate: '',
    toDate: '',
    role: '',
    batchId: '',
    articleType: ''
  });
  const [reportData, setReportData] = useState({
    pipeline: { statusCounts: [], avgTimeByStageHours: {}, totalOrders: 0, completedToday: 0 },
    performance: { items: [] },
    rejection: { byCategory: [], topEmployees: [], topBatches: [], totalRejections: 0, averageResolutionHours: 0 },
    batch: { items: [] },
    daily: { ordersCompletedToday: 0, ordersStartedToday: 0, rejectionsToday: 0, employeesActiveToday: 0, overdueOrders: [] }
  });
  const [portalSettings, setPortalSettings] = useState({
    activityRefreshSeconds: 30,
    stuckOrderHours: 24,
    overdueGraceHours: 0,
    lowQualityScoreThreshold: 70,
    highlightRejections: true
  });

  const panelClass = 'rounded-2xl border border-[#d9d1c3] bg-white/95 shadow-[0_8px_24px_rgba(34,42,54,0.08)] p-6';
  const subtlePanelClass = 'rounded-xl border border-[#e5ded2] bg-[#fbf9f4] p-4';
  const statCardClass = 'rounded-xl border border-[#dfd6c7] bg-[#fcfaf5] px-4 py-3 shadow-sm';
  const inputClass = 'w-full rounded-xl border border-[#cfc5b4] bg-white px-3 py-2 text-sm text-[#1e2b37] outline-none transition focus:border-[#2d5a66] focus:ring-2 focus:ring-[#2d5a66]/20';
  const primaryButtonClass = 'rounded-xl bg-[#2d5a66] px-4 py-2 text-white font-semibold transition hover:bg-[#234a54] disabled:bg-gray-400';
  const secondaryButtonClass = 'rounded-xl bg-[#5f6f52] px-4 py-2 text-white font-semibold transition hover:bg-[#4f5e45] disabled:bg-gray-400';
  const dangerButtonClass = 'rounded-xl bg-[#b94f3f] px-4 py-2 text-white font-semibold transition hover:bg-[#9f4234] disabled:bg-gray-400';
  const navButtonClass = (page) => `block w-full text-left rounded-xl px-3 py-3 text-sm font-semibold transition ${activePage === page ? 'bg-[#e7d8be] text-[#172635]' : 'text-[#f3f4f6] hover:bg-[#1c2940]'}`;
  const tableHeadClass = 'bg-[#f0e7d8] text-[#30404d]';
  const tableScrollClass = 'overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-[#e1d8c9] bg-white';
  const tableScrollCompactClass = 'overflow-x-auto max-h-[340px] overflow-y-auto rounded-xl border border-[#e1d8c9] bg-white';
  const sectionTitleClass = 'text-xl font-bold text-[#132130] mb-3';

  const defaultMappingFields = [
    'OrderCode', 'Products', 'StyleCode', 'FabricName', 'Colour', 'Pattern', 'FabricSize', 'Lining', 'Channel',
    'UniwareCreatedAt', 'ChannelCreatedAt', 'DisplayOrderNo', 'PaymentType', 'OrderPrice', 'SellerSKUs',
    'Quantity', 'Size', 'ArticleName', 'FabricType', 'DeliveryDate'
  ];
  const [mappingFields, setMappingFields] = useState(defaultMappingFields);

  const isMapped = (field) => {
    const value = mapping[field];
    return Boolean(value && String(value).trim() && value !== '__SKIP__');
  };

  const hasAnySizeSource = ['Size', 'Products', 'SellerSKUs', 'StyleCode'].some((field) => isMapped(field));

  const [filters, setFilters] = useState({
    status: '',
    size: '',
    assignedWorker: '',
    fromDate: '',
    toDate: ''
  });

  const [activityFilters, setActivityFilters] = useState({
    employeeId: '',
    role: '',
    action: '',
    fromDate: '',
    toDate: ''
  });

  const pipelineCounts = useMemo(() => {
    const counts = {};
    orders.forEach((order) => {
      counts[order.status] = (counts[order.status] || 0) + 1;
    });
    return counts;
  }, [orders]);

  const dashboardSummary = useMemo(() => {
    const today = new Date().toDateString();
    const totalToday = orders.filter((o) => new Date(o.createdAt).toDateString() === today).length;
    const inProgress = orders.filter((o) => String(o.status).includes('IN_PROGRESS')).length;
    const completed = orders.filter((o) => o.status === 'COMPLETED').length;
    const rejected = orders.filter((o) => o.status === 'REJECTED').length;
    return { totalToday, inProgress, completed, rejected };
  }, [orders]);

  const dashboardAlerts = useMemo(() => {
    const now = Date.now();
    const overdueGraceMs = Number(portalSettings.overdueGraceHours || 0) * 60 * 60 * 1000;
    const stuckHours = Number(portalSettings.stuckOrderHours || 24);
    const overdue = orders.filter((o) => {
      const deliveryDate = o.details?.deliveryDate;
      if (!deliveryDate) return false;
      return (new Date(deliveryDate).getTime() + overdueGraceMs) < now && o.status !== 'COMPLETED';
    });

    const stuck = orders.filter((o) => {
      const createdMs = new Date(o.createdAt).getTime();
      const ageHours = (now - createdMs) / (1000 * 60 * 60);
      return ageHours > stuckHours && !['COMPLETED', 'REJECTED'].includes(o.status);
    });

    return { overdue, stuck };
  }, [orders, portalSettings.overdueGraceHours, portalSettings.stuckOrderHours]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (filters.status && order.status !== filters.status) return false;
      if (filters.size && order.size !== filters.size) return false;
      if (filters.fromDate && new Date(order.createdAt) < new Date(filters.fromDate)) return false;
      if (filters.toDate && new Date(order.createdAt) > new Date(filters.toDate + 'T23:59:59')) return false;
      if (filters.assignedWorker) {
        const hasWorker = (order.assignments || []).some((a) => a.employee?.id === filters.assignedWorker);
        if (!hasWorker) return false;
      }
      return true;
    });
  }, [orders, filters]);

  const filteredActivities = useMemo(() => {
    return activities.filter((item) => {
      if (activityFilters.employeeId && item.employeeId !== activityFilters.employeeId) return false;
      if (activityFilters.role && item.employee?.role !== activityFilters.role) return false;
      if (activityFilters.action && item.action !== activityFilters.action) return false;
      if (activityFilters.fromDate && new Date(item.createdAt) < new Date(activityFilters.fromDate)) return false;
      if (activityFilters.toDate && new Date(item.createdAt) > new Date(activityFilters.toDate + 'T23:59:59')) return false;
      return true;
    });
  }, [activities, activityFilters]);

  const reportedIssueActivities = useMemo(() => (
    filteredActivities.filter((item) => item.action === 'ORDER_ISSUE_REPORTED')
  ), [filteredActivities]);

  const loadOpenIssues = async () => {
    try {
      const response = await api.get('/orders/reported-issues?status=open&limit=200');
      setOpenIssues(response.data?.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load reported issues');
    }
  };

  const updateIssueDraft = (issueId, key, value) => {
    setIssueResolutionDrafts((prev) => ({
      ...prev,
      [issueId]: {
        ...(prev[issueId] || {}),
        [key]: value
      }
    }));
  };

  const handleResolveIssue = async (issueId) => {
    try {
      setIssueActionLoadingId(issueId);
      setError('');
      const draft = issueResolutionDrafts[issueId] || {};
      await api.post(`/orders/issues/${issueId}/resolve`, {
        correctedMaterial: draft.correctedMaterial || '',
        resolutionNote: draft.resolutionNote || ''
      });
      setIssueResolutionDrafts((prev) => {
        const next = { ...prev };
        delete next[issueId];
        return next;
      });
      await Promise.all([fetchData(), loadOpenIssues()]);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to resolve reported issue');
    } finally {
      setIssueActionLoadingId('');
    }
  };

  const fetchData = async () => {
    try {
      setPageLoading(true);
      setError('');

      const [ordersRes, employeesRes, workloadRes, activityRes, templatesRes, mappingFieldsRes, rejectionStatsRes, settingsRes, issueRes] = await Promise.allSettled([
        api.get('/orders?limit=200'),
        api.get('/employees?limit=200'),
        api.get('/assignment/workload'),
        api.get('/activity?limit=50'),
        api.get('/orders/column-mappings'),
        api.get('/orders/mapping-fields'),
        api.get('/orders/rejection-stats'),
        api.get('/admin/settings/public'),
        api.get('/orders/reported-issues?status=open&limit=200')
      ]);

      // Process results with fallbacks for failed requests
      if (ordersRes.status === 'fulfilled') {
        setOrders(ordersRes.value.data.data.items || []);
      }
      if (employeesRes.status === 'fulfilled') {
        setEmployees(employeesRes.value.data.data || []);
      }
      if (workloadRes.status === 'fulfilled') {
        setWorkloads(workloadRes.value.data.data.workloads || []);
      }
      if (activityRes.status === 'fulfilled') {
        setActivities(activityRes.value.data.data.items || []);
      }
      if (templatesRes.status === 'fulfilled') {
        setTemplates(templatesRes.value.data.data.templates || []);
      }
      if (mappingFieldsRes.status === 'fulfilled') {
        const fields = mappingFieldsRes.value.data?.data?.fields;
        if (Array.isArray(fields) && fields.length > 0) {
          setMappingFields(fields);
        }
      }
      if (rejectionStatsRes.status === 'fulfilled') {
        setRejectionStats(rejectionStatsRes.value.data?.data || {
          summary: { rejectedToday: 0, rejectionRateThisWeek: 0 },
          employeeStats: []
        });
      }
      if (settingsRes.status === 'fulfilled') {
        setPortalSettings((prev) => ({ ...prev, ...(settingsRes.value.data?.data || {}) }));
      }
      if (issueRes.status === 'fulfilled') {
        setOpenIssues(issueRes.value.data?.data?.items || []);
      }

      // Show error only if all critical API calls failed
      if (
        ordersRes.status === 'rejected' &&
        employeesRes.status === 'rejected' &&
        workloadRes.status === 'rejected'
      ) {
        const errorMsg = ordersRes.reason?.response?.data?.message || 'Failed to load manager dashboard data';
        setError(errorMsg);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load manager dashboard data');
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (activePage === 'column-visibility') {
      loadVisibilityOptions(visibilityRole);
    }
  }, [activePage, visibilityRole]);

  useEffect(() => {
    if (activePage === 'reports') {
      loadReports();
    }
  }, [activePage, reportFilters]);

  useEffect(() => {
    if (activePage !== 'activity') return undefined;
    loadOpenIssues();
    const id = setInterval(() => {
      api.get('/activity?limit=50')
        .then((response) => setActivities(response.data.data.items || []))
        .catch(() => {});
      api.get('/orders/reported-issues?status=open&limit=200')
        .then((response) => setOpenIssues(response.data?.data?.items || []))
        .catch(() => {});
    }, Math.max((portalSettings.activityRefreshSeconds || 30) * 1000, 10000));
    return () => clearInterval(id);
  }, [activePage, portalSettings.activityRefreshSeconds]);

  const loadReports = async () => {
    try {
      setReportLoading(true);
      setError('');

      const params = new URLSearchParams();
      if (reportFilters.fromDate) params.set('fromDate', reportFilters.fromDate);
      if (reportFilters.toDate) params.set('toDate', reportFilters.toDate);
      if (reportFilters.role) params.set('role', reportFilters.role);
      if (reportFilters.batchId) params.set('batchId', reportFilters.batchId);
      if (reportFilters.articleType) params.set('articleType', reportFilters.articleType);
      const query = params.toString();
      const suffix = query ? `?${query}` : '';

      const [pipelineRes, performanceRes, rejectionRes, batchRes, dailyRes] = await Promise.all([
        api.get(`/reports/pipeline${suffix}`),
        api.get(`/reports/employee-performance${suffix ? `${suffix}&limit=100` : '?limit=100'}`),
        api.get(`/reports/rejection-analysis${suffix}`),
        api.get(`/reports/batch${suffix ? `${suffix}&limit=50` : '?limit=50'}`),
        api.get('/reports/daily-summary')
      ]);

      setReportData({
        pipeline: pipelineRes.data?.data || { statusCounts: [], avgTimeByStageHours: {}, totalOrders: 0, completedToday: 0 },
        performance: performanceRes.data?.data || { items: [] },
        rejection: rejectionRes.data?.data || { byCategory: [], topEmployees: [], topBatches: [], totalRejections: 0, averageResolutionHours: 0 },
        batch: batchRes.data?.data || { items: [] },
        daily: dailyRes.data?.data || { ordersCompletedToday: 0, ordersStartedToday: 0, rejectionsToday: 0, employeesActiveToday: 0, overdueOrders: [] }
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load reports');
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    if (activePage === 'rejection-analysis') {
      loadRejectionStats();
    }
  }, [activePage, rejectionFilters]);

  const loadRejectionStats = async () => {
    try {
      setRejectionLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (rejectionFilters.fromDate) params.set('fromDate', rejectionFilters.fromDate);
      if (rejectionFilters.toDate) params.set('toDate', rejectionFilters.toDate);
      if (rejectionFilters.role) params.set('role', rejectionFilters.role);
      const query = params.toString();
      const response = await api.get(`/orders/rejection-stats${query ? `?${query}` : ''}`);
      setRejectionStats(response.data?.data || {
        summary: { rejectedToday: 0, rejectionRateThisWeek: 0 },
        employeeStats: []
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load rejection stats');
    } finally {
      setRejectionLoading(false);
    }
  };

  const loadVisibilityOptions = async (role) => {
    try {
      setVisibilityLoading(true);
      setError('');
      const response = await api.get(`/orders/visible-columns/options?role=${role}`);
      const data = response.data?.data || {};
      setVisibilityRoles(data.roles || ['FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR']);
      setAvailableColumns(data.availableColumns || []);
      setSelectedVisibleColumns(data.selectedColumns || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load column visibility options');
    } finally {
      setVisibilityLoading(false);
    }
  };

  const toggleVisibleColumn = (column) => {
    setSelectedVisibleColumns((prev) => {
      if (prev.includes(column)) return prev.filter((item) => item !== column);
      return [...prev, column];
    });
  };

  const saveVisibleColumns = async () => {
    try {
      setVisibilitySaving(true);
      setError('');
      await api.put(`/orders/visible-columns/${visibilityRole}`, { columns: selectedVisibleColumns });
      await loadVisibilityOptions(visibilityRole);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save visible columns');
    } finally {
      setVisibilitySaving(false);
    }
  };

  const parseCsvHeaders = (content) => {
    const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0);
    if (!firstLine) return [];

    const rawHeaders = firstLine.split(',').map((h) => h.trim()).filter(Boolean);

    // Keep frontend header keys aligned with backend CSV parser behavior.
    // Duplicate "Fabric" columns are renamed deterministically so manager can map both fields correctly.
    let fabricCounter = 0;
    return rawHeaders.map((header) => {
      const lower = String(header || '').trim().toLowerCase();
      if (lower === 'fabric') {
        fabricCounter += 1;
        if (fabricCounter === 1) return 'Fabric_1_Name';
        if (fabricCounter === 2) return 'Fabric_2_Size';
        return `Fabric_${fabricCounter}`;
      }
      return header;
    });
  };

  const formatHeaderLabel = (header) => {
    if (header === 'Fabric_1_Name') return 'Fabric (Name)';
    if (header === 'Fabric_2_Size') return 'Fabric (Weight/Size)';
    return header;
  };

  const handleOrderCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // If a previous CSV request was stuck, uploading a new file should reset UI state.
      setCsvLoading(false);
      setError('');

      const text = await file.text();
      setCsvContent(text);
      const detectedHeaders = parseCsvHeaders(text);
      setHeaders(detectedHeaders);
      setHeaderOptions(detectedHeaders.map((header) => ({
        value: header,
        label: formatHeaderLabel(header)
      })));

      // Manager-controlled mapping: default every field to blank and let user choose.
      const blankMapping = Object.fromEntries(mappingFields.map((field) => [field, '']));
      setMapping(blankMapping);

      // Reset previous run state for fresh upload.
      setPreviewResult(null);
      setInvalidRows([]);
    } catch (err) {
      setError('Failed to read CSV file. Please try again.');
    }

    // Allow selecting the same file again if needed.
    event.target.value = '';
  };

  const handlePreview = async () => {
    const missingRequired = [];
    if (!isMapped('OrderCode')) {
      missingRequired.push('OrderCode');
    }
    if (!hasAnySizeSource) {
      missingRequired.push('Size source (Size/Products/SellerSKUs/StyleCode)');
    }

    if (missingRequired.length > 0) {
      setError(`Please map required fields before preview: ${missingRequired.join(', ')}`);
      return;
    }

    try {
      setCsvLoading(true);
      setError('');
      const response = await api.post('/orders/csv-preview', {
        csvContent,
        columnMapping: mapping
      }, { timeout: 120000 });
      setPreviewResult(response.data.data);
      setInvalidRows(response.data.data.report?.invalidRows || []);
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('CSV preview timed out. Please reduce CSV size or try again.');
      } else if (!err.response) {
        setError('Cannot reach server. Please ensure backend is running on port 5000.');
      } else {
        setError(err.response?.data?.message || err.message || 'Failed to preview order CSV');
      }
    } finally {
      setCsvLoading(false);
    }
  };

  const updateInvalidRow = (rowIndex, field, value) => {
    setInvalidRows((prev) => {
      const next = [...prev];
      next[rowIndex] = {
        ...next[rowIndex],
        [field]: value
      };
      return next;
    });
  };

  const moveInvalidRowToValid = (rowIndex) => {
    setInvalidRows((prevInvalid) => {
      const row = prevInvalid[rowIndex];
      const stillIssues = [];
      if (!row.orderCode) stillIssues.push('Missing OrderCode');
      if (!['SMALL', 'MEDIUM', 'LARGE'].includes(String(row.size || '').toUpperCase())) stillIssues.push('Invalid or missing Size');
      if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) stillIssues.push('Invalid or missing Quantity');

      if (stillIssues.length > 0) {
        const next = [...prevInvalid];
        next[rowIndex] = { ...row, issues: stillIssues };
        return next;
      }

      setPreviewResult((prevPreview) => ({
        ...prevPreview,
        report: {
          ...prevPreview.report,
          validRows: [...(prevPreview.report?.validRows || []), { ...row, size: String(row.size).toUpperCase(), quantity: Number(row.quantity), issues: undefined }]
        },
        summary: {
          ...prevPreview.summary,
          validRows: (prevPreview.summary?.validRows || 0) + 1,
          invalidRows: Math.max((prevPreview.summary?.invalidRows || 1) - 1, 0)
        }
      }));

      return prevInvalid.filter((_, idx) => idx !== rowIndex);
    });
  };

  const handleSaveTemplate = async () => {
    if (!previewResult?.signature) return;
    try {
      setCsvLoading(true);
      await api.post('/orders/save-column-mapping', {
        name: `Template ${new Date().toLocaleString()}`,
        signature: previewResult.signature,
        mapping
      }, { timeout: 120000 });
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save column mapping template');
    } finally {
      setCsvLoading(false);
    }
  };

  const handleUseTemplate = (templateId) => {
    const selected = templates.find((t) => t.id === templateId);
    if (selected) {
      setMapping(selected.mapping || {});
    }
  };

  const handleMappingChange = (field, value) => {
    setMapping((prev) => ({ 
      ...prev, 
      [field]: value
    }));
  };

  const handleHeadersRefresh = () => {
    if (csvContent && csvContent.length > 0) {
      const detectedHeaders = parseCsvHeaders(csvContent);
      setHeaders(detectedHeaders);
    }
  };

  const handleConfirmImport = async () => {
    if (!previewResult?.report?.validRows?.length) return;

    try {
      setCsvLoading(true);
      setError('');

      await api.post('/orders/csv-confirm', {
        filename: 'orders.csv',
        approvedRows: previewResult.report.validRows
      }, { timeout: 300000 });

      await fetchData();
      setPreviewResult(null);
      setInvalidRows([]);
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('Order import timed out. Please try a smaller CSV batch.');
      } else {
        setError(err.response?.data?.message || 'Failed to confirm order import');
      }
    } finally {
      setCsvLoading(false);
    }
  };

  const handleDeleteAllOrders = async () => {
    const ok = window.confirm('Delete ALL orders? This action is permanent and will also remove all order assignments.');
    if (!ok) return;

    try {
      setCsvLoading(true);
      setError('');
      await api.delete('/orders/all', { timeout: 120000 });

      // Clear order-import preview context and refresh dashboard/order data.
      setPreviewResult(null);
      setInvalidRows([]);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete all orders');
    } finally {
      setCsvLoading(false);
    }
  };

  const openOrderDetail = async (order) => {
    try {
      const [detailRes, timelineRes] = await Promise.all([
        api.get(`/orders/${order.id}`),
        api.get(`/orders/${order.id}/timeline`)
      ]);
      setSelectedOrder(detailRes.data.data.order);
      setSelectedTimeline(timelineRes.data.data.timeline || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load order detail');
    }
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <div className={statCardClass}><p className="text-sm text-gray-500">Total orders today</p><p className="text-2xl font-bold">{dashboardSummary.totalToday}</p></div>
        <div className={statCardClass}><p className="text-sm text-gray-500">In progress</p><p className="text-2xl font-bold">{dashboardSummary.inProgress}</p></div>
        <div className={statCardClass}><p className="text-sm text-gray-500">Completed</p><p className="text-2xl font-bold">{dashboardSummary.completed}</p></div>
        <div className={statCardClass}><p className="text-sm text-gray-500">Rejected</p><p className="text-2xl font-bold">{dashboardSummary.rejected}</p></div>
        <div className={`${statCardClass} border-red-200 bg-red-50`}><p className="text-sm text-gray-500">Orders Rejected Today</p><p className="text-2xl font-bold text-red-600">{rejectionStats.summary?.rejectedToday || 0}</p></div>
        <div className={`${statCardClass} border-red-200 bg-red-50`}><p className="text-sm text-gray-500">Rejection Rate This Week</p><p className="text-2xl font-bold text-red-600">{rejectionStats.summary?.rejectionRateThisWeek || 0}%</p></div>
      </div>

      <div className={panelClass}>
        <h3 className={sectionTitleClass}>Order Pipeline</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {Object.entries(pipelineCounts).map(([status, count]) => (
            <div key={status} className={statCardClass}>
              <p className="text-gray-500">{status}</p>
              <p className="text-lg font-semibold">{count}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={panelClass}>
        <h3 className={sectionTitleClass}>Recent Activity</h3>
        <div className="space-y-2 max-h-[320px] overflow-y-auto rounded-xl border border-[#e1d8c9] bg-white p-3">
          {activities.slice(0, 20).map((item) => (
            <div key={item.id} className={`border-b pb-2 text-sm ${item.action === 'ORDER_REJECTED' ? 'bg-red-50 rounded p-2' : ''}`}>
              <p className={`font-semibold ${item.action === 'ORDER_REJECTED' ? 'text-red-700' : ''}`}>{item.action}</p>
              <p className="text-gray-600">{item.employee?.name} ({item.employee?.empId})</p>
              <p className="text-gray-500">{new Date(item.createdAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={panelClass}>
        <h3 className={sectionTitleClass}>Alerts</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className={`${statCardClass} bg-yellow-50 border-yellow-200`}>
            <p className="font-semibold">Overdue Orders</p>
            <p>{dashboardAlerts.overdue.length} orders are past delivery date.</p>
            {dashboardAlerts.overdue.slice(0, 5).map((order) => (
              <button
                key={`overdue-${order.id}`}
                type="button"
                onClick={() => openOrderDetail(order)}
                className="block text-left text-red-700 underline mt-1"
              >
                {order.orderCode}
              </button>
            ))}
          </div>
          <div className={`${statCardClass} bg-red-50 border-red-200`}>
            <p className="font-semibold">Stuck Orders &gt; 24h</p>
            <p>{dashboardAlerts.stuck.length} orders have been in pipeline for over 24 hours.</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderOrderManagement = () => (
    <div className="space-y-6">
      <div className={panelClass}>
        <h3 className="text-xl font-bold text-[#132130] mb-4">Order CSV Upload Flow</h3>

        <div className="mb-4">
          <label className="block font-semibold mb-2">Step 1: Upload CSV</label>
          <input type="file" accept=".csv" onChange={handleOrderCsvUpload} />
        </div>

        {headers.length > 0 && (
          <div className="mb-4">
            <label className="block font-semibold mb-2">Step 2: Column Mapping (Manager Controlled)</label>
            <p className="text-sm text-gray-600 mb-3">All fields are blank by default. Select only the columns you want to include.</p>
            <div className="mb-3 p-3 rounded border border-yellow-300 bg-yellow-50 text-sm text-yellow-900">
              Required before preview: select <span className="font-semibold">OrderCode</span> and at least one size source from
              <span className="font-semibold"> Size / Products / SellerSKUs / StyleCode</span>.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {mappingFields.map((field) => (
                <div key={field}>
                  <label className="text-sm text-gray-600">{field}</label>
                  <select
                    value={mapping[field] || ''}
                    onChange={(e) => handleMappingChange(field, e.target.value)}
                    className={`${inputClass} ${(field === 'OrderCode' && !isMapped('OrderCode')) || (['Size', 'Products', 'SellerSKUs', 'StyleCode'].includes(field) && !hasAnySizeSource) ? 'border-red-400 bg-red-50' : ''}`}
                  >
                    <option value="">-- Select Column --</option>
                    <option value="__SKIP__">Do not include</option>
                    {headerOptions.map((option) => (
                      <option key={`${field}-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 mb-4">
          <button onClick={handlePreview} disabled={csvLoading || pageLoading} className={primaryButtonClass}>{csvLoading ? 'Processing...' : 'Preview CSV'}</button>
          <button onClick={handleSaveTemplate} disabled={csvLoading || pageLoading || !previewResult} className={secondaryButtonClass}>Save Mapping Template</button>
          <button onClick={handleConfirmImport} disabled={csvLoading || pageLoading || !previewResult?.report?.validRows?.length} className={secondaryButtonClass}>Approve Import</button>
        </div>

        {templates.length > 0 && (
          <div className="mb-4">
            <label className="block font-semibold mb-2">Use Saved Template</label>
            <select onChange={(e) => handleUseTemplate(e.target.value)} className={`${inputClass} md:w-80`} defaultValue="">
              <option value="">-- Select template --</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </div>
        )}

        {previewResult && (
          <div className={subtlePanelClass}>
            <h4 className="font-bold mb-2">Step 3: Validation Report</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mb-4">
              <div className="bg-green-100 rounded p-2">Valid rows: {previewResult.summary.validRows}</div>
              <div className="bg-yellow-100 rounded p-2">Invalid rows: {previewResult.summary.invalidRows}</div>
              <div className="bg-red-100 rounded p-2">Duplicate rows: {previewResult.summary.duplicateRows}</div>
            </div>

            {previewResult.companyDisplayFields && (
              <div className="mt-4 border-t pt-4">
                <h5 className="font-semibold mb-2">Company Display Fields Configuration:</h5>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {Object.entries(previewResult.companyDisplayFields).map(([key, label]) => (
                    <div key={key} className="bg-blue-50 p-2 rounded">
                      <p className="font-mono text-gray-600">{key}</p>
                      <p className="text-gray-800">{label}</p>
                      <p className="text-gray-500">{mapping[key] === '__SKIP__' ? 'Skipped' : mapping[key] ? `→ ${mapping[key]}` : 'Not mapped'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {previewResult.report?.validRows?.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <h5 className="font-semibold mb-2">Sample Valid Row - Company Fields Display:</h5>
                <div className="overflow-x-auto max-h-64 overflow-y-auto rounded-xl border border-[#e1d8c9] bg-white">
                  <table className="w-full text-xs border">
                    <thead className={`${tableHeadClass} sticky top-0`}>
                      <tr>
                        {Object.values(previewResult.companyDisplayFields || {}).map((label) => (
                          <th key={label} className="border p-2 text-left">{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewResult.report.validRows.slice(0, 3).map((row, idx) => (
                        <tr key={idx} className="border-b">
                          {Object.keys(previewResult.companyDisplayFields || {}).map((fieldKey) => (
                            <td key={fieldKey} className="border p-2">{row.companyFields?.[fieldKey] || '-'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

        <div className={panelClass}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl font-bold text-[#132130]">Orders</h3>
          <button
            type="button"
            onClick={handleDeleteAllOrders}
            disabled={csvLoading || pageLoading || orders.length === 0}
            className={dangerButtonClass}
          >
            Delete All Orders
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3 text-sm">
          <select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))} className={inputClass}>
            <option value="">All Status</option>
            {[...new Set(orders.map((o) => o.status))].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={filters.size} onChange={(e) => setFilters((p) => ({ ...p, size: e.target.value }))} className={inputClass}>
            <option value="">All Sizes</option>
            <option value="SMALL">SMALL</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LARGE">LARGE</option>
          </select>
          <select value={filters.assignedWorker} onChange={(e) => setFilters((p) => ({ ...p, assignedWorker: e.target.value }))} className={inputClass}>
            <option value="">All Workers</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
          <input type="date" value={filters.fromDate} onChange={(e) => setFilters((p) => ({ ...p, fromDate: e.target.value }))} className={inputClass} />
          <input type="date" value={filters.toDate} onChange={(e) => setFilters((p) => ({ ...p, toDate: e.target.value }))} className={inputClass} />
        </div>
        <div className={tableScrollClass}>
          <table className="w-full text-sm">
            <thead className={`${tableHeadClass} sticky top-0`}>
              <tr>
                <th className="p-2 text-left">Order Code</th>
                <th className="p-2 text-left">Article</th>
                <th className="p-2 text-left">Size</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Assigned Workers</th>
                <th className="p-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id} className="border-b even:bg-[#fbf8f2]">
                  <td className="p-2 font-mono">{order.orderCode}</td>
                  <td className="p-2">{order.details?.articleName || '-'}</td>
                  <td className="p-2">{order.size}</td>
                  <td className="p-2">{order.status}</td>
                  <td className="p-2">{(order.assignments || []).map((a) => a.employee?.name).filter(Boolean).join(', ') || '-'}</td>
                  <td className="p-2">{new Date(order.createdAt).toLocaleString()}</td>
                  <td className="p-2"><button type="button" onClick={() => openOrderDetail(order)} className="text-blue-600">Detail</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {previewResult?.report?.invalidRows?.length > 0 && (
        <div className={panelClass}>
          <h3 className="text-xl font-bold mb-3">Step 4: Fix Invalid Rows Inline</h3>
          <div className="space-y-3 text-sm">
            {invalidRows.map((row, idx) => (
              <div key={`invalid-${row.rowNumber}-${idx}`} className={subtlePanelClass}>
                <p className="text-red-600 mb-2">Row {row.rowNumber}: {(row.issues || []).join(', ')}</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input value={row.orderCode || ''} onChange={(e) => updateInvalidRow(idx, 'orderCode', e.target.value)} placeholder="OrderCode" className={inputClass} />
                  <input value={row.quantity || ''} onChange={(e) => updateInvalidRow(idx, 'quantity', e.target.value)} placeholder="Quantity" className={inputClass} />
                  <select value={row.size || ''} onChange={(e) => updateInvalidRow(idx, 'size', e.target.value)} className={inputClass}>
                    <option value="">Size</option>
                    <option value="SMALL">SMALL</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LARGE">LARGE</option>
                  </select>
                  <button type="button" onClick={() => moveInvalidRowToValid(idx)} className={secondaryButtonClass}>Apply Fix</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-[#d9d1c3] shadow-xl w-full max-w-3xl max-h-[80vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Order Detail: {selectedOrder.orderCode}</h3>
              <button type="button" onClick={() => setSelectedOrder(null)} className="text-gray-600">Close</button>
            </div>
            <p className="text-sm mb-2">Status: <span className="font-semibold">{selectedOrder.status}</span></p>
            <p className="text-sm mb-4">Size: <span className="font-semibold">{selectedOrder.size}</span></p>

            <h4 className="font-semibold mb-2">Assignments</h4>
            <ul className="text-sm mb-4 list-disc pl-5">
              {(selectedOrder.assignments || []).map((a) => (
                <li key={a.id}>{a.role}: {a.employee?.name} ({a.employee?.empId})</li>
              ))}
            </ul>

            <h4 className="font-semibold mb-2">Timeline</h4>
            <div className="space-y-2 text-sm">
              {selectedTimeline.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-[#e1d8c9] p-3 bg-[#fbf9f4]">
                  <p>{entry.fromStatus} -&gt; {entry.toStatus}</p>
                  <p className="text-gray-500">{new Date(entry.createdAt).toLocaleString()} by {entry.employee?.name || 'System'}</p>
                </div>
              ))}
            </div>

            <h4 className="font-semibold mb-2 mt-4">Rejection History</h4>
            <div className="space-y-2 text-sm">
              {(selectedOrder.rejections || []).length === 0 && <p className="text-gray-500">No rejection history</p>}
              {(selectedOrder.rejections || []).map((rej) => (
                <div key={rej.id} className="rounded-xl border border-red-200 p-3 bg-red-50">
                  <p className="font-semibold text-red-700">{rej.reasonCategory} - Routed to {rej.routedTo}</p>
                  <p>{rej.reason}</p>
                  <p className="text-gray-600">Rejected by {rej.supervisor?.name || '-'} on {new Date(rej.createdAt).toLocaleString()}</p>
                  <p className="text-gray-600">{rej.resolvedAt ? `Resolved on ${new Date(rej.resolvedAt).toLocaleString()}` : 'Open'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderWorkload = () => (
    <div className={panelClass}>
      <h3 className={sectionTitleClass}>Employee Workload</h3>
      <div className={tableScrollClass}>
        <table className="w-full text-sm">
          <thead className={`${tableHeadClass} sticky top-0`}>
            <tr>
              <th className="p-2 text-left">Employee</th>
              <th className="p-2 text-left">Role</th>
              <th className="p-2 text-left">Active</th>
              <th className="p-2 text-left">Completed</th>
              <th className="p-2 text-left">Rejections</th>
              <th className="p-2 text-left">Load</th>
            </tr>
          </thead>
          <tbody>
            {workloads.map((row) => {
              const color = row.active >= 4 ? 'text-red-600' : row.active >= 2 ? 'text-yellow-600' : 'text-green-600';
              return (
                <tr key={row.employeeId} className="border-b even:bg-[#fbf8f2]">
                  <td className="p-2">{row.name} ({row.empId})</td>
                  <td className="p-2">{row.role}</td>
                  <td className="p-2">{row.active}</td>
                  <td className="p-2">{row.completed}</td>
                  <td className="p-2">{row.rejections}</td>
                  <td className={`p-2 font-semibold ${color}`}>{row.active >= 4 ? 'High' : row.active >= 2 ? 'Medium' : 'Low'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderActivity = () => (
    <div className={panelClass}>
      <h3 className={sectionTitleClass}>Activity Monitor</h3>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3 text-sm">
        <select value={activityFilters.employeeId} onChange={(e) => setActivityFilters((p) => ({ ...p, employeeId: e.target.value }))} className={inputClass}>
          <option value="">All Employees</option>
          {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>
        <select value={activityFilters.role} onChange={(e) => setActivityFilters((p) => ({ ...p, role: e.target.value }))} className={inputClass}>
          <option value="">All Roles</option>
          {['ADMIN', 'MANAGER', 'FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR'].map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <select value={activityFilters.action} onChange={(e) => setActivityFilters((p) => ({ ...p, action: e.target.value }))} className={inputClass}>
          <option value="">All Actions</option>
          {[...new Set(activities.map((a) => a.action))].map((act) => <option key={act} value={act}>{act}</option>)}
        </select>
        <input type="date" value={activityFilters.fromDate} onChange={(e) => setActivityFilters((p) => ({ ...p, fromDate: e.target.value }))} className={inputClass} />
        <input type="date" value={activityFilters.toDate} onChange={(e) => setActivityFilters((p) => ({ ...p, toDate: e.target.value }))} className={inputClass} />
      </div>

      <div className={`${subtlePanelClass} mb-4`}>
        <h4 className="font-bold text-[#1f2d3a] mb-2">Reported Orders ({openIssues.length})</h4>
        <div className={tableScrollCompactClass}>
          <table className="w-full text-sm">
            <thead className={`${tableHeadClass} sticky top-0`}>
              <tr>
                <th className="p-2 text-left">Order Code</th>
                <th className="p-2 text-left">Product</th>
                <th className="p-2 text-left">Issue Type</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-left">Reported By</th>
                <th className="p-2 text-left">Time</th>
                <th className="p-2 text-left">Correction</th>
                <th className="p-2 text-left">Resume</th>
              </tr>
            </thead>
            <tbody>
              {openIssues.map((item) => (
                <tr key={`issue-${item.id}`} className="border-b even:bg-[#fbf8f2]">
                  <td className="p-2 font-mono">{item.order?.orderCode || item.orderId || '-'}</td>
                  <td className="p-2">{item.order?.details?.articleName || '-'}</td>
                  <td className="p-2">{item.issueType || '-'}</td>
                  <td className="p-2 max-w-[260px] truncate" title={item.description || ''}>{item.description || '-'}</td>
                  <td className="p-2">{item.reportedBy?.name} ({item.reportedBy?.empId})</td>
                  <td className="p-2">{new Date(item.reportedAt).toLocaleString()}</td>
                  <td className="p-2 min-w-[240px]">
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Corrected material"
                        value={issueResolutionDrafts[item.id]?.correctedMaterial || ''}
                        onChange={(e) => updateIssueDraft(item.id, 'correctedMaterial', e.target.value)}
                        className={inputClass}
                      />
                      <input
                        type="text"
                        placeholder="Resolution note"
                        value={issueResolutionDrafts[item.id]?.resolutionNote || ''}
                        onChange={(e) => updateIssueDraft(item.id, 'resolutionNote', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </td>
                  <td className="p-2 align-top">
                    <button
                      type="button"
                      onClick={() => handleResolveIssue(item.id)}
                      disabled={issueActionLoadingId === item.id}
                      className={secondaryButtonClass}
                    >
                      {issueActionLoadingId === item.id ? 'Resolving...' : 'Resolve & Resume'}
                    </button>
                  </td>
                </tr>
              ))}
              {openIssues.length === 0 && (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={8}>No open reported orders. Workers can continue normal flow.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 max-h-[500px] overflow-y-auto rounded-xl border border-[#e1d8c9] bg-white p-3">
        {filteredActivities.map((item) => (
          <div
            key={item.id}
            className={`border rounded p-3 text-sm ${
              item.action.includes('REJECTED') ? 'bg-red-50 border-red-200' :
              item.action.includes('COMPLETED') || item.action.includes('PASSED') ? 'bg-green-50 border-green-200' :
              item.action.includes('STATUS_UPDATED') ? 'bg-yellow-50 border-yellow-200' :
              item.action.includes('LOGIN') ? 'bg-gray-100 border-gray-300' :
              ''
            }`}
          >
            <p className="font-semibold">{item.action}</p>
            <p className="text-gray-600">{item.employee?.name} ({item.employee?.empId})</p>
            {item.action === 'ORDER_ISSUE_REPORTED' && (
              <>
                <p className="text-gray-700">Order: <span className="font-mono">{item.order?.orderCode || item.orderId || '-'}</span></p>
                <p className="text-gray-700">Issue: {item.metadata?.issueType || '-'}{item.metadata?.description ? ` - ${item.metadata.description}` : ''}</p>
              </>
            )}
            <p className="text-gray-500">{new Date(item.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const renderColumnVisibility = () => (
    <div className={panelClass}>
      <h3 className={sectionTitleClass}>Employee Column Visibility Settings</h3>
      <p className="text-sm text-gray-600 mb-4">Select which columns employees can view in their dynamic order table. Unselected columns are never sent by backend employee API.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Employee Role</label>
          <select
            value={visibilityRole}
            onChange={(e) => setVisibilityRole(e.target.value)}
            className={inputClass}
            disabled={visibilityLoading || visibilitySaving}
          >
            {visibilityRoles.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setSelectedVisibleColumns(availableColumns)}
          className="px-3 py-2 rounded-xl bg-[#ece6da] text-[#2d3a48] font-semibold text-sm hover:bg-[#e0d7c8]"
          disabled={visibilityLoading || visibilitySaving || availableColumns.length === 0}
        >
          Select All
        </button>
        <button
          type="button"
          onClick={() => setSelectedVisibleColumns([])}
          className="px-3 py-2 rounded-xl bg-[#ece6da] text-[#2d3a48] font-semibold text-sm hover:bg-[#e0d7c8]"
          disabled={visibilityLoading || visibilitySaving}
        >
          Clear All
        </button>
      </div>

      {visibilityLoading && <div className="mb-3 p-2 rounded bg-blue-100 text-blue-700 text-sm">Loading visible columns...</div>}

      {!visibilityLoading && availableColumns.length === 0 && (
        <div className="mb-3 p-2 rounded bg-yellow-100 text-yellow-700 text-sm">No columns found yet. Import orders first to generate dynamic column options.</div>
      )}

      {!visibilityLoading && availableColumns.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 max-h-[420px] overflow-y-auto border border-[#e1d8c9] rounded-xl p-3 bg-white">
          {availableColumns.map((column) => (
            <label key={column} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedVisibleColumns.includes(column)}
                onChange={() => toggleVisibleColumn(column)}
                disabled={visibilitySaving}
              />
              <span>{column}</span>
            </label>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={saveVisibleColumns}
          disabled={visibilityLoading || visibilitySaving}
          className={primaryButtonClass}
        >
          {visibilitySaving ? 'Saving...' : 'Save Visibility'}
        </button>
        <button
          type="button"
          onClick={() => loadVisibilityOptions(visibilityRole)}
          disabled={visibilityLoading || visibilitySaving}
          className={secondaryButtonClass}
        >
          Refresh
        </button>
      </div>
    </div>
  );

  const renderRejectionAnalysis = () => (
    <div className={panelClass}>
      <h3 className={sectionTitleClass}>Rejection Analysis</h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 text-sm">
        <input
          type="date"
          value={rejectionFilters.fromDate}
          onChange={(e) => setRejectionFilters((prev) => ({ ...prev, fromDate: e.target.value }))}
          className={inputClass}
        />
        <input
          type="date"
          value={rejectionFilters.toDate}
          onChange={(e) => setRejectionFilters((prev) => ({ ...prev, toDate: e.target.value }))}
          className={inputClass}
        />
        <select
          value={rejectionFilters.role}
          onChange={(e) => setRejectionFilters((prev) => ({ ...prev, role: e.target.value }))}
          className={inputClass}
        >
          <option value="">All Roles</option>
          <option value="FABRIC_MAN">FABRIC_MAN</option>
          <option value="CUTTER">CUTTER</option>
          <option value="TAILOR">TAILOR</option>
        </select>
        <button
          type="button"
          onClick={loadRejectionStats}
          disabled={rejectionLoading}
          className={secondaryButtonClass}
        >
          {rejectionLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className={tableScrollClass}>
        <table className="w-full text-sm">
          <thead className={`${tableHeadClass} sticky top-0`}>
            <tr>
              <th className="p-2 text-left">Employee</th>
              <th className="p-2 text-left">Role</th>
              <th className="p-2 text-left">Total Rejections</th>
              <th className="p-2 text-left">Handled Orders</th>
              <th className="p-2 text-left">Rejection Rate %</th>
            </tr>
          </thead>
          <tbody>
            {(rejectionStats.employeeStats || []).map((row) => (
              <tr key={`${row.employeeId}-${row.role}`} className="border-b even:bg-[#fbf8f2]">
                <td className="p-2">{row.employeeName} ({row.empId})</td>
                <td className="p-2">{row.role}</td>
                <td className="p-2">{row.totalRejections}</td>
                <td className="p-2">{row.handledCount}</td>
                <td className="p-2">{row.rejectionRate}%</td>
              </tr>
            ))}
            {(rejectionStats.employeeStats || []).length === 0 && (
              <tr>
                <td className="p-2 text-gray-500" colSpan={5}>No rejection data found for selected filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderReports = () => {
    if (reportLoading) {
      return (
        <div className={panelClass}>
          <h3 className={sectionTitleClass}>Reports</h3>
          <LoadingSkeleton rows={8} />
        </div>
      );
    }

    const maxCount = Math.max(...(reportData.pipeline.statusCounts || []).map((row) => row.count || 0), 1);

    return (
      <div className="space-y-6">
        <div className={panelClass}>
          <h3 className={sectionTitleClass}>Reports</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
            <input type="date" value={reportFilters.fromDate} onChange={(e) => setReportFilters((p) => ({ ...p, fromDate: e.target.value }))} className={inputClass} />
            <input type="date" value={reportFilters.toDate} onChange={(e) => setReportFilters((p) => ({ ...p, toDate: e.target.value }))} className={inputClass} />
            <select value={reportFilters.role} onChange={(e) => setReportFilters((p) => ({ ...p, role: e.target.value }))} className={inputClass}>
              <option value="">All Roles</option>
              <option value="FABRIC_MAN">FABRIC_MAN</option>
              <option value="CUTTER">CUTTER</option>
              <option value="TAILOR">TAILOR</option>
            </select>
            <input type="text" value={reportFilters.articleType} onChange={(e) => setReportFilters((p) => ({ ...p, articleType: e.target.value }))} placeholder="Article type" className={inputClass} />
            <button type="button" onClick={loadReports} disabled={reportLoading} className={secondaryButtonClass}>{reportLoading ? 'Loading...' : 'Refresh'}</button>
          </div>
        </div>

        <div className={panelClass}>
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-bold text-lg">1. Order Pipeline Overview</h4>
            <button
              type="button"
              onClick={() => downloadCsv('pipeline-report.csv', reportData.pipeline.statusCounts || [], [
                { key: 'status', label: 'Status' },
                { key: 'count', label: 'Count' }
              ])}
              className={primaryButtonClass}
            >
              Export CSV
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-3">Total Orders: {reportData.pipeline.totalOrders} | Completed Today: {reportData.pipeline.completedToday}</p>
          <div className="space-y-2">
            {(reportData.pipeline.statusCounts || []).map((row) => (
              <div key={row.status}>
                <div className="flex justify-between text-sm"><span>{row.status}</span><span>{row.count}</span></div>
                <div className="h-2 bg-gray-200 rounded">
                  <div className="h-2 bg-blue-600 rounded" style={{ width: `${(row.count / maxCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={panelClass}>
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-bold text-lg">2. Employee Performance</h4>
            <button
              type="button"
              onClick={() => downloadCsv('employee-performance-report.csv', reportData.performance.items || [], [
                { key: 'employeeName', label: 'Employee Name' },
                { key: 'role', label: 'Role' },
                { key: 'totalAssigned', label: 'Total Assigned' },
                { key: 'totalCompleted', label: 'Total Completed' },
                { key: 'completionRate', label: 'Completion Rate %' },
                { key: 'avgTimePerOrderHours', label: 'Avg Time/Order (Hours)' },
                { key: 'totalRejectionsCaused', label: 'Rejections Caused' },
                { key: 'rejectionRate', label: 'Rejection Rate %' },
                { key: 'qualityScore', label: 'Quality Score' }
              ])}
              className={primaryButtonClass}
            >
              Export CSV
            </button>
          </div>
          <div className={tableScrollClass}>
            <table className="w-full text-sm">
              <thead className={`${tableHeadClass} sticky top-0`}>
                <tr>
                  <th className="p-2 text-left">Employee</th>
                  <th className="p-2 text-left">Role</th>
                  <th className="p-2 text-left">Assigned</th>
                  <th className="p-2 text-left">Completed</th>
                  <th className="p-2 text-left">Completion %</th>
                  <th className="p-2 text-left">Avg Time</th>
                  <th className="p-2 text-left">Rejections</th>
                  <th className="p-2 text-left">Rejection %</th>
                  <th className="p-2 text-left">Quality</th>
                </tr>
              </thead>
              <tbody>
                {(reportData.performance.items || []).map((row) => (
                  <tr key={row.employeeId} className="border-b even:bg-[#fbf8f2]">
                    <td className="p-2">{row.employeeName} ({row.empId})</td>
                    <td className="p-2">{row.role}</td>
                    <td className="p-2">{row.totalAssigned}</td>
                    <td className="p-2">{row.totalCompleted}</td>
                    <td className="p-2">{row.completionRate}</td>
                    <td className="p-2">{row.avgTimePerOrderHours}h</td>
                    <td className="p-2">{row.totalRejectionsCaused}</td>
                    <td className="p-2">{row.rejectionRate}</td>
                    <td className="p-2 font-semibold">{row.qualityScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={panelClass}>
          <h4 className="font-bold text-lg mb-3">3. Rejection Analysis</h4>
          <p className="text-sm text-gray-700 mb-2">Total Rejections: {reportData.rejection.totalRejections} | Average Resolution: {reportData.rejection.averageResolutionHours}h</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
            {(reportData.rejection.byCategory || []).map((row) => (
              <div key={row.category} className={`${statCardClass} bg-red-50 border-red-200`}>
                <p className="font-semibold">{row.category}</p>
                <p>{row.count}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={panelClass}>
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-bold text-lg">4. Batch Report</h4>
            <button
              type="button"
              onClick={() => downloadCsv('batch-report.csv', reportData.batch.items || [], [
                { key: 'filename', label: 'Batch Filename' },
                { key: 'uploadDate', label: 'Upload Date' },
                { key: 'totalOrders', label: 'Total Orders' },
                { key: 'completed', label: 'Completed' },
                { key: 'inProgress', label: 'In Progress' },
                { key: 'rejected', label: 'Rejected' },
                { key: 'averageCompletionHours', label: 'Average Completion Hours' }
              ])}
              className={primaryButtonClass}
            >
              Export CSV
            </button>
          </div>
          <div className={tableScrollCompactClass}>
            <table className="w-full text-sm">
              <thead className={`${tableHeadClass} sticky top-0`}>
                <tr>
                  <th className="p-2 text-left">Batch</th>
                  <th className="p-2 text-left">Uploaded</th>
                  <th className="p-2 text-left">Total</th>
                  <th className="p-2 text-left">Completed</th>
                  <th className="p-2 text-left">In Progress</th>
                  <th className="p-2 text-left">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {(reportData.batch.items || []).map((row) => (
                  <tr key={row.batchId} className="border-b even:bg-[#fbf8f2]">
                    <td className="p-2">{row.filename}</td>
                    <td className="p-2">{new Date(row.uploadDate).toLocaleString()}</td>
                    <td className="p-2">{row.totalOrders}</td>
                    <td className="p-2">{row.completed}</td>
                    <td className="p-2">{row.inProgress}</td>
                    <td className="p-2">{row.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={panelClass}>
          <h4 className="font-bold text-lg mb-3">5. Daily Activity Summary</h4>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
            <div className={`${statCardClass} bg-green-50 border-green-200`}>Orders completed today: {reportData.daily.ordersCompletedToday}</div>
            <div className={`${statCardClass} bg-blue-50 border-blue-200`}>Orders started today: {reportData.daily.ordersStartedToday}</div>
            <div className={`${statCardClass} bg-red-50 border-red-200`}>Rejections today: {reportData.daily.rejectionsToday}</div>
            <div className={`${statCardClass} bg-[#f1eee7] border-[#d8d0c4]`}>Employees active today: {reportData.daily.employeesActiveToday}</div>
            <div className={`${statCardClass} bg-yellow-50 border-yellow-200`}>Overdue orders: {(reportData.daily.overdueOrders || []).length}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#f6eddc_0%,_#f1f4f7_45%,_#ebe8e2_100%)] text-[#1e2b37]" style={{ fontFamily: 'Manrope, Segoe UI, sans-serif' }}>
      <DesktopHeader />

      <div className="mx-auto flex max-w-[1500px] gap-6 p-4 md:p-6">
        {/* Sidebar */}
        <aside className="w-72 shrink-0 rounded-2xl bg-[#0f1b33] text-white p-6 shadow-[0_10px_30px_rgba(15,27,51,0.35)] md:sticky md:top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto">
          <nav className="space-y-4">
            <h3 className="text-xs font-bold tracking-[0.18em] text-[#d6cdbf] uppercase mb-6">Navigation</h3>
            <button type="button" onClick={() => setActivePage('dashboard')} className={navButtonClass('dashboard')}>Dashboard</button>
            <button type="button" onClick={() => setActivePage('orders')} className={navButtonClass('orders')}>Order Management</button>
            <button type="button" onClick={() => setActivePage('workload')} className={navButtonClass('workload')}>Employee Workload</button>
            <button type="button" onClick={() => setActivePage('activity')} className={navButtonClass('activity')}>Activity Monitor</button>
            <button type="button" onClick={() => setActivePage('reports')} className={navButtonClass('reports')}>Reports</button>
            <button type="button" onClick={() => setActivePage('rejection-analysis')} className={navButtonClass('rejection-analysis')}>Rejection Analysis</button>
            <button type="button" onClick={() => setActivePage('column-visibility')} className={navButtonClass('column-visibility')}>Column Visibility</button>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1">
          <div className={`${panelClass} mb-6 bg-[linear-gradient(120deg,_#ffffff_0%,_#f8f4ec_100%)]`}>
            <p className="text-xs uppercase tracking-[0.2em] text-[#7f7364] font-semibold mb-2">Garment Operations</p>
            <h2 className="text-3xl font-bold mb-3 text-[#132130]">
              {t('portals.manager')}
            </h2>
            <p className="text-[#4f5a66] max-w-3xl">Company-wide order operations, quality oversight, and workforce control.</p>
          </div>

          {error && <div className="mt-6 p-3 rounded-xl bg-[#fff1ef] text-[#a93d30] border border-[#e9b5ad]">{error}</div>}
          {pageLoading && <div className="mt-6 p-3 rounded-xl bg-[#edf6fb] text-[#2d5a66] border border-[#b9d8e7]">Loading dashboard...</div>}

          <div className="mt-6 space-y-6">
            {activePage === 'dashboard' && renderDashboard()}
            {activePage === 'orders' && renderOrderManagement()}
            {activePage === 'workload' && renderWorkload()}
            {activePage === 'activity' && renderActivity()}
            {activePage === 'reports' && renderReports()}
            {activePage === 'rejection-analysis' && renderRejectionAnalysis()}
            {activePage === 'column-visibility' && renderColumnVisibility()}
          </div>
        </main>
      </div>
    </div>
  );
};

export default ManagerPortal;
