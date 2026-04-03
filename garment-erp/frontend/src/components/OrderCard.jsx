import React from 'react';
import StatusBadge from './StatusBadge';

const OrderCard = ({ order, onTap, subtitle }) => {
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left bg-white/95 rounded-2xl border border-[#ddd3c4] shadow-[0_8px_20px_rgba(34,42,54,0.08)] p-4 min-h-[56px] hover:shadow-[0_10px_24px_rgba(34,42,54,0.12)] transition"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-bold text-[#132130] break-all">{order.orderCode}</p>
        <StatusBadge status={order.status} returned={order.isReturned} />
      </div>
      <p className="mt-2 text-[15px] font-semibold text-[#223242]">{order.details?.articleName || '-'}</p>
      {subtitle && <p className="mt-1 text-sm text-[#4f5a66]">{subtitle}</p>}
      <p className="mt-1 text-sm text-[#4f5a66]">Qty: {order.details?.quantity ?? '-'}</p>
    </button>
  );
};

export default OrderCard;
