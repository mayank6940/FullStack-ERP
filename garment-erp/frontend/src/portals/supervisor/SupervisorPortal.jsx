import React, { useEffect, useMemo, useState } from 'react';
import MobileLayout from '../../components/MobileLayout';
import ActionButton from '../../components/ActionButton';
import OrderCard from '../../components/OrderCard';
import CsvFieldList from '../../components/CsvFieldList';
import StatusBadge from '../../components/StatusBadge';
import SuccessScreen from '../../components/SuccessScreen';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';

const REJECTION_CATEGORY_OPTIONS = [
  { value: 'FABRIC_QUALITY', titleKey: 'supervisor.category.fabric' },
  { value: 'WRONG_CUT', titleKey: 'supervisor.category.cutting' },
  { value: 'STITCHING_ISSUE', titleKey: 'supervisor.category.stitching' },
  { value: 'OTHER', titleKey: 'supervisor.category.other' }
];

const REJECTION_REASON_SUGGESTIONS = {
  FABRIC_QUALITY: ['Wrong fabric used', 'Fabric quality poor', 'Wrong color'],
  WRONG_CUT: ['Cut too big', 'Cut too small', 'Uneven cut', 'Wrong pattern'],
  STITCHING_ISSUE: ['Loose stitching', 'Wrong stitch pattern', 'Unfinished seam', 'Wrong size'],
  OTHER: []
};

const SupervisorPortal = () => {
  const { t } = useLanguage();
  const [tab, setTab] = useState('pending');
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderRejections, setOrderRejections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassSuccess, setShowPassSuccess] = useState(false);

  const [rejectStep, setRejectStep] = useState(0);
  const [rejectCategory, setRejectCategory] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectRoute, setRejectRoute] = useState('TAILOR');

  const loadPending = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/supervisor/pending');
      setPending(response.data?.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.message || t('supervisor.pendingLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/supervisor/history');
      setHistory(response.data?.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.message || t('supervisor.historyLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  useEffect(() => {
    if (tab === 'history') {
      loadHistory();
    }
  }, [tab]);

  const openInspection = async (order) => {
    try {
      setSelectedOrder(order);
      setRejectStep(0);
      setRejectCategory('');
      setRejectReason('');
      setRejectRoute('TAILOR');
      const response = await api.get(`/orders/${order.id}/rejections`);
      setOrderRejections(response.data?.data?.items || []);
    } catch (err) {
      setOrderRejections([]);
      setError(err.response?.data?.message || t('supervisor.rejectionHistoryLoadFailed'));
    }
  };

  const handlePass = async () => {
    if (!selectedOrder?.id) return;
    const ok = window.confirm(t('supervisor.passConfirm'));
    if (!ok) return;

    try {
      setActionLoading(true);
      setError('');
      await api.post(`/orders/${selectedOrder.id}/pass`);
      setShowPassSuccess(true);
      setSelectedOrder(null);
      await loadPending();
    } catch (err) {
      setError(err.response?.data?.message || t('supervisor.passFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectConfirm = async () => {
    if (!selectedOrder?.id || !rejectCategory) return;
    try {
      setActionLoading(true);
      setError('');
      await api.post(`/orders/${selectedOrder.id}/reject`, {
        reasonCategory: rejectCategory,
        reason: rejectReason,
        routedTo: rejectCategory === 'OTHER' ? rejectRoute : undefined
      });
      setSelectedOrder(null);
      setRejectStep(0);
      setRejectCategory('');
      setRejectReason('');
      await loadPending();
    } catch (err) {
      setError(err.response?.data?.message || t('supervisor.rejectFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const pendingSummaryText = useMemo(() => {
    return t('supervisor.waitingSummary').replace('{count}', String(pending.length));
  }, [pending.length, t]);

  const rejectionWarningText = useMemo(() => {
    const count = orderRejections.length;
    if (count <= 0) return '';
    return t('supervisor.returnedCount').replace('{count}', String(count));
  }, [orderRejections.length, t]);

  const selectedSuggestions = REJECTION_REASON_SUGGESTIONS[rejectCategory] || [];
  const routedToLabel = rejectCategory === 'OTHER'
    ? rejectRoute
    : REJECTION_CATEGORY_OPTIONS.find((item) => item.value === rejectCategory)?.titleKey
      ? t(REJECTION_CATEGORY_OPTIONS.find((item) => item.value === rejectCategory).titleKey)
      : '-';

  if (showPassSuccess) {
    return (
      <MobileLayout role="SUPERVISOR">
        <SuccessScreen
          message={t('supervisor.passSuccess')}
          onBack={() => {
            setShowPassSuccess(false);
            setTab('pending');
          }}
        />
      </MobileLayout>
    );
  }

  return (
    <MobileLayout role="SUPERVISOR">
      <div className="space-y-4">
        <div className="bg-white rounded-xl shadow p-4">
          <p className="text-xl font-bold text-gray-900">{t('supervisor.qualityCheck')}</p>
          <p className="text-base text-gray-700 mt-1">{pendingSummaryText}</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <ActionButton label={t('supervisor.pendingTab')} onClick={() => setTab('pending')} variant={tab === 'pending' ? 'primary' : 'secondary'} />
          <ActionButton label={t('supervisor.historyTab')} onClick={() => setTab('history')} variant={tab === 'history' ? 'primary' : 'secondary'} />
          <ActionButton label={t('worker.refresh')} onClick={tab === 'history' ? loadHistory : loadPending} variant="secondary" isLoading={loading} />
        </div>

        {error && <div className="p-3 rounded bg-red-100 text-red-700 text-base">{error}</div>}

        {selectedOrder ? (
          <div className="space-y-3">
            <div className="bg-white rounded-xl shadow p-4">
              <p className="text-xl font-bold break-all">{selectedOrder.orderCode}</p>
              <p className="text-lg text-gray-800 mt-1">{selectedOrder.details?.articleName || '-'}</p>
              <div className="mt-2"><StatusBadge status={selectedOrder.status} /></div>

              {orderRejections.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-yellow-100 text-yellow-900">
                  <p className="font-bold text-base">{rejectionWarningText}</p>
                  <p className="text-sm mt-1">{t('supervisor.previousReason')}: {orderRejections[0]?.reason || '-'}</p>
                </div>
              )}

              <div className="mt-4 border-t pt-4">
                <p className="text-sm font-bold text-gray-800 mb-2">All CSV Fields</p>
                <CsvFieldList
                  fields={selectedOrder.details?.companyFields || {}}
                />
              </div>

              <div className="mt-4 text-sm text-gray-700 space-y-1">
                <p>{t('supervisor.fabricMan')}: {(selectedOrder.workers?.fabric || []).map((w) => w.name).join(', ') || '-'}</p>
                <p>{t('supervisor.cutter')}: {(selectedOrder.workers?.cutter || []).map((w) => w.name).join(', ') || '-'}</p>
                <p>{t('supervisor.tailor')}: {(selectedOrder.workers?.tailor || []).map((w) => w.name).join(', ') || '-'}</p>
              </div>
            </div>

            {rejectStep === 0 && (
              <div className="space-y-2">
                <ActionButton label={t('supervisor.passButton')} onClick={handlePass} isLoading={actionLoading} variant="primary" />
                <ActionButton label={t('supervisor.rejectButton')} onClick={() => setRejectStep(1)} isLoading={false} variant="danger" />
                <ActionButton label={t('worker.back')} onClick={() => setSelectedOrder(null)} variant="secondary" />
              </div>
            )}

            {rejectStep === 1 && (
              <div className="bg-white rounded-xl shadow p-4 space-y-2">
                <p className="font-bold text-lg">{t('supervisor.selectCategory')}</p>
                {REJECTION_CATEGORY_OPTIONS.map((item) => (
                  <ActionButton
                    key={item.value}
                    label={t(item.titleKey)}
                    onClick={() => {
                      setRejectCategory(item.value);
                      setRejectStep(2);
                    }}
                    variant="secondary"
                  />
                ))}
                <ActionButton label={t('worker.back')} onClick={() => setRejectStep(0)} variant="secondary" />
              </div>
            )}

            {rejectStep === 2 && (
              <div className="bg-white rounded-xl shadow p-4 space-y-3">
                <p className="font-bold text-lg">{t('supervisor.describeProblem')}</p>
                {selectedSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setRejectReason(suggestion)}
                        className="px-3 py-2 rounded-full bg-gray-200 text-gray-900 text-sm"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}

                {rejectCategory === 'OTHER' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">{t('supervisor.routeTo')}</label>
                    <select
                      value={rejectRoute}
                      onChange={(e) => setRejectRoute(e.target.value)}
                      className="w-full border rounded p-2"
                    >
                      <option value="FABRIC_MAN">FABRIC_MAN</option>
                      <option value="CUTTER">CUTTER</option>
                      <option value="TAILOR">TAILOR</option>
                    </select>
                  </div>
                )}

                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={4}
                  className="w-full border rounded p-2"
                  placeholder={t('supervisor.reasonPlaceholder')}
                />

                <ActionButton label={t('supervisor.nextConfirm')} onClick={() => setRejectStep(3)} variant="primary" disabled={!rejectCategory} />
                <ActionButton label={t('worker.back')} onClick={() => setRejectStep(1)} variant="secondary" />
              </div>
            )}

            {rejectStep === 3 && (
              <div className="bg-white rounded-xl shadow p-4 space-y-3">
                <p className="font-bold text-lg">{t('supervisor.confirmRejection')}</p>
                <p className="text-base text-gray-800">{t('supervisor.sendingBackTo')}: <span className="font-semibold">{routedToLabel}</span></p>
                <p className="text-base text-gray-800">{t('supervisor.reasonLabel')}: <span className="font-semibold">{rejectReason || t('supervisor.noReasonProvided')}</span></p>

                <ActionButton label={t('supervisor.confirmRejectButton')} onClick={handleRejectConfirm} variant="danger" isLoading={actionLoading} />
                <ActionButton label={t('worker.back')} onClick={() => setRejectStep(2)} variant="secondary" />
              </div>
            )}
          </div>
        ) : (
          <>
            {tab === 'pending' && (
              <div className="space-y-3">
                {!loading && pending.length === 0 && (
                  <div className="p-3 rounded bg-gray-100 text-gray-700 text-base">{t('supervisor.noPending')}</div>
                )}
                {pending.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={{ ...order, status: 'QC_PENDING' }}
                    subtitle={`${t('supervisor.tailor')}: ${(order.workers?.tailor || []).map((w) => w.name).join(', ') || '-'}`}
                    onTap={() => openInspection(order)}
                  />
                ))}
              </div>
            )}

            {tab === 'history' && (
              <div className="space-y-3">
                {!loading && history.length === 0 && (
                  <div className="p-3 rounded bg-gray-100 text-gray-700 text-base">{t('supervisor.noHistory')}</div>
                )}
                {history.map((item) => (
                  <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-lg font-bold break-all">{item.orderCode}</p>
                      <span className={`px-3 py-1 rounded-full text-sm font-bold ${item.decision === 'PASS' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {item.decision}
                      </span>
                    </div>
                    <p className="text-base text-gray-700">{item.articleName || '-'}</p>
                    <p className="text-sm text-gray-600 mt-1">{new Date(item.inspectedAt).toLocaleString()}</p>
                    {item.decision === 'REJECT' && (
                      <p className="text-sm text-red-700 mt-1">{item.reasonCategory}: {item.reason || '-'}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </MobileLayout>
  );
};

export default SupervisorPortal;
