import React, { useState } from 'react';
import InfoTooltipIcon from '../../common/InfoTooltipIcon';

export interface EvaluationMetrics {
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
  showDecimals: boolean;
}

const metricCards = [
  {
    key: 'precision',
    label: 'Precision',
    color: '#3b82f6',
    emoji: '🎯',
    tooltip: 'Of all positive predictions, how many were correct? (TP / (TP + FP))',
  },
  {
    key: 'recall',
    label: 'Recall',
    color: '#10b981',
    emoji: '📈',
    tooltip: 'Of all actual positives, how many were found? (TP / (TP + FN))',
  },
  {
    key: 'f1Score',
    label: 'F1 Score',
    color: '#f59e0b',
    emoji: '⚡',
    tooltip: 'Harmonic mean of precision and recall. Balance between precision and recall.\nF1 = 2 * (Precision * Recall) / (Precision + Recall)',
  },
  {
    key: 'accuracy',
    label: 'Accuracy',
    color: '#8b5cf6',
    emoji: '✨',
    tooltip: 'Overall correctness of predictions. (TP + TN) / (TP + FP + FN + TN)',
  },
] as const;

type MetricKey = typeof metricCards[number]['key'];

const SummaryMetrics: React.FC<Props> = ({ metrics, isDarkMode, showDecimals }) => {
  const [hovered, setHovered] = useState<MetricKey | null>(null);

  const formatPercent = (value: number) =>
    showDecimals ? `${(value * 100).toFixed(3)}%` : `${(value * 100).toFixed(0)}%`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', overflow: 'visible' }}>
      {metricCards.map((card) => (
        <div
          key={card.key}
          style={{
            background: `linear-gradient(135deg, ${card.color}15 0%, ${card.color}25 100%)`,
            border: `1px solid ${card.color}40`,
            borderRadius: '12px',
            padding: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'relative',
            overflow: 'visible',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '1.75rem' }}>{card.emoji}</span>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{card.label}</div>
              {/* Removed percentage under label */}
            </div>
          </div>

          <div style={{
            fontSize: '2rem',
            fontWeight: 700,
            color: card.color,
            display: 'flex',
            alignItems: 'center',
          }}>
            {formatPercent(metrics[card.key])}
            <InfoTooltipIcon
              tooltip={card.tooltip}
              color={card.color}
              style={{ marginLeft: '0.5rem' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default SummaryMetrics; 