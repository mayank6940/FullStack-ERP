import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import api from '../services/api';
import LanguageToggle from './LanguageToggle';

export const DesktopHeader = () => {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      logout();
      navigate('/login');
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Garment ERP</h1>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm text-gray-600">{t('header.user')}</p>
          <p className="font-bold text-gray-800">{user?.name}</p>
          <p className="text-xs text-gray-500">{user?.empId}</p>
        </div>
        <button
          onClick={handleLogout}
          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
        >
          {t('header.logout')}
        </button>
      </div>
    </header>
  );
};

export const MobileHeader = () => {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      logout();
      navigate('/login');
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center">
      <div>
        <p className="font-bold text-xl text-gray-800">{user?.name}</p>
      </div>
      <div className="flex items-center gap-3">
        <LanguageToggle />
        <button
          onClick={handleLogout}
          className="bg-red-600 text-white px-3 py-2 rounded hover:bg-red-700 transition-colors min-h-[48px]"
        >
          {t('header.logout')}
        </button>
      </div>
    </header>
  );
};
