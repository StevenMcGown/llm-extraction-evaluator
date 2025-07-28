import React, { useState } from 'react';
import InfoTooltipIcon from '../../common/InfoTooltipIcon';

interface EvaluationMetrics {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  accuracy: number;
}

interface Props {
  metrics: EvaluationMetrics;
  isDarkMode: boolean;
}

const ConfusionMatrix: React.FC<Props> = ({ metrics, isDarkMode }) => {
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateColumns: '1fr 1fr', 
      gap: '1rem',
      overflow: 'visible'
    }}>
        {/* True Positives */}
        <div style={{
          background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)',
          border: '2px solid #10b981',
          borderRadius: '12px',
          padding: '1.5rem',
          textAlign: 'center',
          position: 'relative',
          overflow: 'visible'
        }}>
          {/* Info icon with tooltip */}
          <InfoTooltipIcon tooltip="Correctly extracts fields with correct value, key, and format" color="#065f46" style={{ position: 'absolute', top: '8px', right: '8px' }} />
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✅</div>
          <div style={{ 
            fontSize: '2rem', 
            fontWeight: '700',
            color: '#065f46',
            marginBottom: '0.25rem'
          }}>
            {metrics.truePositives}
          </div>
          <div style={{ 
            fontSize: '0.9rem',
            fontWeight: '600',
            color: '#047857'
          }}>
            True Positives
          </div>
        </div>

        {/* False Positives */}
        <div style={{
          background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
          border: '2px solid #ef4444',
          borderRadius: '12px',
          padding: '1.5rem',
          textAlign: 'center',
          position: 'relative',
          overflow: 'visible'
        }}>
          {/* Info icon with tooltip */}
          <InfoTooltipIcon tooltip="Extracts fields not in ground truth, or with wrong values/keys" color="#991b1b" style={{ position: 'absolute', top: '8px', right: '8px' }} />
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>❌</div>
          <div style={{ 
            fontSize: '2rem', 
            fontWeight: '700',
            color: '#991b1b',
            marginBottom: '0.25rem'
          }}>
            {metrics.falsePositives}
          </div>
          <div style={{ 
            fontSize: '0.9rem',
            fontWeight: '600',
            color: '#dc2626'
          }}>
            False Positives
          </div>
        </div>

        {/* False Negatives */}
        <div style={{
          background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
          border: '2px solid #f59e0b',
          borderRadius: '12px',
          padding: '1.5rem',
          textAlign: 'center',
          position: 'relative',
          overflow: 'visible'
        }}>
          {/* Info icon with tooltip */}
          <InfoTooltipIcon tooltip="Fails to extract fields that are present in ground truth" color="#92400e" style={{ position: 'absolute', top: '8px', right: '8px' }} />
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>❌</div>
          <div style={{ 
            fontSize: '2rem', 
            fontWeight: '700',
            color: '#92400e',
            marginBottom: '0.25rem'
          }}>
            {metrics.falseNegatives}
          </div>
          <div style={{ 
            fontSize: '0.9rem',
            fontWeight: '600',
            color: '#d97706'
          }}>
            False Negatives
          </div>
        </div>

        {/* True Negatives */}
        <div style={{
          background: isDarkMode 
            ? 'linear-gradient(135deg, #374151 0%, #4b5563 100%)'
            : 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
          border: '2px solid #64748b',
          borderRadius: '12px',
          padding: '1.5rem',
          textAlign: 'center',
          position: 'relative',
          overflow: 'visible'
        }}>
          {/* Info icon with tooltip */}
          <InfoTooltipIcon tooltip="Correctly refrains from extracting fields absent in ground truth" color="#475569" style={{ position: 'absolute', top: '8px', right: '8px' }} />
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🚫</div>
          <div style={{ 
            fontSize: '2rem', 
            fontWeight: '700',
            color: isDarkMode ? '#9ca3af' : '#475569',
            marginBottom: '0.25rem'
          }}>
            {metrics.trueNegatives}
          </div>
          <div style={{ 
            fontSize: '0.9rem',
            fontWeight: '600',
            color: isDarkMode ? '#9ca3af' : '#475569'
          }}>
            True Negatives
          </div>
        </div>
    </div>
  );
};

export default ConfusionMatrix; 