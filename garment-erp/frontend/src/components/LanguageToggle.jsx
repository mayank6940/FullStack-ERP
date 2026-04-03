import React from 'react';
import { useLanguage } from '../context/LanguageContext';

const LanguageToggle = () => {
  const { language, toggleLanguage } = useLanguage();
  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className="bg-gray-200 text-gray-800 px-3 py-1 rounded text-sm font-bold hover:bg-gray-300 transition-colors min-h-[40px]"
    >
      {language === 'en' ? 'हि' : 'EN'}
    </button>
  );
};

export default LanguageToggle;
