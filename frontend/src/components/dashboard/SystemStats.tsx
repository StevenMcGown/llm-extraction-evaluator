import React from 'react';

interface SystemStatsProps {
  isDarkMode: boolean;
}

const SystemStats: React.FC<SystemStatsProps> = ({ isDarkMode }) => {
  const cardStyle = {
    background: isDarkMode ? '#1f2937' : '#ffffff',
    border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
  };

  const headerStyle = {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: isDarkMode ? '#ffffff' : '#111827',
    marginBottom: '1rem'
  };

  const statStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 0',
    borderBottom: `1px solid ${isDarkMode ? '#374151' : '#f3f4f6'}`
  };

  const progressBarStyle = {
    width: '60px',
    height: '6px',
    backgroundColor: isDarkMode ? '#374151' : '#e5e7eb',
    borderRadius: '3px',
    overflow: 'hidden'
  };

  const stats = [
    { label: 'CPU Usage', value: '45%', progress: 45, color: '#3b82f6' },
    { label: 'Memory', value: '2.1GB', progress: 67, color: '#10b981' },
    { label: 'Storage', value: '156GB', progress: 23, color: '#f59e0b' },
    { label: 'API Calls', value: '1.2K/day', progress: 80, color: '#8b5cf6' }
  ];

  return (
    <div style={cardStyle}>
      <h3 style={headerStyle}>System Stats</h3>
      <div>
        {stats.map((stat, index) => (
          <div key={stat.label} style={{
            ...statStyle,
            borderBottom: index === stats.length - 1 ? 'none' : statStyle.borderBottom
          }}>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '0.875rem',
                color: isDarkMode ? '#ffffff' : '#111827',
                marginBottom: '0.25rem'
              }}>
                {stat.label}
              </div>
              <div style={{
                fontSize: '0.75rem',
                color: isDarkMode ? '#9ca3af' : '#6b7280'
              }}>
                {stat.value}
              </div>
            </div>
            <div style={progressBarStyle}>
              <div style={{
                width: `${stat.progress}%`,
                height: '100%',
                backgroundColor: stat.color,
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SystemStats; 