import React from 'react';

interface OverviewCardsProps {
  isDarkMode: boolean;
}

const OverviewCards: React.FC<OverviewCardsProps> = ({ isDarkMode }) => {
  const cardStyle = {
    background: isDarkMode ? '#1f2937' : '#ffffff',
    border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    transition: 'all 0.2s ease'
  };

  const titleStyle = {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
    marginBottom: '0.5rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em'
  };

  const valueStyle = {
    fontSize: '2rem',
    fontWeight: '700',
    color: isDarkMode ? '#ffffff' : '#111827',
    marginBottom: '0.5rem'
  };

  const subtitleStyle = {
    fontSize: '0.875rem',
    color: isDarkMode ? '#6b7280' : '#9ca3af'
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: '1.5rem',
      marginBottom: '2rem'
    }}>
      <div style={cardStyle}>
        <div style={titleStyle}>Total Evaluations</div>
        <div style={valueStyle}>24</div>
        <div style={subtitleStyle}>+3 this week</div>
      </div>
      
      <div style={cardStyle}>
        <div style={titleStyle}>Average Accuracy</div>
        <div style={valueStyle}>94.2%</div>
        <div style={subtitleStyle}>+2.1% from last month</div>
      </div>
      
      <div style={cardStyle}>
        <div style={titleStyle}>Documents Processed</div>
        <div style={valueStyle}>1,247</div>
        <div style={subtitleStyle}>Last 30 days</div>
      </div>
      
      <div style={cardStyle}>
        <div style={titleStyle}>Active Models</div>
        <div style={valueStyle}>5</div>
        <div style={subtitleStyle}>GPT-4, Claude, Gemini</div>
      </div>
    </div>
  );
};

export default OverviewCards; 