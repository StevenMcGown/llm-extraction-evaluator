import React from 'react';
import SectionHeader from '../../common/SectionHeader';

interface IterationSelectorProps {
  iterations: number;
  setIterations: (v: number) => void;
  isDarkMode: boolean;
}

const IterationSelector: React.FC<IterationSelectorProps> = ({
  iterations,
  setIterations,
  isDarkMode,
}) => {
  return (
    <div>
      <SectionHeader isDarkMode={isDarkMode}>
        Number of Iterations
        <span style={{ 
          fontSize: '0.75rem', 
          color: isDarkMode ? '#9ca3af' : '#6b7280',
          fontWeight: 'normal',
          marginLeft: '0.5rem'
        }}>
          (saved)
        </span>
      </SectionHeader>
      <input
        type="number"
        min={1}
        max={10}
        value={iterations}
        onChange={(e) => setIterations(Number(e.target.value))}
        style={{ 
          width: '95%', 
          marginTop: 6, 
          padding: '0.5rem',
          border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
          borderRadius: '4px',
          backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
          color: isDarkMode ? '#d1d5db' : '#374151'
        }}
      />
    </div>
  );
};

export default IterationSelector; 