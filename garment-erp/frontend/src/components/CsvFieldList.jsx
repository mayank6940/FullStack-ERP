import React from 'react';

const DEFAULT_EMPLOYEE_FIELDS = ['Products', 'StyleCode', 'FabricName', 'Colour', 'Pattern', 'FabricSize', 'Lining'];

const FIELD_LABELS = {
  Products: 'Products',
  StyleCode: 'Style Code',
  FabricName: 'Fabric Name',
  Colour: 'Colour',
  Pattern: 'Pattern',
  FabricSize: 'Fabric Size',
  Lining: 'Lining'
};

const formatFieldLabel = (key) => FIELD_LABELS[key] || String(key || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const CsvFieldList = ({ fields = {}, className = '', compact = false, allowedKeys = DEFAULT_EMPLOYEE_FIELDS }) => {
  const entries = allowedKeys
    .map((key) => [key, fields[key]])
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');

  if (entries.length === 0) return null;

  return (
    <div className={className}>
      <div className={`grid grid-cols-1 ${compact ? 'sm:grid-cols-2' : 'md:grid-cols-2'} gap-2`}>
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-xl border border-[#e1d8c9] bg-[#fcfaf5] px-3 py-2 text-sm text-[#2b3a48]">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#5a6874]">{formatFieldLabel(key)}</p>
            <p className="mt-1 font-medium break-words">{String(value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CsvFieldList;