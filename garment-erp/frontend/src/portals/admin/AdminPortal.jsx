import React, { useEffect, useMemo, useState } from 'react';
import { DesktopHeader } from '../../components/Header';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';
import { downloadCsv } from '../../utils/csvExport';

const AdminPortal = () => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [csvContent, setCsvContent] = useState('EmpID,Name,Designation\n');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [orders, setOrders] = useState([]);
  const [activities, setActivities] = useState([]);
  const [openIssues, setOpenIssues] = useState([]);
  const [issueResolutionDrafts, setIssueResolutionDrafts] = useState({});
  const [issueActionLoadingId, setIssueActionLoadingId] = useState('');
  const [employeeTab, setEmployeeTab] = useState('active');
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('');
  const [activityFilters, setActivityFilters] = useState({ employeeId: '', role: '', action: '', fromDate: '', toDate: '' });
  const [orderFilters, setOrderFilters] = useState({ status: '', size: '' });
  const [manualEmployee, setManualEmployee] = useState({ empId: '', name: '', designation: '', role: '' });
  const [rejectionStats, setRejectionStats] = useState({
    summary: {
      rejectedToday: 0,
      rejectionRateThisWeek: 0
    },
    employeeStats: [],
    managerStats: []
  });
  const [reportLoading, setReportLoading] = useState(false);
  const [reportFilters, setReportFilters] = useState({
    fromDate: '',
    toDate: '',
    role: '',
    articleType: ''
  });
  const [reportData, setReportData] = useState({
    pipeline: { statusCounts: [], avgTimeByStageHours: {}, totalOrders: 0, completedToday: 0 },
    performance: { items: [] },
    rejection: { byCategory: [], topEmployees: [], topBatches: [], totalRejections: 0, averageResolutionHours: 0 },
    batch: { items: [] },
    daily: { ordersCompletedToday: 0, ordersStartedToday: 0, rejectionsToday: 0, employeesActiveToday: 0, overdueOrders: [] },
    mlSummary: { totalAssignments: 0, completedAssignments: 0, completionRatio: 0, totalRejections: 0, assignmentsByRole: [], trainingReadiness: 'INSUFFICIENT_DATA' }
  });
  const [systemSettings, setSystemSettings] = useState({
    activityRefreshSeconds: 30,
    reportsAutoRefreshSeconds: 60,
    stuckOrderHours: 24,
    overdueGraceHours: 0,
    lowQualityScoreThreshold: 70,
    highlightRejections: true
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [healthData, setHealthData] = useState(null);

  const panelClass = 'rounded-2xl border border-[#d9d1c3] bg-white/95 shadow-[0_8px_24px_rgba(34,42,54,0.08)] p-6';
  const subtlePanelClass = 'rounded-xl border border-[#e5ded2] bg-[#fbf9f4] p-4';
  const statCardClass = 'rounded-xl border border-[#dfd6c7] bg-[#fcfaf5] px-4 py-3 shadow-sm';
  const tableHeadClass = 'bg-[#f0e7d8] text-[#30404d]';
  const inputClass = 'w-full rounded-xl border border-[#cfc5b4] bg-white px-3 py-2 text-sm text-[#1e2b37] outline-none transition focus:border-[#2d5a66] focus:ring-2 focus:ring-[#2d5a66]/20';
  const primaryButtonClass = 'rounded-xl bg-[#2d5a66] px-4 py-2 text-white font-semibold transition hover:bg-[#234a54] disabled:bg-gray-400';
  const secondaryButtonClass = 'rounded-xl bg-[#5f6f52] px-4 py-2 text-white font-semibold transition hover:bg-[#4f5e45] disabled:bg-gray-400';
  const dangerButtonClass = 'rounded-xl bg-[#b94f3f] px-4 py-2 text-white font-semibold transition hover:bg-[#9f4234] disabled:bg-gray-400';
  const navButtonClass = (tab) => `block w-full text-left rounded-xl px-3 py-3 text-sm font-semibold transition ${activeTab === tab ? 'bg-[#e7d8be] text-[#172635]' : 'text-[#f3f4f6] hover:bg-[#1c2940]'}`;

  const dashboardCards = useMemo(() => {
    const employeeByRole = employees.reduce((acc, emp) => {
      acc[emp.role] = (acc[emp.role] || 0) + 1;
      return acc;
    }, {});

    return {
      totalEmployees: employees.length,
      totalOrders: orders.length,
      inProgress: orders.filter((o) => String(o.status).includes('IN_PROGRESS')).length,
      completed: orders.filter((o) => o.status === 'COMPLETED').length,
      rejectedToday: rejectionStats.summary?.rejectedToday || 0,
      rejectionRateThisWeek: rejectionStats.summary?.rejectionRateThisWeek || 0,
      employeeByRole
    };
  }, [employees, orders, rejectionStats]);

  const activeEmployees = useMemo(() => employees.filter((e) => e.isActive), [employees]);
  const leftCompanyEmployees = useMemo(() => employees.filter((e) => !e.isActive), [employees]);

  const filteredActiveEmployees = useMemo(() => {
    const query = employeeSearchQuery.trim().toLowerCase();
    if (!query) return activeEmployees;

    return activeEmployees.filter((emp) => {
      const haystack = `${emp.empId || ''} ${emp.name || ''} ${emp.role || ''} ${emp.designation || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [activeEmployees, employeeSearchQuery]);

  const filteredLeftCompanyEmployees = useMemo(() => {
    const query = employeeSearchQuery.trim().toLowerCase();
    if (!query) return leftCompanyEmployees;

    return leftCompanyEmployees.filter((emp) => {
      const haystack = `${emp.empId || ''} ${emp.name || ''} ${emp.role || ''} ${emp.designation || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [leftCompanyEmployees, employeeSearchQuery]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (orderFilters.status && order.status !== orderFilters.status) return false;
      if (orderFilters.size && order.size !== orderFilters.size) return false;
      return true;
    });
  }, [orders, orderFilters]);

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
      await Promise.all([refreshAdminData(), loadOpenIssues()]);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to resolve reported issue');
    } finally {
      setIssueActionLoadingId('');
    }
  };

  const refreshAdminData = async () => {
    try {
      const [employeeRes, orderRes, activityRes, rejectionRes, issueRes] = await Promise.all([
        api.get('/employees?limit=300'),
        api.get('/orders?limit=300'),
        api.get('/activity?limit=100'),
        api.get('/orders/rejection-stats'),
        api.get('/orders/reported-issues?status=open&limit=200')
      ]);

      setEmployees(employeeRes.data.data || []);
      setOrders(orderRes.data.data.items || []);
      setActivities(activityRes.data.data.items || []);
      setRejectionStats(rejectionRes.data?.data || {
        summary: { rejectedToday: 0, rejectionRateThisWeek: 0 },
        employeeStats: [],
        managerStats: []
      });
      setOpenIssues(issueRes.data?.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load admin data');
    }
  };

  const handleDeactivate = async (employeeId) => {
    try {
      await api.patch(`/employees/${employeeId}/deactivate`);
      await refreshAdminData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to deactivate employee');
    }
  };

  const handleReactivate = async (employeeId) => {
    try {
      await api.patch(`/employees/${employeeId}/reactivate`);
      await refreshAdminData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reactivate employee');
    }
  };

  const handleDelete = async (employeeId) => {
    const ok = window.confirm('Delete this employee permanently?');
    if (!ok) return;
    try {
      await api.delete(`/employees/${employeeId}`);
      await refreshAdminData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete employee');
    }
  };

  const handleResetCredential = async (employeeId) => {
    const newCredential = window.prompt('Enter new password/PIN for this employee:');
    if (!newCredential) return;
    try {
      await api.patch(`/employees/${employeeId}/reset-credential`, { newCredential });
      setMessage('Credential reset successfully');
      await refreshAdminData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset credential');
    }
  };

  const handleChangeRole = async (employeeId, role) => {
    try {
      await api.patch(`/employees/${employeeId}/role`, { role });
      await refreshAdminData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to change role');
    }
  };

  const handleManualEmployeeAdd = async (e) => {
    e.preventDefault();
    try {
      setError('');
      setMessage('');
      setLoading(true);

      const payload = {
        empId: manualEmployee.empId,
        name: manualEmployee.name,
        designation: manualEmployee.designation,
        role: manualEmployee.role || undefined
      };

      const response = await api.post('/employees', payload);
      setMessage(response.data.message || 'Employee added successfully');
      setManualEmployee({ empId: '', name: '', designation: '', role: '' });
      await refreshAdminData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add employee manually');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAdminData();
  }, []);

  useEffect(() => {
    if (activeTab === 'reports') {
      loadReports();
    }
  }, [activeTab, reportFilters]);

  useEffect(() => {
    if (activeTab === 'settings') {
      loadSettings();
      refreshHealth();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'activity') return undefined;
    const id = setInterval(() => {
      api.get('/activity?limit=100')
        .then((response) => setActivities(response.data.data.items || []))
        .catch(() => {});
    }, Math.max((systemSettings.activityRefreshSeconds || 30) * 1000, 10000));
    return () => clearInterval(id);
  }, [activeTab, systemSettings.activityRefreshSeconds]);

  const loadSettings = async () => {
    try {
      setSettingsLoading(true);
      const response = await api.get('/admin/settings');
      setSystemSettings((prev) => ({ ...prev, ...(response.data?.data?.settings || {}) }));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load system settings');
    } finally {
      setSettingsLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setSettingsSaving(true);
      setError('');
      setMessage('');
      const payload = {
        settings: {
          activityRefreshSeconds: Number(systemSettings.activityRefreshSeconds),
          reportsAutoRefreshSeconds: Number(systemSettings.reportsAutoRefreshSeconds),
          stuckOrderHours: Number(systemSettings.stuckOrderHours),
          overdueGraceHours: Number(systemSettings.overdueGraceHours),
          lowQualityScoreThreshold: Number(systemSettings.lowQualityScoreThreshold),
          highlightRejections: Boolean(systemSettings.highlightRejections)
        }
      };
      const response = await api.put('/admin/settings', payload);
      setSystemSettings((prev) => ({ ...prev, ...(response.data?.data?.settings || {}) }));
      setMessage('System settings saved successfully');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  const refreshHealth = async () => {
    try {
      const response = await api.get('/health');
      setHealthData(response.data?.data || null);
    } catch (err) {
      setHealthData({ status: 'error', db: 'disconnected', timestamp: new Date().toISOString(), uptime: 0 });
    }
  };

  const loadReports = async () => {
    try {
      setReportLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (reportFilters.fromDate) params.set('fromDate', reportFilters.fromDate);
      if (reportFilters.toDate) params.set('toDate', reportFilters.toDate);
      if (reportFilters.role) params.set('role', reportFilters.role);
      if (reportFilters.articleType) params.set('articleType', reportFilters.articleType);

      const query = params.toString();
      const suffix = query ? `?${query}` : '';

      const [pipelineRes, performanceRes, rejectionRes, batchRes, dailyRes, mlSummaryRes] = await Promise.all([
        api.get(`/reports/pipeline${suffix}`),
        api.get(`/reports/employee-performance${suffix ? `${suffix}&limit=100` : '?limit=100'}`),
        api.get(`/reports/rejection-analysis${suffix}`),
        api.get(`/reports/batch${suffix ? `${suffix}&limit=100` : '?limit=100'}`),
        api.get('/reports/daily-summary'),
        api.get('/admin/ml-export/summary')
      ]);

      setReportData({
        pipeline: pipelineRes.data?.data || { statusCounts: [], avgTimeByStageHours: {}, totalOrders: 0, completedToday: 0 },
        performance: performanceRes.data?.data || { items: [] },
        rejection: rejectionRes.data?.data || { byCategory: [], topEmployees: [], topBatches: [], totalRejections: 0, averageResolutionHours: 0 },
        batch: batchRes.data?.data || { items: [] },
        daily: dailyRes.data?.data || { ordersCompletedToday: 0, ordersStartedToday: 0, rejectionsToday: 0, employeesActiveToday: 0, overdueOrders: [] },
        mlSummary: mlSummaryRes.data?.data || { totalAssignments: 0, completedAssignments: 0, completionRatio: 0, totalRejections: 0, assignmentsByRole: [], trainingReadiness: 'INSUFFICIENT_DATA' }
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load reports');
    } finally {
      setReportLoading(false);
    }
  };

  const parseCsvRows = (rawCsv) => {
    const lines = rawCsv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length <= 1) return [];

    return lines.slice(1).map((line, index) => {
      const parts = line.split(',').map((part) => part.trim());
      return {
        rowNo: index + 2,
        empId: parts[0] || '',
        name: parts[1] || '',
        designation: parts.slice(2).join(', ') || ''
      };
    });
  };

  const previewRows = parseCsvRows(csvContent);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setCsvContent(text);
    setHasConfirmed(false);
    setPreview(null);
    setError('');
    setMessage('');

    // Allow selecting the same file again to refresh content after external edits.
    event.target.value = '';
  };

  const handlePreview = async () => {
    try {
      setLoading(true);
      setError('');
      setMessage('');
      setHasConfirmed(false);

      const response = await api.post('/employees/csv-preview', { csvContent });
      setPreview(response.data.data);
      setMessage('CSV preview generated. Review and confirm below.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to preview CSV');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    if (hasConfirmed) {
      setError('This preview is already imported. Click Preview CSV again after editing CSV content.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setMessage('');

      const payload = {
        confirmations: {
          newEmployees: preview.newEmployees || [],
          updatedEmployees: preview.updatedEmployees || [],
          flaggedEmployees: (preview.flaggedEmployees || []).map((item) => ({
            ...item,
            action: item.issue === 'MISSING_FROM_CSV' ? 'KEEP_ACTIVE' : 'KEEP_ACTIVE'
          }))
        }
      };

      const response = await api.post('/employees/csv-confirm', payload);
      setMessage(response.data.message || 'CSV import completed');
      setHasConfirmed(true);
      await refreshAdminData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to confirm CSV import');
      setHasConfirmed(false);
    } finally {
      setLoading(false);
    }
  };

  const renderReports = () => {
    if (reportLoading) {
      return (
        <div className={`mt-6 ${panelClass}`}>
          <h3 className="text-xl font-bold mb-3">Advanced Reports</h3>
          <LoadingSkeleton rows={8} />
        </div>
      );
    }

    const maxCount = Math.max(...(reportData.pipeline.statusCounts || []).map((row) => row.count || 0), 1);

    return (
      <div className="mt-6 space-y-6">
        <div className={panelClass}>
          <h3 className="text-xl font-bold mb-3">Advanced Reports</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
            <input type="date" value={reportFilters.fromDate} onChange={(e) => setReportFilters((p) => ({ ...p, fromDate: e.target.value }))} className="border rounded p-2" />
            <input type="date" value={reportFilters.toDate} onChange={(e) => setReportFilters((p) => ({ ...p, toDate: e.target.value }))} className="border rounded p-2" />
            <select value={reportFilters.role} onChange={(e) => setReportFilters((p) => ({ ...p, role: e.target.value }))} className="border rounded p-2">
              <option value="">All Roles</option>
              <option value="FABRIC_MAN">FABRIC_MAN</option>
              <option value="CUTTER">CUTTER</option>
              <option value="TAILOR">TAILOR</option>
              <option value="SUPERVISOR">SUPERVISOR</option>
            </select>
            <input type="text" value={reportFilters.articleType} onChange={(e) => setReportFilters((p) => ({ ...p, articleType: e.target.value }))} placeholder="Article type" className="border rounded p-2" />
            <button type="button" onClick={loadReports} disabled={reportLoading} className="bg-gray-700 text-white rounded p-2 disabled:bg-gray-400">{reportLoading ? 'Loading...' : 'Refresh'}</button>
          </div>
        </div>

        <div className={panelClass}>
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-bold text-lg">Order Pipeline Overview</h4>
            <button
              type="button"
              onClick={() => downloadCsv('admin-pipeline-report.csv', reportData.pipeline.statusCounts || [], [
                { key: 'status', label: 'Status' },
                { key: 'count', label: 'Count' }
              ])}
              className="bg-blue-600 text-white px-3 py-2 rounded text-sm"
            >
              Export CSV
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-3">Total Orders: {reportData.pipeline.totalOrders} | Completed Today: {reportData.pipeline.completedToday}</p>
          <div className="space-y-2">
            {(reportData.pipeline.statusCounts || []).map((row) => (
              <div key={row.status}>
                <div className="flex justify-between text-sm"><span>{row.status}</span><span>{row.count}</span></div>
                <div className="h-2 bg-gray-200 rounded"><div className="h-2 bg-blue-600 rounded" style={{ width: `${(row.count / maxCount) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className={panelClass}>
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-bold text-lg">Employee Performance Report</h4>
            <button
              type="button"
              onClick={() => downloadCsv('admin-employee-performance.csv', reportData.performance.items || [], [
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
              className="bg-blue-600 text-white px-3 py-2 rounded text-sm"
            >
              Export CSV
            </button>
          </div>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-[#e1d8c9] bg-white">
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
                  <tr key={row.employeeId} className="border-b">
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
          <h4 className="font-bold text-lg mb-3">Rejection Analysis Report</h4>
          <p className="text-sm text-gray-700 mb-2">Total Rejections: {reportData.rejection.totalRejections} | Average Resolution: {reportData.rejection.averageResolutionHours}h</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
            {(reportData.rejection.byCategory || []).map((row) => (
              <div key={row.category} className="p-3 rounded bg-red-50 border border-red-200">
                <p className="font-semibold">{row.category}</p>
                <p>{row.count}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={panelClass}>
          <h4 className="font-bold text-lg mb-3">Batch Report</h4>
          <div className="overflow-x-auto max-h-[340px] overflow-y-auto rounded-xl border border-[#e1d8c9] bg-white">
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
                  <tr key={row.batchId} className="border-b">
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
          <h4 className="font-bold text-lg mb-3">Daily Activity Summary</h4>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
            <div className={`${statCardClass} bg-green-50 border-green-200`}>Orders completed today: {reportData.daily.ordersCompletedToday}</div>
            <div className={`${statCardClass} bg-blue-50 border-blue-200`}>Orders started today: {reportData.daily.ordersStartedToday}</div>
            <div className={`${statCardClass} bg-red-50 border-red-200`}>Rejections today: {reportData.daily.rejectionsToday}</div>
            <div className={`${statCardClass} bg-[#f1eee7] border-[#d8d0c4]`}>Employees active today: {reportData.daily.employeesActiveToday}</div>
            <div className={`${statCardClass} bg-yellow-50 border-yellow-200`}>Overdue orders: {(reportData.daily.overdueOrders || []).length}</div>
          </div>
        </div>

        <div className={panelClass}>
          <h4 className="font-bold text-lg mb-3">ML Export Summary</h4>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
            <div className={`${statCardClass} bg-[#f1eee7] border-[#d8d0c4]`}>Total Assignments: {reportData.mlSummary.totalAssignments}</div>
            <div className={`${statCardClass} bg-[#f1eee7] border-[#d8d0c4]`}>Completed Assignments: {reportData.mlSummary.completedAssignments}</div>
            <div className={`${statCardClass} bg-[#f1eee7] border-[#d8d0c4]`}>Completion Ratio: {reportData.mlSummary.completionRatio}</div>
            <div className={`${statCardClass} bg-[#f1eee7] border-[#d8d0c4]`}>Total Rejections: {reportData.mlSummary.totalRejections}</div>
            <div className={`${statCardClass} bg-[#f1eee7] border-[#d8d0c4]`}>Training Readiness: {reportData.mlSummary.trainingReadiness}</div>
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => window.open('/api/admin/ml-export?format=csv', '_blank')}
              className={primaryButtonClass}
            >
              Download ML Export CSV
            </button>
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
        <aside className="w-72 shrink-0 rounded-2xl bg-[#0f1b33] text-white p-6 shadow-[0_10px_30px_rgba(15,27,51,0.35)]">
          <nav className="space-y-4">
            <h3 className="text-xs font-bold tracking-[0.18em] text-[#d6cdbf] uppercase mb-6">Navigation</h3>
            <button type="button" onClick={() => setActiveTab('dashboard')} className={navButtonClass('dashboard')}>Dashboard</button>
            <button type="button" onClick={() => setActiveTab('employees')} className={navButtonClass('employees')}>Employee Management</button>
            <button type="button" onClick={() => setActiveTab('orders')} className={navButtonClass('orders')}>Order Management</button>
            <button type="button" onClick={() => setActiveTab('activity')} className={navButtonClass('activity')}>Full Activity Log</button>
            <button type="button" onClick={() => setActiveTab('reports')} className={navButtonClass('reports')}>Reports</button>
            <button type="button" onClick={() => setActiveTab('settings')} className={navButtonClass('settings')}>System Settings</button>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1">
          <div className={`${panelClass} mb-6 bg-[linear-gradient(120deg,_#ffffff_0%,_#f8f4ec_100%)]`}>
            <p className="text-xs uppercase tracking-[0.2em] text-[#7f7364] font-semibold mb-2">Garment Operations</p>
            <h2 className="text-3xl font-bold mb-3 text-[#132130]">
              {t('portals.admin')}
            </h2>
            <p className="text-[#4f5a66]">
              Company-wide controls, reporting, user administration, and system settings.
            </p>
          </div>

          {activeTab === 'employees' && <div className={panelClass}>
            <h3 className="text-xl font-bold text-[#132130] mb-4">Employee CSV Import</h3>

            {error && <div className="mb-4 p-3 rounded-xl bg-[#fff1ef] text-[#a93d30] border border-[#e9b5ad]">{error}</div>}
            {message && <div className="mb-4 p-3 rounded-xl bg-[#edf7f1] text-[#286040] border border-[#b9dcbc]">{message}</div>}

            <div className="mb-4">
              <label className="block text-sm font-semibold text-[#37424f] mb-2">Upload CSV File</label>
              <input type="file" accept=".csv" onChange={handleFileUpload} className={inputClass} />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">CSV Content</label>
              <textarea
                value={csvContent}
                onChange={(e) => {
                  setCsvContent(e.target.value);
                  setHasConfirmed(false);
                }}
                rows={8}
                className={`${inputClass} font-mono`}
                placeholder="EmpID,Name,Designation"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handlePreview}
                disabled={loading}
                className={primaryButtonClass}
              >
                {loading ? 'Processing...' : 'Preview CSV'}
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading || !preview || hasConfirmed}
                className={secondaryButtonClass}
              >
                {hasConfirmed ? 'Already Imported' : 'Confirm Import'}
              </button>
            </div>

            {preview && activeTab === 'employees' && (
              <div className="mt-6 border-t pt-4">
                <h4 className="font-bold text-gray-800 mb-3">Preview Summary</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                  <div className={`${statCardClass} bg-blue-50 border-blue-200`}>New: {preview.summary?.newEmployees || 0}</div>
                  <div className={`${statCardClass} bg-yellow-50 border-yellow-200`}>Updated: {preview.summary?.updatedEmployees || 0}</div>
                  <div className={`${statCardClass} bg-[#f1eee7] border-[#d8d0c4]`}>Already Exists: {preview.summary?.unchangedEmployees || 0}</div>
                  <div className={`${statCardClass} bg-red-50 border-red-200`}>Flagged: {preview.summary?.flaggedEmployees || 0}</div>
                </div>

                <div className="mb-5">
                  <h5 className="font-semibold text-gray-800 mb-2">Final CSV Rows to Process ({previewRows.length})</h5>
                  <div className="border border-[#e1d8c9] rounded-xl overflow-hidden max-h-64 overflow-y-auto bg-white">
                    <table className="w-full text-sm">
                      <thead className={`${tableHeadClass} sticky top-0`}>
                        <tr>
                          <th className="text-left p-2">Row</th>
                          <th className="text-left p-2">Emp ID</th>
                          <th className="text-left p-2">Name</th>
                          <th className="text-left p-2">Designation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row) => (
                          <tr key={`${row.rowNo}-${row.empId}`} className="border-t">
                            <td className="p-2 text-gray-500">{row.rowNo}</td>
                            <td className="p-2 font-mono">{row.empId}</td>
                            <td className="p-2">{row.name}</td>
                            <td className="p-2">{row.designation}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className={subtlePanelClass}>
                    <h5 className="font-semibold mb-2">New Employees</h5>
                    <div className="max-h-40 overflow-y-auto text-sm space-y-1">
                      {(preview.newEmployees || []).length === 0 && <div className="text-gray-500">None</div>}
                      {(preview.newEmployees || []).map((emp) => (
                        <div key={`new-${emp.empId}`} className="border-b pb-1">
                          <div className="font-mono">{emp.empId}</div>
                          <div>{emp.name}</div>
                          <div className="text-gray-500">{emp.designation}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={subtlePanelClass}>
                    <h5 className="font-semibold mb-2">Updated Employees</h5>
                    <div className="max-h-40 overflow-y-auto text-sm space-y-1">
                      {(preview.updatedEmployees || []).length === 0 && <div className="text-gray-500">None</div>}
                      {(preview.updatedEmployees || []).map((emp) => (
                        <div key={`updated-${emp.empId}`} className="border-b pb-1">
                          <div className="font-mono">{emp.empId}</div>
                          <div>{emp.name}</div>
                          <div className="text-gray-500">{emp.designation}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={subtlePanelClass}>
                    <h5 className="font-semibold mb-2">Already Exists</h5>
                    <div className="max-h-40 overflow-y-auto text-sm space-y-1">
                      {(preview.unchangedEmployees || []).length === 0 && <div className="text-gray-500">None</div>}
                      {(preview.unchangedEmployees || []).map((emp) => (
                        <div key={`unchanged-${emp.empId}`} className="border-b pb-1">
                          <div className="font-mono">{emp.empId}</div>
                          <div>{emp.name}</div>
                          <div className="text-gray-500">{emp.designation}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={subtlePanelClass}>
                    <h5 className="font-semibold mb-2">Flagged Employees</h5>
                    <div className="max-h-40 overflow-y-auto text-sm space-y-1">
                      {(preview.flaggedEmployees || []).length === 0 && <div className="text-gray-500">None</div>}
                      {(preview.flaggedEmployees || []).map((emp, idx) => (
                        <div key={`flagged-${emp.empId || idx}`} className="border-b pb-1">
                          <div className="font-mono">{emp.empId || 'N/A'}</div>
                          <div>{emp.name || 'No Name'}</div>
                          <div className="text-red-600">{emp.issue || 'Review required'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>}

          {activeTab === 'dashboard' && (
            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div className={statCardClass}><p className="text-sm text-gray-500">Total Active Employees</p><p className="text-2xl font-bold">{dashboardCards.totalEmployees}</p></div>
              <div className={statCardClass}><p className="text-sm text-gray-500">Total Orders</p><p className="text-2xl font-bold">{dashboardCards.totalOrders}</p></div>
              <div className={statCardClass}><p className="text-sm text-gray-500">In Progress</p><p className="text-2xl font-bold">{dashboardCards.inProgress}</p></div>
              <div className={statCardClass}><p className="text-sm text-gray-500">Completed</p><p className="text-2xl font-bold">{dashboardCards.completed}</p></div>
              <div className={`${statCardClass} border-red-200 bg-red-50`}><p className="text-sm text-gray-500">Orders Rejected Today</p><p className="text-2xl font-bold text-red-600">{dashboardCards.rejectedToday}</p></div>
              <div className={`${statCardClass} border-red-200 bg-red-50`}><p className="text-sm text-gray-500">Rejection Rate This Week</p><p className="text-2xl font-bold text-red-600">{dashboardCards.rejectionRateThisWeek}%</p></div>
              </div>

              <div className={panelClass}>
                <h3 className="text-xl font-bold mb-3">Rejections by Employee</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className={tableHeadClass}>
                      <tr>
                        <th className="p-2 text-left">Employee</th>
                        <th className="p-2 text-left">Role</th>
                        <th className="p-2 text-left">Total Rejections</th>
                        <th className="p-2 text-left">Handled Orders</th>
                        <th className="p-2 text-left">Rejection Rate %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rejectionStats.employeeStats || []).slice(0, 15).map((row) => (
                        <tr key={`${row.employeeId}-${row.role}`} className="border-b">
                          <td className="p-2">{row.employeeName} ({row.empId})</td>
                          <td className="p-2">{row.role}</td>
                          <td className="p-2">{row.totalRejections}</td>
                          <td className="p-2">{row.handledCount}</td>
                          <td className="p-2">{row.rejectionRate}%</td>
                        </tr>
                      ))}
                      {(rejectionStats.employeeStats || []).length === 0 && (
                        <tr>
                          <td className="p-2 text-gray-500" colSpan={5}>No rejection data available.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={panelClass}>
                <h3 className="text-xl font-bold mb-3">Manager Batch Rejection Summary</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className={tableHeadClass}>
                      <tr>
                        <th className="p-2 text-left">Manager</th>
                        <th className="p-2 text-left">Emp ID</th>
                        <th className="p-2 text-left">Total Rejections</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rejectionStats.managerStats || []).map((row) => (
                        <tr key={row.managerId} className="border-b">
                          <td className="p-2">{row.managerName}</td>
                          <td className="p-2 font-mono">{row.managerEmpId}</td>
                          <td className="p-2">{row.totalRejections}</td>
                        </tr>
                      ))}
                      {(rejectionStats.managerStats || []).length === 0 && (
                        <tr>
                          <td className="p-2 text-gray-500" colSpan={3}>No manager rejection data available.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'employees' && (
              <div className={`mt-6 ${panelClass}`}>
              <h3 className="text-xl font-bold mb-3">Employees</h3>
              <form onSubmit={handleManualEmployeeAdd} className={`mb-4 ${subtlePanelClass}`}>
                <h4 className="font-semibold mb-3">Manual Add Employee</h4>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
                  <input
                    value={manualEmployee.empId}
                    onChange={(e) => setManualEmployee((p) => ({ ...p, empId: e.target.value }))}
                    placeholder="Emp ID (e.g. 1421 or EMP-001)"
                    className={inputClass}
                    required
                  />
                  <input
                    value={manualEmployee.name}
                    onChange={(e) => setManualEmployee((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Employee Name"
                    className={inputClass}
                    required
                  />
                  <input
                    value={manualEmployee.designation}
                    onChange={(e) => setManualEmployee((p) => ({ ...p, designation: e.target.value }))}
                    placeholder="Designation"
                    className={inputClass}
                    required
                  />
                  <select
                    value={manualEmployee.role}
                    onChange={(e) => setManualEmployee((p) => ({ ...p, role: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Auto map by designation</option>
                    {['ADMIN', 'MANAGER', 'FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR'].map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                  <button type="submit" disabled={loading} className={`${primaryButtonClass} rounded-xl`}>
                    Add Employee
                  </button>
                </div>
              </form>

              <div className="flex gap-2 mb-3 text-sm">
                <button type="button" onClick={() => setEmployeeTab('active')} className={`px-3 py-2 rounded-xl font-semibold ${employeeTab === 'active' ? 'bg-[#2d5a66] text-white' : 'bg-[#ece6da] text-[#2d3a48]'}`}>Active Employees</button>
                <button type="button" onClick={() => setEmployeeTab('left')} className={`px-3 py-2 rounded-xl font-semibold ${employeeTab === 'left' ? 'bg-[#2d5a66] text-white' : 'bg-[#ece6da] text-[#2d3a48]'}`}>Left Company / Inactive</button>
              </div>
              <div className="mb-3">
                <input
                  type="text"
                  value={employeeSearchQuery}
                  onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                  placeholder="Search employee by EmpID, name, role or designation"
                  className={inputClass}
                />
              </div>
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className={`${tableHeadClass} sticky top-0`}>
                    <tr>
                      <th className="p-2 text-left">EmpID</th>
                      <th className="p-2 text-left">Name</th>
                      <th className="p-2 text-left">Role</th>
                      <th className="p-2 text-left">Status</th>
                      <th className="p-2 text-left">Last Login</th>
                      <th className="p-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(employeeTab === 'active' ? filteredActiveEmployees : filteredLeftCompanyEmployees).map((emp) => (
                      <tr key={emp.id} className="border-b">
                        <td className="p-2 font-mono">{emp.empId}</td>
                        <td className="p-2">{emp.name}</td>
                        <td className="p-2">{emp.role}</td>
                        <td className="p-2">{emp.isActive ? 'Active' : 'Inactive'}</td>
                        <td className="p-2">{emp.lastLogin ? new Date(emp.lastLogin).toLocaleString() : 'Never'}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            <button type="button" onClick={() => handleResetCredential(emp.id)} className="px-2 py-1 text-xs bg-[#355070] text-white rounded-lg">Reset</button>
                            {emp.isActive ? (
                              <button type="button" onClick={() => handleDeactivate(emp.id)} className="px-2 py-1 text-xs bg-[#9b7b3f] text-white rounded-lg">Deactivate</button>
                            ) : (
                              <button type="button" onClick={() => handleReactivate(emp.id)} className="px-2 py-1 text-xs bg-[#4f7a51] text-white rounded-lg">Reactivate</button>
                            )}
                            <button type="button" onClick={() => handleDelete(emp.id)} className="px-2 py-1 text-xs bg-[#b94f3f] text-white rounded-lg">Delete</button>
                            <select
                              value={emp.role}
                              onChange={(e) => handleChangeRole(emp.id, e.target.value)}
                              className={`${inputClass} text-xs px-2 py-1`}
                            >
                              {['ADMIN', 'MANAGER', 'FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR'].map((role) => (
                                <option key={role} value={role}>{role}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(employeeTab === 'active' ? filteredActiveEmployees : filteredLeftCompanyEmployees).length === 0 && (
                      <tr>
                        <td className="p-2 text-gray-500" colSpan={6}>No employees found for this search.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'orders' && (
            <div className={`mt-6 ${panelClass}`}>
              <h3 className="text-xl font-bold mb-3">Order Management</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3 text-sm">
                <select value={orderFilters.status} onChange={(e) => setOrderFilters((p) => ({ ...p, status: e.target.value }))} className={inputClass}>
                  <option value="">All Status</option>
                  {[...new Set(orders.map((o) => o.status))].map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <select value={orderFilters.size} onChange={(e) => setOrderFilters((p) => ({ ...p, size: e.target.value }))} className={inputClass}>
                  <option value="">All Size</option>
                  <option value="SMALL">SMALL</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LARGE">LARGE</option>
                </select>
              </div>
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className={`${tableHeadClass} sticky top-0`}>
                    <tr>
                      <th className="p-2 text-left">Order Code</th>
                      <th className="p-2 text-left">Size</th>
                      <th className="p-2 text-left">Status</th>
                      <th className="p-2 text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => (
                      <tr key={order.id} className="border-b">
                        <td className="p-2 font-mono">{order.orderCode}</td>
                        <td className="p-2">{order.size}</td>
                        <td className="p-2">{order.status}</td>
                        <td className="p-2">{new Date(order.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className={`mt-6 ${panelClass}`}>
              <h3 className="text-xl font-bold mb-3">Company Activity Log</h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3 text-sm">
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
                  {[...new Set(activities.map((a) => a.action))].map((action) => <option key={action} value={action}>{action}</option>)}
                </select>
                <input type="date" value={activityFilters.fromDate} onChange={(e) => setActivityFilters((p) => ({ ...p, fromDate: e.target.value }))} className={inputClass} />
                <input type="date" value={activityFilters.toDate} onChange={(e) => setActivityFilters((p) => ({ ...p, toDate: e.target.value }))} className={inputClass} />
              </div>

              <div className={`${subtlePanelClass} mb-4`}>
                <h4 className="font-bold text-[#1f2d3a] mb-2">Reported Orders ({openIssues.length})</h4>
                <div className="overflow-x-auto max-h-[260px] overflow-y-auto rounded-xl border border-[#e1d8c9] bg-white">
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

              <div className="space-y-2 max-h-[420px] overflow-y-auto">
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
          )}

          {activeTab === 'settings' && (
            <div className={`mt-6 ${panelClass}`}>
              <h3 className="text-xl font-bold mb-3">System Settings</h3>
              {settingsLoading ? (
                <LoadingSkeleton rows={4} />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <label className="block">
                      <span className="block mb-1 font-semibold">Activity Auto-Refresh (seconds)</span>
                      <input
                        type="number"
                        min={10}
                        max={300}
                        value={systemSettings.activityRefreshSeconds}
                        onChange={(e) => setSystemSettings((prev) => ({ ...prev, activityRefreshSeconds: e.target.value }))}
                        className={inputClass}
                      />
                    </label>

                    <label className="block">
                      <span className="block mb-1 font-semibold">Reports Auto-Refresh (seconds)</span>
                      <input
                        type="number"
                        min={10}
                        max={600}
                        value={systemSettings.reportsAutoRefreshSeconds}
                        onChange={(e) => setSystemSettings((prev) => ({ ...prev, reportsAutoRefreshSeconds: e.target.value }))}
                        className={inputClass}
                      />
                    </label>

                    <label className="block">
                      <span className="block mb-1 font-semibold">Stuck Order Threshold (hours)</span>
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={systemSettings.stuckOrderHours}
                        onChange={(e) => setSystemSettings((prev) => ({ ...prev, stuckOrderHours: e.target.value }))}
                        className={inputClass}
                      />
                    </label>

                    <label className="block">
                      <span className="block mb-1 font-semibold">Overdue Grace (hours)</span>
                      <input
                        type="number"
                        min={0}
                        max={168}
                        value={systemSettings.overdueGraceHours}
                        onChange={(e) => setSystemSettings((prev) => ({ ...prev, overdueGraceHours: e.target.value }))}
                        className={inputClass}
                      />
                    </label>

                    <label className="block">
                      <span className="block mb-1 font-semibold">Low Quality Score Threshold</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={systemSettings.lowQualityScoreThreshold}
                        onChange={(e) => setSystemSettings((prev) => ({ ...prev, lowQualityScoreThreshold: e.target.value }))}
                        className={inputClass}
                      />
                    </label>

                    <label className="flex items-center gap-2 mt-6">
                      <input
                        type="checkbox"
                        checked={Boolean(systemSettings.highlightRejections)}
                        onChange={(e) => setSystemSettings((prev) => ({ ...prev, highlightRejections: e.target.checked }))}
                      />
                      <span className="font-semibold">Highlight rejection activities in red</span>
                    </label>
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={saveSettings}
                      disabled={settingsSaving}
                      className={primaryButtonClass}
                    >
                      {settingsSaving ? 'Saving...' : 'Save Settings'}
                    </button>
                    <button
                      type="button"
                      onClick={loadSettings}
                      disabled={settingsSaving}
                      className={secondaryButtonClass}
                    >
                      Reload
                    </button>
                  </div>

                  <div className={`${subtlePanelClass} text-sm`}>
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">System Health</h4>
                      <button type="button" onClick={refreshHealth} className="text-blue-600 underline">Refresh</button>
                    </div>
                    <p className="mt-2">Status: <span className="font-semibold">{healthData?.status || 'unknown'}</span></p>
                    <p>Database: <span className="font-semibold">{healthData?.db || 'unknown'}</span></p>
                    <p>Server Time: {healthData?.timestamp ? new Date(healthData.timestamp).toLocaleString() : '-'}</p>
                    <p>Uptime: {healthData?.uptime ?? '-'}s</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'reports' && renderReports()}
        </main>
      </div>
    </div>
  );
};

export default AdminPortal;
