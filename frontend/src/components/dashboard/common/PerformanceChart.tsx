import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { queryTable, getEvaluationMetrics } from '../../../services/api';

type ChartMode = 'overall' | 'field';

type MetricKey = 'precision' | 'recall' | 'accuracy' | 'f1_score';

interface PerformanceChartProps {
  isDarkMode: boolean;
  excludedFields?: string[];
  mode: ChartMode;
  selectedMetric?: MetricKey; // if provided, chart is controlled
  onMetricChange?: (m: MetricKey) => void;
}

interface FieldPerformanceRow {
  id: number;
  evaluation_id: number;
  field_name: string;
  field_path: string;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1_score: number;
  accuracy: number;
  created_at: string;
}

function fieldPathToPointer(fieldPath: string): string {
  let ptr = fieldPath.replace(/\[.*?\]/g, '');
  ptr = ptr.replace(/\./g, '/');
  if (!ptr.startsWith('/')) ptr = '/' + ptr;
  return ptr;
}

function getTopLevelKey(fieldPath: string): string {
  if (!fieldPath) return 'unknown';
  const first = fieldPath.split('.')[0];
  return first || 'unknown';
}

function sanitizeKey(label: string): string {
  return label.replace(/[^a-zA-Z0-9_]/g, '_');
}

function toTitle(text: string): string {
  return text.replace(/_/g, ' ').split(' ').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

const SERIES_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#eab308', '#f97316', '#22c55e', '#06b6d4',
  '#a855f7', '#84cc16', '#0ea5e9', '#d946ef', '#dc2626', '#4f46e5', '#059669', '#b45309', '#2563eb', '#7c3aed'
];

const chartColors = {
  precision: '#3b82f6',
  recall: '#10b981',
  f1Score: '#f59e0b',
  accuracy: '#8b5cf6'
} as const;

// Tooltip label mapping and ordering for overall mode
const TOOLTIP_LABELS: Record<string, string> = {
  precision: 'Precision',
  recall: 'Recall',
  f1Score: 'F1 Score',
  accuracy: 'Accuracy',
};
const TOOLTIP_ORDER: Record<string, number> = {
  precision: 0,
  recall: 1,
  f1Score: 2,
  accuracy: 3,
};

const SHIFT_X = -54; // px to shift series left

const PerformanceChart: React.FC<PerformanceChartProps> = ({ isDarkMode, excludedFields = [], mode, selectedMetric, onMetricChange }) => {
  const [rows, setRows] = useState<FieldPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localMetric, setLocalMetric] = useState<MetricKey>('precision');
  const effectiveMetric: MetricKey = (selectedMetric ?? localMetric);
  const [evalIdToLabel, setEvalIdToLabel] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const resp = await queryTable('field_performance', 5000);
        const data = resp.data?.data as any[] | undefined;
        if (!Array.isArray(data)) {
          setRows([]);
        } else {
          const normalized: FieldPerformanceRow[] = data.map((r: any) => ({
            id: Number(r.id),
            evaluation_id: Number(r.evaluation_id),
            field_name: String(r.field_name),
            field_path: String(r.field_path),
            tp: Number(r.tp ?? 0),
            tn: Number(r.tn ?? 0),
            fp: Number(r.fp ?? 0),
            fn: Number(r.fn ?? 0),
            precision: r.precision != null ? Number(r.precision) : 0,
            recall: r.recall != null ? Number(r.recall) : 0,
            f1_score: r.f1_score != null ? Number(r.f1_score) : 0,
            accuracy: r.accuracy != null ? Number(r.accuracy) : 0,
            created_at: r.created_at,
          }));
          setRows(normalized);
        }
        // Fetch evaluation id -> label mapping (use file_id as GUID-like label)
        try {
          const mresp = await getEvaluationMetrics(1000);
          const metrics = mresp.data?.metrics as any[] | undefined;
          if (Array.isArray(metrics)) {
            const map = new Map<number, string>();
            for (const m of metrics) {
              const idNum = Number(m.id);
              if (!Number.isNaN(idNum)) {
                map.set(idNum, String(m.file_id ?? idNum));
              }
            }
            setEvalIdToLabel(map);
          }
        } catch {
          // ignore mapping errors, fallback to numeric ids
        }
      } catch (err) {
        console.error('Failed to load chart data:', err);
        setError('Failed to load performance data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Common filtered rows by excludedFields
  const filteredRows = useMemo(() => {
    const computePtr = (fp: string) => fieldPathToPointer(fp);
    const kept: FieldPerformanceRow[] = [];
    const dropped: FieldPerformanceRow[] = [];
    for (const r of rows) {
      const ptr = computePtr(r.field_path);
      const excluded = excludedFields.some(ex => ptr.startsWith(ex));
      (excluded ? dropped : kept).push(r);
    }
    try {
      const logObj = {
        tag: 'PerformanceChart.Filter',
        mode,
        excludedFields,
        totals: { totalRows: rows.length, keptRows: kept.length, droppedRows: dropped.length },
        keptPreview: kept.slice(0, 5).map(r => ({ id: r.id, evalId: r.evaluation_id, path: r.field_path, ptr: computePtr(r.field_path) })),
        droppedPreview: dropped.slice(0, 5).map(r => ({ id: r.id, evalId: r.evaluation_id, path: r.field_path, ptr: computePtr(r.field_path) })),
      } as const;
      console.log('PerformanceChart.Filter JSON:\n' + JSON.stringify(logObj, null, 2));
    } catch {}
    return kept;
  }, [rows, excludedFields]);

  // Overall mode: aggregate per evaluation into overall metrics series
  const overallData = useMemo(() => {
    if (mode !== 'overall' || !filteredRows.length) return [] as any[];
    const evalAgg: Map<number, { tp: number; fp: number; fn: number; tn: number; ts: string }> = new Map();
    for (const r of filteredRows) {
      const cur = evalAgg.get(r.evaluation_id) || { tp: 0, fp: 0, fn: 0, tn: 0, ts: r.created_at };
      cur.tp += r.tp || 0; cur.fp += r.fp || 0; cur.fn += r.fn || 0; cur.tn += r.tn || 0;
      if (new Date(r.created_at) < new Date(cur.ts)) cur.ts = r.created_at;
      evalAgg.set(r.evaluation_id, cur);
    }
    // Build additional diagnostics per evaluation
    const byEvalTopLevel: Map<number, Record<string, number>> = new Map();
    for (const r of filteredRows) {
      const top = getTopLevelKey(r.field_path);
      const m = byEvalTopLevel.get(r.evaluation_id) || {};
      m[top] = (m[top] || 0) + 1;
      byEvalTopLevel.set(r.evaluation_id, m);
    }

    const rowsOut = Array.from(evalAgg.entries()).map(([evalId, agg]) => {
      const { tp, fp, fn, tn } = agg;
      const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
      const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
      const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
      const accuracy = tp + fp + fn + tn > 0 ? (tp + tn) / (tp + fp + fn + tn) : 0;
      const label = evalIdToLabel.get(evalId) ?? String(evalId);
      return { x: label, precision, recall, f1Score: f1, accuracy, timestamp: agg.ts, evalId, counts: { tp, fp, fn, tn }, includedRowCount: (byEvalTopLevel.get(evalId) ? Object.values(byEvalTopLevel.get(evalId)!).reduce((a, b) => a + b, 0) : 0), byTopLevel: byEvalTopLevel.get(evalId) || {} };
    });
    rowsOut.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    try {
      const logObj = {
        tag: 'PerformanceChart.Overall',
        excludedFields,
        points: rowsOut.map(r => ({ evalId: r.evalId, x: r.x, counts: r.counts, metrics: { precision: +r.precision.toFixed(6), recall: +r.recall.toFixed(6), f1Score: +r.f1Score.toFixed(6), accuracy: +r.accuracy.toFixed(6) }, includedRowCount: r.includedRowCount, byTopLevel: r.byTopLevel })),
      } as const;
      console.log('PerformanceChart.Overall JSON:\n' + JSON.stringify(logObj, null, 2));

      // Delta log: before vs after vs removed
      const computeCounts = (arr: FieldPerformanceRow[]) => arr.reduce((acc, r) => {
        acc.tp += r.tp || 0; acc.fp += r.fp || 0; acc.fn += r.fn || 0; acc.tn += r.tn || 0; return acc;
      }, { tp: 0, fp: 0, fn: 0, tn: 0 });
      const toMetrics = (c: {tp:number;fp:number;fn:number;tn:number}) => ({
        precision: c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : 0,
        recall: c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : 0,
        f1Score: (c.tp + c.fp > 0 && c.tp + c.fn > 0) ? ((2 * (c.tp / (c.tp + c.fp)) * (c.tp / (c.tp + c.fn))) / ((c.tp / (c.tp + c.fp)) + (c.tp / (c.tp + c.fn)))) : 0,
        accuracy: c.tp + c.fp + c.fn + c.tn > 0 ? (c.tp + c.tn) / (c.tp + c.fp + c.fn + c.tn) : 0,
      });
      const isExcluded = (ptr: string) => excludedFields.some(ex => ptr.startsWith(ex));
      const computePtr = (fp: string) => fieldPathToPointer(fp);

      const byEval = new Map<number, { all: FieldPerformanceRow[]; kept: FieldPerformanceRow[]; removed: FieldPerformanceRow[] }>();
      for (const r of rows) {
        const e = r.evaluation_id;
        const ent = byEval.get(e) || { all: [], kept: [], removed: [] };
        ent.all.push(r);
        const ptr = computePtr(r.field_path);
        (isExcluded(ptr) ? ent.removed : ent.kept).push(r);
        byEval.set(e, ent);
      }
      const delta = Array.from(byEval.entries()).map(([evalId, sets]) => {
        const allCounts = computeCounts(sets.all);
        const keptCounts = computeCounts(sets.kept);
        const removedCounts = computeCounts(sets.removed);
        return {
          evalId,
          totals: { allRows: sets.all.length, keptRows: sets.kept.length, removedRows: sets.removed.length },
          before: { counts: allCounts, metrics: toMetrics(allCounts) },
          after: { counts: keptCounts, metrics: toMetrics(keptCounts) },
          removed: { counts: removedCounts, metrics: toMetrics(removedCounts) },
        };
      });
      const deltaLog = { tag: 'PerformanceChart.OverallDelta', excludedFields, evals: delta } as const;
      console.log('PerformanceChart.OverallDelta JSON:\n' + JSON.stringify(deltaLog, null, 2));

      // Remaining error breakdown per evaluation (which pointers still cause FP/FN?)
      const errorBreakdown = Array.from(new Set(rowsOut.map(r => r.evalId))).map(evalId => {
        const keptForEval = filteredRows.filter(r => r.evaluation_id === evalId);
        const perPtr = new Map<string, { top: string; tp: number; fp: number; fn: number; tn: number }>();
        for (const r of keptForEval) {
          const ptr = computePtr(r.field_path);
          const top = getTopLevelKey(r.field_path);
          const cur = perPtr.get(ptr) || { top, tp: 0, fp: 0, fn: 0, tn: 0 };
          cur.tp += r.tp || 0; cur.fp += r.fp || 0; cur.fn += r.fn || 0; cur.tn += r.tn || 0;
          perPtr.set(ptr, cur);
        }
        const items = Array.from(perPtr.entries())
          .map(([ptr, v]) => ({ ptr, top: v.top, tp: v.tp, fp: v.fp, fn: v.fn, tn: v.tn, errors: (v.fp || 0) + (v.fn || 0) }))
          .filter(x => x.errors > 0)
          .sort((a, b) => b.errors - a.errors)
          .slice(0, 30);
        const totals = items.reduce((acc, it) => { acc.fp += it.fp; acc.fn += it.fn; return acc; }, { fp: 0, fn: 0 });
        return { evalId, totals, topPointers: items };
      });
      console.log('PerformanceChart.RemainingErrors JSON:\n' + JSON.stringify({ tag: 'PerformanceChart.RemainingErrors', excludedFields, evals: errorBreakdown }, null, 2));

      // If med_name contributes errors, enumerate which medication semantic keys are problematic
      const medNameErrors = Array.from(new Set(rowsOut.map(r => r.evalId))).map(evalId => {
        const keptForEval = filteredRows.filter(r => r.evaluation_id === evalId && r.field_path.includes('medications.medications[') && r.field_path.endsWith('.med_name'));
        const items = keptForEval
          .map(r => {
            const m = r.field_path.match(/medications\.medications\[(.*?)\]\.med_name/);
            const key = m?.[1] || '';
            const [name, dosage, frequency] = key.split('|');
            return {
              field_path: r.field_path,
              semantic_key: key,
              name: name || '',
              dosage: dosage || '',
              frequency: frequency || '',
              tp: r.tp || 0,
              fp: r.fp || 0,
              fn: r.fn || 0,
              tn: r.tn || 0,
              errors: (r.fp || 0) + (r.fn || 0),
            };
          })
          .filter(x => x.errors > 0)
          .sort((a, b) => b.errors - a.errors)
          .slice(0, 50);
        const totals = items.reduce((acc, it) => { acc.fp += it.fp; acc.fn += it.fn; return acc; }, { fp: 0, fn: 0 });
        return { evalId, totals, items };
      }).filter(section => section.items.length > 0);
      if (medNameErrors.length > 0) {
        console.log('PerformanceChart.MedNameErrors JSON:\n' + JSON.stringify({ tag: 'PerformanceChart.MedNameErrors', excludedFields, evals: medNameErrors }, null, 2));
      }
    } catch {}
    return rowsOut;
  }, [filteredRows, mode, evalIdToLabel, rows, excludedFields]);

  // Field mode: series per top-level section for selected metric
  const fieldData = useMemo(() => {
    if (mode !== 'field' || !filteredRows.length) return { data: [] as any[], series: [] as { key: string; label: string; color: string }[], minVal: 0 };
    const topLevels = Array.from(new Set(filteredRows.map(r => getTopLevelKey(r.field_path))));
    const series = topLevels.map((tl, idx) => ({ key: sanitizeKey(tl), label: toTitle(tl), color: SERIES_COLORS[idx % SERIES_COLORS.length] }));
    const evalToTs = new Map<number, string>();
    for (const r of filteredRows) {
      const current = evalToTs.get(r.evaluation_id);
      if (!current || new Date(r.created_at) < new Date(current)) evalToTs.set(r.evaluation_id, r.created_at);
    }
    const aggMap: Map<number, Map<string, { sum: number; count: number }>> = new Map();
    for (const r of filteredRows) {
      const evalId = r.evaluation_id;
      const top = getTopLevelKey(r.field_path);
      const seriesKey = sanitizeKey(top);
      const value = (r as any)[effectiveMetric] as number | undefined;
      if (value == null) continue;
      if (!aggMap.has(evalId)) aggMap.set(evalId, new Map());
      const mapForEval = aggMap.get(evalId)!;
      const agg = mapForEval.get(seriesKey) || { sum: 0, count: 0 };
      agg.sum += value; agg.count += 1;
      mapForEval.set(seriesKey, agg);
    }
    let minMetric = 1;
    const chartRows: any[] = Array.from(aggMap.entries()).map(([evalId, sectionMap]) => {
      const ts = evalToTs.get(evalId) || '';
      const label = evalIdToLabel.get(evalId) ?? String(evalId);
      const row: any = { x: label, timestamp: ts };
      for (const s of series) {
        const agg = sectionMap.get(s.key);
        const val = agg ? +(agg.sum / agg.count).toFixed(4) : null;
        row[s.key] = val;
        if (typeof val === 'number' && val < minMetric) minMetric = val;
      }
      row.__debugCounts = Object.fromEntries(Array.from(sectionMap.entries()).map(([k, v]) => [k, { sum: v.sum, count: v.count, avg: +(v.sum / Math.max(1, v.count)).toFixed(6) }]));
      row.__evalId = evalId;
      return row;
    });
    chartRows.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    try {
      const logObj = {
        tag: 'PerformanceChart.Field',
        excludedFields,
        metric: effectiveMetric,
        series: series.map(s => s.key),
        points: chartRows.map(r => ({ x: r.x, evalId: r.__evalId, counts: r.__debugCounts })),
      } as const;
      console.log('PerformanceChart.Field JSON:\n' + JSON.stringify(logObj, null, 2));
    } catch {}
    return { data: chartRows, series, minVal: minMetric };
  }, [filteredRows, mode, effectiveMetric, evalIdToLabel]);

  // Dynamic Y lower bound
  const yDomain: [number, number] = useMemo(() => {
    const rowsForMin = mode === 'overall' ? overallData : fieldData.data;
    if (!rowsForMin.length) return [0, 1];
    let minVal = 1;
    if (mode === 'overall') {
      for (const d of overallData) {
        const vals = [d.precision, d.recall, d.f1Score, d.accuracy];
        for (const v of vals) if (typeof v === 'number' && !Number.isNaN(v)) minVal = Math.min(minVal, v);
      }
    } else {
      minVal = fieldData.minVal || 0;
    }
    const start = Math.max(0, +(minVal - 0.05).toFixed(2));
    return [start, 1];
  }, [mode, overallData, fieldData]);

  const gridColor = isDarkMode ? '#374151' : '#e5e7eb';
  const textColor = isDarkMode ? '#ffffff' : '#111827';
  const axisColor = isDarkMode ? '#9ca3af' : '#6b7280';

  // Style to shift the entire line (path + default dots) left without moving the grid
  const lineShiftStyle = { transform: `translateX(${SHIFT_X}px)` } as const;

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 320, color: axisColor, fontSize: '1rem' }}>Loading performance data...</div>;
  }
  if (error) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 320, color: '#ef4444', fontSize: '1rem' }}>{error}</div>;
  }

  // Build legend items based on mode
  const legendItems = mode === 'overall'
    ? [
        { key: 'precision', label: 'precision', color: chartColors.precision },
        { key: 'recall', label: 'recall', color: chartColors.recall },
        { key: 'f1Score', label: 'f1Score', color: chartColors.f1Score },
        { key: 'accuracy', label: 'accuracy', color: chartColors.accuracy },
      ]
    : fieldData.series.map(s => ({ key: s.key, label: s.label, color: s.color }));

  const hasData = mode === 'overall' ? overallData.length > 0 : fieldData.data.length > 0;
  if (!hasData) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 320, color: axisColor, fontSize: '1rem' }}>No evaluation data available</div>;
  }

  const handleMetricChange = (m: MetricKey) => {
    if (onMetricChange) onMetricChange(m);
    else setLocalMetric(m);
  };

    return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {mode === 'field' && selectedMetric === undefined && (
        <MetricSelector selectedMetric={effectiveMetric} onChange={handleMetricChange} isDarkMode={isDarkMode} />
      )}
      
      <div style={{ position: 'relative', width: '100%' }}>
        {/* Legend positioned inside chart at top-right */}
        <div style={{ 
          position: 'absolute', 
          top: 16, 
          right: 16, 
          zIndex: 10,
          backgroundColor: isDarkMode ? 'rgba(31, 41, 55, 0.9)' : 'rgba(255, 255, 255, 0.9)',
          borderRadius: 6,
          padding: '8px 12px',
          border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`
        }}>
          <LegendList items={legendItems} isDarkMode={isDarkMode} />
        </div>
        
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={mode === 'overall' ? overallData : fieldData.data} margin={{ top: 8, right: 12, left: 6, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey={'x'} stroke={axisColor} tick={{ fill: axisColor, fontSize: 10, textAnchor: 'start' }} interval={0} tickMargin={10} angle={18} height={82} scale="band" padding={{ left: 6, right: 30 }} allowDuplicatedCategory={false} tickLine={false} />
            <YAxis stroke={axisColor} tick={{ fill: axisColor }} domain={yDomain} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} />
            <Tooltip 
              contentStyle={{ backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`, borderRadius: '8px', color: textColor }} 
              formatter={(value: number, name: string) => [`${(value * 100).toFixed(1)}%`, TOOLTIP_LABELS[name] || name]}
              itemSorter={(item: any) => (mode === 'overall' ? (TOOLTIP_ORDER[item?.name] ?? 999) : 0)}
            />
            {mode === 'overall' ? (
              <>
                <Line style={lineShiftStyle} type="monotone" dataKey="precision" stroke={chartColors.precision} strokeWidth={2} dot={{ fill: chartColors.precision, strokeWidth: 2, r: 3 }} activeDot={(p: any) => (
                  <circle cx={(p?.cx ?? 0) + SHIFT_X} cy={p?.cy ?? 0} r={5} fill={chartColors.precision} stroke={chartColors.precision} />
                )} isAnimationActive={true} animationDuration={400} animationEasing="ease-out" />
                <Line style={lineShiftStyle} type="monotone" dataKey="recall" stroke={chartColors.recall} strokeWidth={2} dot={{ fill: chartColors.recall, strokeWidth: 2, r: 3 }} activeDot={(p: any) => (
                  <circle cx={(p?.cx ?? 0) + SHIFT_X} cy={p?.cy ?? 0} r={5} fill={chartColors.recall} stroke={chartColors.recall} />
                )} isAnimationActive={true} animationDuration={400} animationEasing="ease-out" />
                <Line style={lineShiftStyle} type="monotone" dataKey="f1Score" stroke={chartColors.f1Score} strokeWidth={2} dot={{ fill: chartColors.f1Score, strokeWidth: 2, r: 3 }} activeDot={(p: any) => (
                  <circle cx={(p?.cx ?? 0) + SHIFT_X} cy={p?.cy ?? 0} r={5} fill={chartColors.f1Score} stroke={chartColors.f1Score} />
                )} isAnimationActive={true} animationDuration={400} animationEasing="ease-out" />
                <Line style={lineShiftStyle} type="monotone" dataKey="accuracy" stroke={chartColors.accuracy} strokeWidth={2} dot={{ fill: chartColors.accuracy, strokeWidth: 2, r: 3 }} activeDot={(p: any) => (
                  <circle cx={(p?.cx ?? 0) + SHIFT_X} cy={p?.cy ?? 0} r={5} fill={chartColors.accuracy} stroke={chartColors.accuracy} />
                )} isAnimationActive={true} animationDuration={400} animationEasing="ease-out" />
              </>
            ) : (
              fieldData.series.map((s) => (
                <Line key={s.key} style={lineShiftStyle} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ fill: s.color, strokeWidth: 2, r: 3 }} activeDot={(p: any) => (
                  <circle cx={(p?.cx ?? 0) + SHIFT_X} cy={p?.cy ?? 0} r={4} fill={s.color} stroke={s.color} />
                )} name={s.label} isAnimationActive={true} animationDuration={400} animationEasing="ease-out" />
              ))
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegendList({ items, isDarkMode }: { items: { key: string; label: string; color: string }[]; isDarkMode: boolean }) {
  const text = isDarkMode ? '#ffffff' : '#111827';
  const muted = isDarkMode ? '#9ca3af' : '#6b7280';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start' }}>
      {items.map((it) => (
        <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 9999, backgroundColor: it.color }} />
          <span style={{ color: muted, fontSize: 15 }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function MetricSelector({ selectedMetric, onChange, isDarkMode }: { selectedMetric: MetricKey; onChange: (k: MetricKey) => void; isDarkMode: boolean }) {
  const textColor = isDarkMode ? '#ffffff' : '#111827';
  const borderColor = isDarkMode ? '#4b5563' : '#d1d5db';
  const bgColor = isDarkMode ? '#111827' : '#ffffff';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label htmlFor="metric-select" style={{ color: textColor, fontSize: 14 }}>Metric:</label>
      <select
        id="metric-select"
        value={selectedMetric}
        onChange={(e) => onChange(e.target.value as MetricKey)}
        style={{ color: textColor, backgroundColor: bgColor, border: `1px solid ${borderColor}`, borderRadius: 8, padding: '6px 10px', fontSize: 14 }}
      >
        <option value="precision">Precision</option>
        <option value="recall">Recall</option>
        <option value="accuracy">Accuracy</option>
        <option value="f1_score">F1 Score</option>
      </select>
    </div>
  );
}

export default PerformanceChart; 