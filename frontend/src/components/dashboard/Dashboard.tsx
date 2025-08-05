import React from 'react';
import OverviewCards from './OverviewCards';
import RecentActivity from './RecentActivity';
import SystemStats from './SystemStats';

interface DashboardProps {
  isDarkMode: boolean;
}

const Dashboard: React.FC<DashboardProps> = ({ isDarkMode }) => {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '2rem',
      padding: '1rem'
    }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <OverviewCards isDarkMode={isDarkMode} />
      </div>
      
      <div>
        <RecentActivity isDarkMode={isDarkMode} />
      </div>
      
      <div>
        <SystemStats isDarkMode={isDarkMode} />
      </div>
    </div>
  );
};

export default Dashboard; 