import React from 'react';
import ActionButton from './ActionButton';

const SuccessScreen = ({ message, onBack }) => {
  return (
    <div className="fixed inset-0 bg-[radial-gradient(circle_at_top,_#f6eddc_0%,_#f1f4f7_52%,_#ebe8e2_100%)] z-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center rounded-2xl border border-[#d9d1c3] bg-white/95 p-6 shadow-[0_14px_32px_rgba(34,42,54,0.14)]">
        <div className="mx-auto w-20 h-20 rounded-full bg-[#e8f7ec] border border-[#c8e7d2] flex items-center justify-center text-[#2c6940] text-4xl font-bold">✓</div>
        <p className="mt-5 text-xl font-bold text-[#132130]">{message}</p>
        <div className="mt-6">
          <ActionButton label="Back to Home" onClick={onBack} variant="primary" />
        </div>
      </div>
    </div>
  );
};

export default SuccessScreen;
