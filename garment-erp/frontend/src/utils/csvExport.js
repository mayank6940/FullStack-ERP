export const downloadCsv = (filename, rows, columns) => {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const escapeCell = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/"/g, '""');
    return /[",\n]/.test(text) ? `"${text}"` : text;
  };

  const header = columns.map((col) => escapeCell(col.label)).join(',');
  const body = rows
    .map((row) => columns.map((col) => escapeCell(row[col.key])).join(','))
    .join('\n');

  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
