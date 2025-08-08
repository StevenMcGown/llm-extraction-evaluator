import React, { useState } from 'react';
import OverviewCards from './OverviewCards';
import PerformanceChart, { MetricSelector } from './common/PerformanceChart';
import SchemaFieldSelector from '../evaluation/evaluation_settings/SchemaFieldSelector';

interface DashboardProps {
  isDarkMode: boolean;
}

const Dashboard: React.FC<DashboardProps> = ({ isDarkMode }) => {
  const [excludedFields, setExcludedFields] = useState<string[]>([]);
  const [fieldMetric, setFieldMetric] = useState<'precision' | 'recall' | 'accuracy' | 'f1_score'>('precision');

  const panelStyle = {
    background: isDarkMode ? '#1f2937' : '#ffffff',
    border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
  } as const;

  const chartContainerStyle = {
    ...panelStyle,
    marginBottom: '2rem',
    minHeight: '300px'
  } as const;

  const panelHeaderStyle = {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: isDarkMode ? '#ffffff' : '#111827',
    marginBottom: '1rem'
  } as const;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 0.45fr',
      gap: '2rem',
      padding: '1rem'
    }}>
      {/* Overall Performance Chart */}
      <div>
        <div style={chartContainerStyle}>
          <h3 style={panelHeaderStyle}>Overall Performance</h3>
          <PerformanceChart isDarkMode={isDarkMode} excludedFields={excludedFields} mode="overall" />
        </div>
      </div>

      {/* Field Performance Chart */}
      <div>
        <div style={chartContainerStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ ...panelHeaderStyle, marginBottom: 0 }}>Field Performance</h3>
            <MetricSelector selectedMetric={fieldMetric} onChange={setFieldMetric} isDarkMode={isDarkMode} />
          </div>
          <PerformanceChart isDarkMode={isDarkMode} excludedFields={excludedFields} mode="field" selectedMetric={fieldMetric} />
        </div>
      </div>

      {/* Schema Field Selector Panel */}
      <div>
        <div style={panelStyle}>
          <h3 style={panelHeaderStyle}>Schema Field Selector</h3>
          <SchemaFieldSelector isDarkMode={isDarkMode} onChange={setExcludedFields} showExcludedJson={false} />
        </div>
      </div>

      {/* Overview Cards - Full Width */}
      <div style={{ gridColumn: '1 / -1' }}>
        <OverviewCards isDarkMode={isDarkMode} />
      </div>
    </div>
  );
};

export default Dashboard; 