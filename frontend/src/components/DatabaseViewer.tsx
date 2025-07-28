import React, { useState, useEffect } from 'react';
import { listTables, queryTable } from '../services/api';

interface TableData {
  table: string;
  columns: string[];
  data: Record<string, any>[];
  count: number;
}

const DatabaseViewer: React.FC = () => {
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load tables on mount
  useEffect(() => {
    const loadTables = async () => {
      try {
        const resp = await listTables();
        setTables(resp.data.tables);
      } catch (err: any) {
        console.error('Failed to load tables:', err);
        setError('Failed to load tables');
      }
    };
    loadTables();
  }, []);

  const handleTableSelect = async (tableName: string) => {
    if (!tableName) return;
    setSelectedTable(tableName);
    setLoading(true);
    setError(null);
    
    try {
      const resp = await queryTable(tableName);
      setTableData(resp.data);
    } catch (err: any) {
      console.error('Failed to query table:', err);
      setError(`Failed to query table: ${err.response?.data?.detail || err.message}`);
      setTableData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: '2rem', textAlign: 'left' }}>
      <h2>Database Viewer</h2>
      
      {/* Table selector */}
      <div style={{ marginBottom: '1rem' }}>
        <label>
          Select Table:
          <select
            value={selectedTable}
            onChange={(e) => handleTableSelect(e.target.value)}
            style={{ marginLeft: '0.5rem', padding: '0.25rem' }}
          >
            <option value="">-- Choose a table --</option>
            {tables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p>Loading table data...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {/* Table data display */}
      {tableData && (
        <div>
          <h3>{tableData.table} ({tableData.count} rows)</h3>
          
          {tableData.data.length === 0 ? (
            <p>No data in this table.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ border: '1px solid #ccc', borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f5f5f5' }}>
                    {tableData.columns.map((col) => (
                      <th key={col} style={{ border: '1px solid #ccc', padding: '0.5rem', textAlign: 'left' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.data.map((row, idx) => (
                    <tr key={idx}>
                      {tableData.columns.map((col) => (
                        <td key={col} style={{ border: '1px solid #ccc', padding: '0.5rem' }}>
                          {row[col] !== null ? String(row[col]) : <em>NULL</em>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DatabaseViewer; 