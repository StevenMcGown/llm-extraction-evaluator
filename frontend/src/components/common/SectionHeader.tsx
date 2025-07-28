import React from 'react';

interface SectionHeaderProps {
  children: React.ReactNode;
  isDarkMode: boolean;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ children, isDarkMode }) => {
  return (
    <div style={{ 
      display: 'block',
      marginBottom: '0.5rem', 
      color: isDarkMode ? '#ffffff' : '#495057',
      fontSize: '1.3rem',
      fontWeight: '600'
    }}>
      {children}
    </div>
  );
};

export default SectionHeader; 