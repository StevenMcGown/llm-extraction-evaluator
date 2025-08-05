import React from 'react';

interface RecentActivityProps {
  isDarkMode: boolean;
}

const RecentActivity: React.FC<RecentActivityProps> = ({ isDarkMode }) => {
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

  const activityItemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 0',
    borderBottom: `1px solid ${isDarkMode ? '#374151' : '#f3f4f6'}`
  };

  const iconStyle = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0
  };

  const activities = [
    { id: 1, text: 'Evaluation completed for batch #127', time: '2 minutes ago', color: '#10b981' },
    { id: 2, text: 'New schema uploaded: invoice_v2.json', time: '15 minutes ago', color: '#3b82f6' },
    { id: 3, text: 'Model accuracy improved to 96.2%', time: '1 hour ago', color: '#8b5cf6' },
    { id: 4, text: 'Database sync completed successfully', time: '2 hours ago', color: '#f59e0b' }
  ];

  return (
    <div style={cardStyle}>
      <h3 style={headerStyle}>Recent Activity</h3>
      <div>
        {activities.map((activity, index) => (
          <div key={activity.id} style={{
            ...activityItemStyle,
            borderBottom: index === activities.length - 1 ? 'none' : activityItemStyle.borderBottom
          }}>
            <div style={{
              ...iconStyle,
              backgroundColor: activity.color
            }} />
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '0.875rem',
                color: isDarkMode ? '#ffffff' : '#111827',
                marginBottom: '0.25rem'
              }}>
                {activity.text}
              </div>
              <div style={{
                fontSize: '0.75rem',
                color: isDarkMode ? '#9ca3af' : '#6b7280'
              }}>
                {activity.time}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RecentActivity; 