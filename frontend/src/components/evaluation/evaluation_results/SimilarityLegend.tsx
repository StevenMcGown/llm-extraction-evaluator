import React from 'react';

export interface SimilarityLegendItem {
  range: string;
  color: string;
  description: string;
}

interface Props {
  items: SimilarityLegendItem[];
  isDarkMode: boolean;
}

const SimilarityLegend: React.FC<Props> = ({ items, isDarkMode }) => {
  return (
    <div style={{ 
      display: 'flex', 
      flexWrap: 'wrap', 
      alignItems: 'center', 
      justifyContent: 'space-between',
      width: '85%',
      gap: '0.6rem'
    }}>
      {items.map((item) => (
        <div key={item.range} style={{ textAlign: 'center', flex: '1 1 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', marginBottom: '0.25rem' }}>
            <div
              style={{
                width: 14,
                height: 14,
                backgroundColor: item.color,
                borderRadius: 3,
                border: '1px solid rgba(0,0,0,0.08)',
                flexShrink: 0,
              }}
            />
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: isDarkMode ? '#ffffff' : '#000000' }}>
              {item.range}
            </div>
          </div>
          <div style={{ color: isDarkMode ? '#9ca3af' : '#6c757d', fontSize: '0.85rem', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{item.description}</div>
        </div>
      ))}
    </div>
  );
};

export default SimilarityLegend; 