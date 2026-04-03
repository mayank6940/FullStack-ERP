import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';

const SetupCredential = () => {
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const initialEmpId = location.state?.empId || sessionStorage.getItem('setupEmpId') || '';
  const [empId, setEmpId] = useState(initialEmpId);
  const [newCredential, setNewCredential] = useState('');
  const [confirmCredential, setConfirmCredential] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (location.state?.empId) {
      setEmpId(location.state.empId);
    }
  }, [location.state]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newCredential !== confirmCredential) {
      setError('Credentials do not match');
      return;
    }

    if (newCredential.length < 4) {
      setError('Credential must be at least 4 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await api.post('/auth/setup-credential', {
        empId,
        newCredential
      });

      if (response.data.success) {
        sessionStorage.removeItem('setupEmpId');

        // Now log in
        const loginResponse = await api.post('/auth/login', {
          empId,
          credential: newCredential
        });

        if (loginResponse.data.success) {
          const { employee } = loginResponse.data.data;
          login(employee);

          const rolePortals = {
            ADMIN: '/admin',
            MANAGER: '/manager',
            FABRIC_MAN: '/fabric',
            CUTTER: '/cutter',
            TAILOR: '/tailor',
            SUPERVISOR: '/supervisor'
          };

          navigate(rolePortals[employee.role] || '/');
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">
          {t('setup.title')}
        </h1>

        <p className="text-gray-600 text-center mb-6">
          {t('setup.registrationNote')}
        </p>

        {error && (
          <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-gray-700 font-bold mb-2">
              {t('setup.empId')}
            </label>
            <input
              type="text"
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="EMP-001"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-gray-700 font-bold mb-2">
              {t('setup.newCredential')}
            </label>
            <input
              type="password"
              value={newCredential}
              onChange={(e) => setNewCredential(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-gray-700 font-bold mb-2">
              Confirm {t('setup.newCredential')}
            </label>
            <input
              type="password"
              value={confirmCredential}
              onChange={(e) => setConfirmCredential(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors min-h-[56px]"
          >
            {loading ? t('common.loading') : t('setup.submit')}
          </button>
        </form>

        <button
          type="button"
          className="w-full mt-4 text-sm text-blue-700 font-semibold hover:underline"
          onClick={() => navigate('/login')}
        >
          {t('setup.backToLogin')}
        </button>
      </div>
    </div>
  );
};

export default SetupCredential;
