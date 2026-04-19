import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import ActionButton from './ActionButton';
import OrderCard from './OrderCard';
import IssueReportForm from './IssueReportForm';
import SuccessScreen from './SuccessScreen';
import StatusBadge from './StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import CsvFieldList from './CsvFieldList';

const WorkerPortalScreen = ({
  role,
  issueTypes,
  startStatuses,
  startToStatus,
  doneStatus,
  doneToStatus,
  startSuccessMessageKey = 'worker.workStarted',
  doneSuccessMessageKey,
  successMessageKey,
  subtitleGetter,
  titleKey
}) => {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [tab, setTab] = useState('home');
  const [orders, setOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({ totalCompleted: 0, totalReturned: 0, currentActive: 0 });
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [buttonLoading, setButtonLoading] = useState(false);
  const [error, setError] = useState('');
  const [successVisible, setSuccessVisible] = useState(false);
  const [successMessageToShow, setSuccessMessageToShow] = useState(doneSuccessMessageKey || successMessageKey);

  const loadHomeData = async () => {
    try {
      setLoading(true);
      setError('');
      const [ordersRes, statsRes] = await Promise.all([
        api.get('/worker/my-orders'),
        api.get('/worker/my-stats')
      ]);
      setOrders(ordersRes.data?.data?.items || []);
      setStats(statsRes.data?.data || { totalCompleted: 0, totalReturned: 0, currentActive: 0 });
    } catch (err) {
      setError(err.response?.data?.message || t('worker.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/worker/my-orders/history');
      setHistory(response.data?.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.message || t('worker.historyLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHomeData();
  }, [role]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab]);

  const summaryText = useMemo(() => {
    return t('worker.youHaveXOrders').replace('X', String(orders.length));
  }, [orders.length, t]);

  const performStatusUpdate = async (nextStatus, actionType = 'done') => {
    if (!selectedOrder?.id) return;
    try {
      setButtonLoading(true);
      setError('');
      await api.patch(`/orders/${selectedOrder.id}/status`, { newStatus: nextStatus });
      setSuccessMessageToShow(actionType === 'start' ? startSuccessMessageKey : (doneSuccessMessageKey || successMessageKey));
      setSuccessVisible(true);
      await loadHomeData();
    } catch (err) {
      setError(err.response?.data?.message || t('worker.statusUpdateFailed'));
    } finally {
      setButtonLoading(false);
    }
  };

  const canStart = selectedOrder && startStatuses.includes(selectedOrder.status);
  const canMarkDone = selectedOrder && selectedOrder.status === doneStatus;
  const isCompletedState = selectedOrder && selectedOrder.status === doneToStatus;
  const panelClass = 'rounded-2xl border border-[#d9d1c3] bg-white/95 shadow-[0_8px_20px_rgba(34,42,54,0.08)] p-4';
  const subtlePanelClass = 'rounded-xl border border-[#e5ded2] bg-[#fbf9f4] p-3';

  const getDisplayStatus = (order) => {
    if (!order?.status) return 'ASSIGNED';
    if (startStatuses.includes(order.status)) return 'ASSIGNED';
    if (order.status === doneStatus) return startToStatus;
    return order.status;
  };

  const getDedupedSubtitle = (order) => {
    if (!subtitleGetter) return '';

    const subtitle = String(subtitleGetter(order) || '').trim();
    if (!subtitle) return '';

    const articleName = String(order?.details?.articleName || '').trim();
    const products = String(order?.details?.companyFields?.Products || '').trim();
    const orderCode = String(order?.orderCode || '').trim();

    if (subtitle === articleName || subtitle === products || subtitle === orderCode) return '';
    return subtitle;
  };

  const getHandoffText = (order) => {
    const handoffFrom = order?.handoffFrom;
    if (!handoffFrom?.name) return '';

    const empIdPart = handoffFrom.empId ? ` (${handoffFrom.empId})` : '';
    return `Passed by: ${handoffFrom.name}${empIdPart}`;
  };

  const getCardSubtitle = (order) => {
    const base = getDedupedSubtitle(order);
    const handoff = getHandoffText(order);
    if (base && handoff) return `${base} | ${handoff}`;
    return base || handoff;
  };

  const detailView = selectedOrder && (
    <div className="space-y-3">
      <div className={panelClass}>
        <p className="text-lg font-bold text-[#132130] break-all">{selectedOrder.orderCode}</p>
        <p className="text-sm font-semibold text-[#2f3d4c] mt-1">{selectedOrder.details?.articleName || '-'}</p>

        {selectedOrder.isReturned && selectedOrder.latestRejection && (
          <div className="mt-3 p-3 rounded-xl bg-[#fff1ef] text-[#8a3d32] border border-[#efc3bc]">
            <p className="text-sm font-bold">{t('worker.rejectionReason')}</p>
            <p className="text-sm">{selectedOrder.latestRejection.reasonCategory}</p>
            <p className="text-sm">{selectedOrder.latestRejection.reason}</p>
          </div>
        )}

        <div className="mt-3">
          <StatusBadge status={getDisplayStatus(selectedOrder)} returned={selectedOrder.isReturned} />
        </div>

        <div className="mt-4 text-sm text-[#2b3a48] space-y-1">
          <p>{t('worker.colour')}: {selectedOrder.details?.companyFields?.Colour || '-'}</p>
          {getHandoffText(selectedOrder) && <p>{getHandoffText(selectedOrder)}</p>}
        </div>

        <div className="mt-4 border-t pt-4">
          <p className="text-sm font-bold text-[#132130] mb-2">All CSV Fields</p>
          <CsvFieldList
            fields={selectedOrder.details?.companyFields || {}}
          />
        </div>
      </div>

      <div className="space-y-2">
        {canStart && (
          <ActionButton
            label={t('worker.startWork')}
            onClick={() => performStatusUpdate(startToStatus, 'start')}
            isLoading={buttonLoading}
            variant="primary"
          />
        )}

        {canMarkDone && (
          <>
            <ActionButton
              label={t('worker.markDone')}
              onClick={() => performStatusUpdate(doneToStatus, 'done')}
              isLoading={buttonLoading}
              variant="primary"
            />
            <ActionButton
              label={t('worker.reportIssue')}
              onClick={() => setShowIssueForm(true)}
              isLoading={false}
              variant="danger"
            />
          </>
        )}

        {isCompletedState && (
          <div className="p-3 rounded-xl bg-[#e8f7ec] text-[#2c6940] text-base font-bold text-center border border-[#c8e7d2]">{t('worker.completed')}</div>
        )}

        <ActionButton label={t('worker.back')} onClick={() => setSelectedOrder(null)} variant="secondary" />
      </div>
    </div>
  );

  const issueView = selectedOrder && showIssueForm && (
    <IssueReportForm
      issueTypes={issueTypes}
      orderId={selectedOrder.id}
      onSubmitSuccess={() => {
        setShowIssueForm(false);
        setSelectedOrder(null);
      }}
      onCancel={() => setShowIssueForm(false)}
    />
  );

  if (successVisible) {
    return (
      <SuccessScreen
        message={t(successMessageToShow)}
        onBack={() => {
          setSuccessVisible(false);
          setSelectedOrder(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className={`${panelClass} bg-[linear-gradient(125deg,_#ffffff_0%,_#f8f4ec_100%)]`}>
        <p className="text-lg font-bold text-[#132130]">{t('worker.greeting').replace('{name}', user?.name || '')}</p>
        <p className="text-sm text-[#4f5a66] mt-2">{t(titleKey)}</p>
        <p className="text-base text-[#233140] font-semibold mt-1">{summaryText}</p>
      </div>

      <div className={`${subtlePanelClass} grid grid-cols-3 gap-2`}>
        <ActionButton label={t('worker.myWorkToday')} onClick={() => setTab('home')} variant={tab === 'home' ? 'primary' : 'secondary'} />
        <ActionButton label={t('worker.history')} onClick={() => setTab('history')} variant={tab === 'history' ? 'primary' : 'secondary'} />
        <ActionButton label={t('worker.refresh')} onClick={tab === 'history' ? loadHistory : loadHomeData} variant="secondary" isLoading={loading} />
      </div>

      {error && <div className="p-3 rounded-xl bg-[#fff1ef] text-[#a93d30] text-sm border border-[#e9b5ad]">{error}</div>}

      {issueView || detailView || (
        <>
          {tab === 'home' && (
            <div className={panelClass}>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {orders.length === 0 && !loading && <div className="p-3 rounded-xl bg-[#f1eee7] text-[#55606b] text-sm">{t('worker.noOrdersAssigned')}</div>}
                {orders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={{ ...order, status: getDisplayStatus(order) }}
                    subtitle={getCardSubtitle(order)}
                    onTap={() => {
                      setSelectedOrder(order);
                      setShowIssueForm(false);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-3">
              <div className={panelClass}>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-[#e8f7ec] border border-[#c8e7d2] p-2">
                    <p className="text-[#466455]">{t('worker.totalCompleted')}</p>
                    <p className="font-bold text-[#2c6940] text-base">{stats.totalCompleted}</p>
                  </div>
                  <div className="rounded-xl bg-[#fff1ef] border border-[#efc3bc] p-2">
                    <p className="text-[#7a4f49]">{t('worker.totalReturned')}</p>
                    <p className="font-bold text-[#8a3d32] text-base">{stats.totalReturned}</p>
                  </div>
                  <div className="rounded-xl bg-[#edf6fb] border border-[#c5dbe8] p-2">
                    <p className="text-[#456273]">{t('worker.currentActive')}</p>
                    <p className="font-bold text-[#2f5673] text-base">{stats.currentActive}</p>
                  </div>
                </div>
              </div>

              <div className={`${panelClass} max-h-[58vh] overflow-y-auto space-y-3 pr-1`}>
                {history.length === 0 && !loading && <div className="p-3 rounded-xl bg-[#f1eee7] text-[#55606b] text-sm">{t('worker.noHistory')}</div>}
                {history.map((order) => (
                  <div key={`hist-${order.id}-${order.completedAt || order.updatedAt}`} className="bg-white rounded-2xl border border-[#ddd3c4] p-4">
                    <p className="text-base font-bold text-[#132130] break-all">{order.orderCode}</p>
                    <p className="text-sm text-[#4f5a66]">{order.details?.articleName || '-'}</p>
                    <p className="text-sm text-[#4f5a66]">{t('worker.completedOn')}: {order.completedAt ? new Date(order.completedAt).toLocaleString() : '-'}</p>
                    {role === 'TAILOR' && <p className="text-sm text-[#8a3d32]">{t('worker.returnCount')}: {order.returnedCount || 0}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default WorkerPortalScreen;
