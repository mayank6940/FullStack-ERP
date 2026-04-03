import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';

const Login = () => {
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [empId, setEmpId] = useState('');
  const [credential, setCredential] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', {
        empId,
        credential
      });

      if (response.data.success) {
        const { employee } = response.data.data;

        // Login successful
        login(employee);

        // Redirect based on role
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
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.message || 'Login failed';

      if (status === 403 && message.includes('New User Registration')) {
        navigate('/new-user-reg', { state: { empId } });
        return;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-3xl font-bold mb-2 text-center text-gray-800">
          {t('login.title')}
        </h1>

        <p className="text-gray-600 text-center mb-6">
          {t('login.subtitle')}
        </p>

        {error && (
          <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-gray-700 font-bold mb-2">
              {t('login.empId')}
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

          <div className="mb-6">
            <label className="block text-gray-700 font-bold mb-2">
              {t('login.credential')}
            </label>
            <input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
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
            {loading ? t('common.loading') : t('login.submit')}
          </button>
        </form>

        <button
          type="button"
          className="w-full mt-4 text-sm text-blue-700 font-semibold hover:underline"
          onClick={() => navigate('/new-user-reg')}
        >
          {t('login.newUserReg')}
        </button>
      </div>
    </div>
  );
};

export default Login;
