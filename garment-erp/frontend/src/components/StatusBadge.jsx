import React from 'react';
import { useLanguage } from '../context/LanguageContext';

const STATUS_COLOR = {
  ASSIGNED: 'bg-[#e9f2fa] text-[#2f5673] border border-[#c5d9ea]',
  FABRIC_IN_PROGRESS: 'bg-[#fff5dc] text-[#785a1f] border border-[#eed9a8]',
  CUTTING_IN_PROGRESS: 'bg-[#fff5dc] text-[#785a1f] border border-[#eed9a8]',
  TAILOR_IN_PROGRESS: 'bg-[#fff5dc] text-[#785a1f] border border-[#eed9a8]',
  FABRIC_DONE: 'bg-[#e8f7ec] text-[#2c6940] border border-[#c8e7d2]',
  CUTTING_DONE: 'bg-[#e8f7ec] text-[#2c6940] border border-[#c8e7d2]',
  TAILOR_DONE: 'bg-[#e8f7ec] text-[#2c6940] border border-[#c8e7d2]',
  QC_PENDING: 'bg-[#e9f2fa] text-[#2f5673] border border-[#c5d9ea]',
  COMPLETED: 'bg-[#e8f7ec] text-[#2c6940] border border-[#c8e7d2]',
  REJECTED: 'bg-[#ffecea] text-[#8a3d32] border border-[#efc3bc]',
  QC_IN_PROGRESS: 'bg-[#fff5dc] text-[#785a1f] border border-[#eed9a8]'
};

const StatusBadge = ({ status, returned = false }) => {
  const { t } = useLanguage();
  if (returned) {
    return <span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-[#ffecea] text-[#8a3d32] border border-[#efc3bc]">{t('worker.returned')}</span>;
  }

  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${STATUS_COLOR[status] || 'bg-[#ecebe8] text-[#44515f] border border-[#ddd8cf]'}`}>
      {t(`worker.status.${status}`)}
    </span>
  );
};

export default StatusBadge;
