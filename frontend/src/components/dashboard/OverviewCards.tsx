import React, { useEffect, useState } from 'react';
import { getEvaluationMetrics, queryTable } from '../../services/api';

interface OverviewCardsProps {
  isDarkMode: boolean;
  excludedFields?: string[];
}

interface EvaluationMetric {
  id: number;
  file_id: string;
  evaluation_timestamp: string;
  overall_precision: number;
  overall_recall: number;
  overall_f1_score: number;
  overall_accuracy: number;
  overall_tp: number;
  overall_tn: number;
  overall_fp: number;
  overall_fn: number;
  ground_truth_file_id: string;
  extraction_run_id: number | null;
  evaluation_config: {
    source_data_uri?: string;
    ground_truth_uri?: string;
    extraction_endpoint?: string;
    extraction_types?: string[];
    excluded_fields?: string[];
    iterations?: number;
    selected_files?: string[];
  };
}

const OverviewCards: React.FC<OverviewCardsProps> = ({ isDarkMode, excludedFields = [] }) => {
  const [totalEvaluations, setTotalEvaluations] = useState<number>(0);
  const [weeklyChange, setWeeklyChange] = useState<number>(0);
  const [averageAccuracy, setAverageAccuracy] = useState<number>(0);
  const [averagePrecision, setAveragePrecision] = useState<number>(0);
  const [averageRecall, setAverageRecall] = useState<number>(0);
  const [averageF1, setAverageF1] = useState<number>(0);
  const [documentsProcessed, setDocumentsProcessed] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const fetchEvaluationStats = async () => {
      try {
        setLoading(true);
        const response = await getEvaluationMetrics(1000);
        const metrics = response.data?.metrics as EvaluationMetric[] | undefined;
        // Load field_performance rows to compute filtered averages like the chart
        const fieldResp = await queryTable('field_performance', 5000);
        const fieldRows = Array.isArray(fieldResp.data?.data) ? fieldResp.data.data : [];

        if (Array.isArray(metrics)) {
          // Total evaluations
          setTotalEvaluations(metrics.length);
          
          // Calculate weekly change
          const now = new Date();
          const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          const thisWeekCount = metrics.filter(metric => {
            const metricDate = new Date(metric.evaluation_timestamp);
            return metricDate >= oneWeekAgo;
          }).length;
          setWeeklyChange(thisWeekCount);
          
          // Documents processed in last 30 days (sum of iterations)
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          const documentsLast30Days = metrics
            .filter(metric => {
              const metricDate = new Date(metric.evaluation_timestamp);
              return metricDate >= thirtyDaysAgo;
            })
            .reduce((total, metric) => {
              const iterations = metric.evaluation_config?.iterations || 1;
              return total + iterations;
            }, 0);
          setDocumentsProcessed(documentsLast30Days);
          
          // Averages (filtered): recompute per evaluation from field_performance rows with excludedFields applied
          const toPtr = (fieldPath: string) => {
            let ptr = String(fieldPath || '').replace(/\[.*?\]/g, '');
            ptr = ptr.replace(/\./g, '/');
            if (!ptr.startsWith('/')) ptr = '/' + ptr;
            return ptr;
          };
          // Build mapping from eval id to label (file_id) to group rows per eval
          const idToLabel = new Map<number, string>();
          for (const m of metrics) {
            const idNum = Number(m.id as any);
            if (!Number.isNaN(idNum)) idToLabel.set(idNum, String((m as any).file_id ?? idNum));
          }
          // Group rows by evaluation_id
          const byEval = new Map<number, any[]>();
          for (const r of fieldRows) {
            const evalId = Number(r.evaluation_id);
            if (!idToLabel.has(evalId)) continue;
            const ptr = toPtr(String(r.field_path || ''));
            if (excludedFields.some(ex => ptr.startsWith(ex))) continue;
            const arr = byEval.get(evalId) || [];
            arr.push(r);
            byEval.set(evalId, arr);
          }
          const perEvalMetrics: { precision: number; recall: number; f1: number; acc: number }[] = [];
          for (const [, rows] of byEval.entries()) {
            const sums = rows.reduce((acc: any, r: any) => {
              acc.tp += Number(r.tp ?? 0);
              acc.fp += Number(r.fp ?? 0);
              acc.fn += Number(r.fn ?? 0);
              acc.tn += Number(r.tn ?? 0);
              return acc;
            }, { tp: 0, fp: 0, fn: 0, tn: 0 });
            const precision = (sums.tp + sums.fp) > 0 ? sums.tp / (sums.tp + sums.fp) : 0;
            const recall = (sums.tp + sums.fn) > 0 ? sums.tp / (sums.tp + sums.fn) : 0;
            const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
            const acc = (sums.tp + sums.fp + sums.fn + sums.tn) > 0 ? (sums.tp + sums.tn) / (sums.tp + sums.fp + sums.fn + sums.tn) : 0;
            perEvalMetrics.push({ precision, recall, f1, acc });
          }
          const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
          setAveragePrecision(avg(perEvalMetrics.map(m => m.precision)));
          setAverageRecall(avg(perEvalMetrics.map(m => m.recall)));
          setAverageF1(avg(perEvalMetrics.map(m => m.f1)));
          setAverageAccuracy(avg(perEvalMetrics.map(m => m.acc)));
        }
      } catch (error) {
        console.error('Failed to fetch evaluation stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvaluationStats();
  }, [excludedFields]);

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

  const loadingValueStyle = {
    ...valueStyle,
    color: isDarkMode ? '#6b7280' : '#9ca3af'
  };

  // Consistent large value style for average metrics row
  const metricValueStyle = {
    fontSize: '2rem',
    fontWeight: '700',
    color: isDarkMode ? '#ffffff' : '#111827',
    marginBottom: '0.25rem'
  } as const;

  const metricLoadingValueStyle = {
    ...metricValueStyle,
    color: isDarkMode ? '#6b7280' : '#9ca3af'
  } as const;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: '1.5rem',
      marginBottom: '2rem'
    }}>
      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div>
            <div style={titleStyle}>Total Evaluations</div>
            <div style={loading ? loadingValueStyle : valueStyle}>
              {loading ? '...' : totalEvaluations}
            </div>
            <div style={subtitleStyle}>
              {loading ? '...' : `+${weeklyChange} this week`}
            </div>
          </div>
          <div>
            <div style={titleStyle}>Documents Processed</div>
            <div style={loading ? loadingValueStyle : valueStyle}>
              {loading ? '...' : documentsProcessed}
            </div>
            <div style={subtitleStyle}>Last 30 days</div>
          </div>
        </div>
      </div>
      
      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          <div>
            <div style={titleStyle}>Average Accuracy</div>
            <div style={loading ? metricLoadingValueStyle : metricValueStyle}>
              {loading ? '...' : `${(averageAccuracy * 100).toFixed(1)}%`}
            </div>
          </div>
          <div>
            <div style={titleStyle}>Average Precision</div>
            <div style={loading ? metricLoadingValueStyle : metricValueStyle}>
              {loading ? '...' : `${(averagePrecision * 100).toFixed(1)}%`}
            </div>
          </div>
          <div>
            <div style={titleStyle}>Average Recall</div>
            <div style={loading ? metricLoadingValueStyle : metricValueStyle}>
              {loading ? '...' : `${(averageRecall * 100).toFixed(1)}%`}
            </div>
          </div>
          <div>
            <div style={titleStyle}>Average F1 Score</div>
            <div style={loading ? metricLoadingValueStyle : metricValueStyle}>
              {loading ? '...' : `${(averageF1 * 100).toFixed(1)}%`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverviewCards; 