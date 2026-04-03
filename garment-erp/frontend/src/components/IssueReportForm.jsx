import React, { useState } from 'react';
import api from '../services/api';
import ActionButton from './ActionButton';
import { useLanguage } from '../context/LanguageContext';

const IssueReportForm = ({ issueTypes, orderId, onSubmitSuccess, onCancel }) => {
  const { t } = useLanguage();
  const [issueType, setIssueType] = useState(issueTypes[0] || 'OTHER');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!description.trim()) {
      setError(t('worker.issueDescriptionRequired'));
      return;
    }

    try {
      setLoading(true);
      setError('');
      await api.post(`/orders/${orderId}/issue`, {
        issueType,
        description: description.trim()
      });
      onSubmitSuccess();
    } catch (err) {
      setError(err.response?.data?.message || t('worker.issueSubmitFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white/95 rounded-2xl border border-[#d9d1c3] shadow-[0_8px_20px_rgba(34,42,54,0.08)] p-4">
      <h3 className="text-lg font-bold text-[#132130] mb-3">{t('worker.reportIssue')}</h3>
      {error && <div className="mb-3 p-2 rounded-xl bg-[#fff1ef] text-[#a93d30] text-sm border border-[#e9b5ad]">{error}</div>}

      <label className="block text-sm font-semibold text-[#2b3a48] mb-2">{t('worker.issueType')}</label>
      <select
        value={issueType}
        onChange={(e) => setIssueType(e.target.value)}
        className="w-full rounded-xl border border-[#cfc5b4] bg-white px-3 py-3 text-sm text-[#1e2b37] min-h-[52px] outline-none transition focus:border-[#2d5a66] focus:ring-2 focus:ring-[#2d5a66]/20"
      >
        {issueTypes.map((type) => (
          <option key={type} value={type}>{t(`worker.issueTypes.${type}`)}</option>
        ))}
      </select>

      <label className="block text-sm font-semibold text-[#2b3a48] mt-4 mb-2">{t('worker.issueDescription')}</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        className="w-full rounded-xl border border-[#cfc5b4] bg-white px-3 py-3 text-sm text-[#1e2b37] outline-none transition focus:border-[#2d5a66] focus:ring-2 focus:ring-[#2d5a66]/20"
        placeholder={t('worker.issueDescriptionPlaceholder')}
      />

      <div className="mt-4 space-y-2">
        <ActionButton label={t('worker.submitIssue')} onClick={submit} isLoading={loading} variant="danger" />
        <ActionButton label={t('worker.back')} onClick={onCancel} variant="secondary" />
      </div>
    </div>
  );
};

export default IssueReportForm;
