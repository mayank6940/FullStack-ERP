import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

const OfflineBanner = () => {
  const { t } = useLanguage();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-red-600 text-white text-base font-bold px-4 py-3 text-center">
      {t('worker.noInternet')}
    </div>
  );
};

export default OfflineBanner;
