import React, { useState } from 'react';
import SummaryMetrics, { EvaluationMetrics } from './SummaryMetrics';
import ConfusionMatrix from './ConfusionMatrix';
import IssuesLog from './IssuesLog';
import SimilarityLegend, { SimilarityLegendItem } from '../evaluation_results/SimilarityLegend';

interface Props {
  metrics: EvaluationMetrics;
  isDarkMode: boolean;
  calculationLog?: string[];
  similarityLegend?: SimilarityLegendItem[];
}

const MetricsOverview: React.FC<Props> = ({ 
  metrics, 
  isDarkMode, 
  calculationLog = [], 
  similarityLegend = [] 
}) => {
  const [showDecimals, setShowDecimals] = useState<boolean>(false);

  return (
    <div style={{ 
      background: isDarkMode ? '#1f2937' : 'white', 
      border: `1px solid ${isDarkMode ? '#374151' : '#e2e8f0'}`, 
      borderRadius: '16px', 
      padding: '1rem 1rem 1rem 1rem', 
      boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
      position: 'relative'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Summary Metrics and Confusion Matrix Section */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
          gap: '2rem'
        }}>
          {/* Confusion Matrix Section */}
          <div>
            <h3 style={{ 
              marginBottom: '1rem', 
              color: isDarkMode ? '#ffffff' : '#495057',
              fontSize: '1.2rem',
              fontWeight: '600'
            }}>
              Confusion Matrix
            </h3>
            <ConfusionMatrix 
              metrics={metrics} 
              isDarkMode={isDarkMode} 
            />
          </div>

          {/* Summary Metrics Section */}
          <div style={{ position: 'relative' }}>
            <h3 style={{ 
              marginBottom: '1rem', 
              color: isDarkMode ? '#ffffff' : '#495057',
              fontSize: '1.2rem',
              fontWeight: '600'
            }}>
              Summary Metrics
            </h3>
            {/* Show Decimals Toggle */}
            <label style={{
              position: 'absolute',
              top: 0,
              right: 0,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              margin: '1rem 0 0 0',
              fontSize: '0.95rem',
              fontWeight: 500,
              color: isDarkMode ? '#fff' : '#222',
              background: 'none',
              border: 'none',
              padding: 0,
              userSelect: 'none',
              cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={showDecimals}
                onChange={e => setShowDecimals(e.target.checked)}
                style={{ marginRight: '0.3rem' }}
              />
              Show Decimals
            </label>
            <SummaryMetrics 
              metrics={metrics} 
              isDarkMode={isDarkMode} 
              showDecimals={showDecimals} 
            />
          </div>
        </div>

        {/* Issues Log Section */}
        {calculationLog.length > 0 && (
          <div>
            <IssuesLog 
              calculationLog={calculationLog} 
              isDarkMode={isDarkMode} 
            />
          </div>
        )}

        {/* Additional metrics components can be added here */}
        {/* Example:
        <div>
          <h3 style={{ marginBottom: '1rem', color: isDarkMode ? '#ffffff' : '#495057', fontSize: '1.2rem', fontWeight: '600' }}>
            Detailed Metrics
          </h3>
          <DetailedMetrics metrics={metrics} isDarkMode={isDarkMode} />
        </div>
        */}
      </div>
    </div>
  );
};

export default MetricsOverview; 