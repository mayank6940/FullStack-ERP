import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';

const EmployeeOrdersTable = () => {
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const hasData = useMemo(() => rows.length > 0 && columns.length > 0, [rows, columns]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/orders/employee-view?limit=100');
      setColumns(response.data?.data?.columns || []);
      setRows(response.data?.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-gray-800">Assigned Orders</h3>
        <button type="button" onClick={loadOrders} className="text-sm px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">
          Refresh
        </button>
      </div>

      {error && <div className="mb-3 p-2 rounded bg-red-100 text-red-700 text-sm">{error}</div>}
      {loading && <div className="mb-3 p-2 rounded bg-blue-100 text-blue-700 text-sm">Loading orders...</div>}

      {!loading && columns.length === 0 && (
        <div className="p-3 rounded bg-yellow-50 text-yellow-800 text-sm">
          No visible columns configured by manager for your role.
        </div>
      )}

      {!loading && columns.length > 0 && rows.length === 0 && (
        <div className="p-3 rounded bg-gray-100 text-gray-700 text-sm">
          No assigned orders found.
        </div>
      )}

      {hasData && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead className="bg-gray-100">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="border p-2 text-left whitespace-nowrap">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`row-${index}`} className="border-b">
                  {columns.map((column) => (
                    <td key={`${index}-${column}`} className="border p-2 whitespace-nowrap">{row[column] ?? '-'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default EmployeeOrdersTable;
