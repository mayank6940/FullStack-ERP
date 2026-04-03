import React from 'react';
import { MobileHeader } from './Header';
import OfflineBanner from './OfflineBanner';

export const MobileLayout = ({ children, role }) => {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f7eedf_0%,_#f2f4f7_46%,_#ebe8e2_100%)] text-[#1e2b37]" style={{ fontFamily: 'Manrope, Segoe UI, sans-serif' }}>
      <OfflineBanner />
      <MobileHeader />

      <main className="mx-auto max-w-xl p-4 pt-5 pb-6">
        <div className="rounded-2xl border border-[#d9d1c3] bg-white/85 p-3 shadow-[0_10px_26px_rgba(34,42,54,0.08)] backdrop-blur-sm">
          {children}
        </div>
      </main>
    </div>
  );
};

export default MobileLayout;
