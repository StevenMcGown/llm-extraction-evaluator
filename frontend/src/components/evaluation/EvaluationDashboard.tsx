import React, { useState, useEffect, useCallback } from 'react';
import MetricsOverview from './metrics_overview/MetricsOverview';
import DocumentResultsViewer from './evaluation_results/DocumentResultsViewer';
import SimilarityLegend, { SimilarityLegendItem } from './evaluation_results/SimilarityLegend';
import { useSettings } from '../../context/SettingsContext';
import { runEvaluation, getEvaluationResult, getEvaluationFromS3, listEvaluations, listSourceFiles, recalculateEvaluation } from '../../services/api';
import { queryTable, getEvaluationMetrics } from '../../services/api';
// add import after others
import EvaluationSettings from './evaluation_settings/EvaluationSettings';

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

interface DocumentResult {
  filename: string;
  fileHash: string;
  groundTruth: any;
  apiResponses: any[];
  scores: Record<string, number>;
  mismatches: string[];
  // New fields for per-iteration evaluation
  iteration_scores?: Record<string, number>[];  // Scores for each iteration
  iteration_mismatches?: string[][];  // Mismatches for each iteration
}

interface BackendEvaluationMetrics {
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  true_negatives: number;
  precision: number;
  recall: number;
  f1_score: number;
  accuracy: number;
}

interface EvaluationResult {
  evaluation_id: string;
  status: string;
  documents: DocumentResult[];
  metrics: BackendEvaluationMetrics;
  total_files: number;
  completed_files: number;
  total_iterations: number;
  completed_iterations: number;
  errors: string[];
}

interface EvaluationDashboardProps {
  isDarkMode: boolean;
  setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
}

const EvaluationDashboard: React.FC<EvaluationDashboardProps> = ({ isDarkMode, setIsDarkMode }) => {
  const { settings } = useSettings();
  const [metrics, setMetrics] = useState<EvaluationMetrics>({
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    trueNegatives: 0,
    precision: 0,
    recall: 0,
    f1Score: 0,
    accuracy: 0,
  });

  const [documents, setDocuments] = useState<DocumentResult[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentResult | null>(null);
  const [activeTab, setActiveTab] = useState<'groundTruth' | 'apiResponse' | 'pdf'>('groundTruth');
  const [selectedIteration, setSelectedIteration] = useState<number>(0);
  const [calculationLog, setCalculationLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // New state for evaluation controls
  const [iterations, setIterations] = useState<number>(() => {
    const saved = localStorage.getItem('evaluationIterations');
    return saved ? parseInt(saved, 10) : 3;
  });
  const [isRunningEvaluation, setIsRunningEvaluation] = useState<boolean>(false);
  const [currentEvaluationId, setCurrentEvaluationId] = useState<string | null>(null);
  const [evaluationStatus, setEvaluationStatus] = useState<string>('');
  const [hasRealData, setHasRealData] = useState<boolean>(false);
  const [extractionTypes, setExtractionTypes] = useState<string[]>([
    'patient_profile', 'icd10_codes', 'medications', 'allergy'
  ]);
  const [excludedFields, setExcludedFields] = useState<string[]>([]);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressText, setProgressText] = useState<string>('');
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>(() => {
    const saved = localStorage.getItem('evaluationSelectedFiles');
    return saved ? JSON.parse(saved) : [];
  });
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshTimestamp, setRefreshTimestamp] = useState<number>(Date.now());
  const hasInitializedExcludedRefresh = React.useRef<boolean>(false);
  
  // State for loading evaluations by run ID
  const [runIdInput, setRunIdInput] = useState<string>('');
  const [isLoadingRunId, setIsLoadingRunId] = useState<boolean>(false);

  // Save iterations to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('evaluationIterations', iterations.toString());
  }, [iterations]);

  // Save selected files to localStorage when they change
  useEffect(() => {
    localStorage.setItem('evaluationSelectedFiles', JSON.stringify(selectedFiles));
  }, [selectedFiles]);


  // Load last evaluation (if remembered), otherwise fallback to most recent completed
  useEffect(() => {
    const lastId = localStorage.getItem('lastEvaluationId');
    if (lastId) {
      getEvaluationResult(lastId)
        .then(resp => {
          loadEvaluationData(resp.data);
          setHasRealData(true);
        })
        .catch(() => {
          // If the remembered ID is not in memory anymore, try S3 loader
          if (settings.responsesPath) {
            getEvaluationFromS3(lastId, settings.responsesPath)
              .then(resp => { loadEvaluationData(resp.data); setHasRealData(true); })
              .catch(() => loadExistingEvaluations());
          } else {
            loadExistingEvaluations();
          }
        });
    } else {
      loadExistingEvaluations();
    }
  }, [settings.responsesPath]);

  // Load source files when settings change
  useEffect(() => {
    if (settings.sourceDataPath) {
      loadSourceFiles();
    }
  }, [settings.sourceDataPath]);

  const loadSourceFiles = async () => {
    try {
      // console.log('Loading source files from:', settings.sourceDataPath);

      const response = await listSourceFiles(settings.sourceDataPath);
      const files = response.data.files;

      // console.log('Received files from backend:', files);

      // Extract just the filenames for the UI and sort alphabetically
      const filenames = files.map((file: any) => file.filename).sort();
      // console.log('Setting source files:', filenames);
      setSourceFiles(filenames);

      // Filter saved selected files to only include files that still exist
      // If no saved selection exists, select all files by default
      const savedSelected = localStorage.getItem('evaluationSelectedFiles');
      if (savedSelected) {
        try {
          const savedFiles: string[] = JSON.parse(savedSelected);
          const validSelectedFiles = savedFiles.filter(file => filenames.includes(file));
          
          if (validSelectedFiles.length > 0) {
            setSelectedFiles(validSelectedFiles);
            // console.log('Restored saved file selection:', validSelectedFiles);
          } else {
            // If no saved files are valid anymore, select all
            setSelectedFiles(filenames);
            // console.log('No saved files exist anymore, selecting all files:', filenames);
          }
        } catch (error) {
          console.warn('Failed to parse saved selected files, defaulting to all files');
          setSelectedFiles(filenames);
        }
      } else {
        // No saved selection, select all files by default
        setSelectedFiles(filenames);
        // console.log('No saved selection found, selected all files:', filenames);
      }
    } catch (error) {
      console.error('Failed to load source files:', error);
      setError('Failed to load source files');
    }
  };

  // Poll for evaluation status when running
  useEffect(() => {
    let interval: number;
    if (currentEvaluationId && isRunningEvaluation) {
      interval = setInterval(async () => {
        const timestamp = new Date().toLocaleTimeString();
        try {
          const response = await getEvaluationResult(currentEvaluationId);
          const result: EvaluationResult = response.data;

          // Debug logging for iteration tracking
          // console.log(`🔄 [${timestamp}] Polling evaluation ${currentEvaluationId}:`, {
          //   status: result.status,
          //   completed_iterations: result.completed_iterations,
          //   total_iterations: result.total_iterations,
          //   completed_files: result.completed_files,
          //   total_files: result.total_files
          // });

          // Update progress - use iterations for more granular tracking
          const progress = result.total_iterations > 0 ? (result.completed_iterations / result.total_iterations) * 100 : 0;
          // console.log(`📊 [${timestamp}] Progress calculation: ${result.completed_iterations}/${result.total_iterations} = ${progress.toFixed(1)}%`);
          
          // Defensive check: don't reset progress to 0 if we already have progress and evaluation is still running
          if (progress > 0 || progressPercent === 0) {
            setProgressPercent(progress);
            // console.log(`📊 [${timestamp}] Updated progress to ${progress.toFixed(1)}% (bar should be visible: ${isRunningEvaluation || progress > 0})`);
          } else if (result.status === 'running' && progressPercent > 0) {
            // console.log(`⚠️ [${timestamp}] Keeping existing progress ${progressPercent}% instead of resetting to ${progress}% (bar should be visible: ${isRunningEvaluation || progressPercent > 0})`);
          }
          
          setProgressText(`${result.completed_iterations}/${result.total_iterations} iterations completed (${result.completed_files}/${result.total_files} files)`);
          setEvaluationStatus(result.status);

          if (result.status === 'completed' || result.status === 'failed') {
            // console.log(`🏁 [${timestamp}] Evaluation finished! Status: ${result.status}, Final progress: ${result.completed_iterations}/${result.total_iterations}`);
            setIsRunningEvaluation(false);
            // console.log(`📊 [${timestamp}] Set isRunningEvaluation to false - this will hide the progress bar`);
            
            // Set progress to actual completion percentage, not always 100%
            const finalProgress = result.total_iterations > 0 ? (result.completed_iterations / result.total_iterations) * 100 : 100;
            setProgressPercent(finalProgress);
            // console.log(`📊 [${timestamp}] Final progress set to ${finalProgress}% - bar should still be visible for a moment`);
            
            // Keep the progress bar visible for 3 seconds after completion
            setTimeout(() => {
              // console.log(`⏰ [${new Date().toLocaleTimeString()}] Hiding progress bar 3 seconds after completion`);
              setProgressPercent(0); // This will hide the progress bar since isRunningEvaluation is already false
            }, 3000);
            
            if (result.status === 'completed' || result.completed_files > 0) {
              loadEvaluationData(result);
              setHasRealData(true);
              setProgressText(`Completed: ${result.completed_iterations}/${result.total_iterations} iterations (${result.completed_files}/${result.total_files} files)`);
            } else {
              setError(`Evaluation failed: ${result.errors.join(', ')}`);
              setProgressText(`Failed after ${result.completed_iterations}/${result.total_iterations} iterations (${result.completed_files}/${result.total_files} files)`);
            }
          }
        } catch (err: any) {
          console.error('Failed to poll evaluation status:', err);
          // Don't hide the progress bar on polling errors - the evaluation might still be running
          // Just log the error and continue polling
          // console.log(`⚠️ [${timestamp}] Polling error, but keeping evaluation UI visible`);
        }
      }, 250); // Reduced from 500ms to 250ms for very frequent polling during multiple file processing
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentEvaluationId, isRunningEvaluation, progressPercent]);

  const loadExistingEvaluations = async () => {
    try {
      const response = await listEvaluations();
      const evaluations = response.data.evaluations;

      // Load the most recent completed evaluation if any
      const completedEvals = evaluations.filter((e: any) => e.status === 'completed');
      if (completedEvals.length > 0) {
        const latestEval = completedEvals[0];
        const resultResponse = await getEvaluationResult(latestEval.evaluation_id);
        loadEvaluationData(resultResponse.data);
        setHasRealData(true);
      }
    } catch (err) {
      // console.log('No existing evaluations found or failed to load');
      // This is not an error - just means no evaluations exist yet
    }
  };

  const loadEvaluationData = (result: EvaluationResult) => {
    // console.log('Raw evaluation result:', result);
    // console.log('Number of documents from backend:', result.documents.length);
    // console.log('Evaluation errors:', result.errors);
    // console.log('Total files found:', result.total_files);
    // console.log('Completed files:', result.completed_files);

    // Set current evaluation ID if available in result and remember it
    if (result.evaluation_id) {
      setCurrentEvaluationId(result.evaluation_id);
      try { localStorage.setItem('lastEvaluationId', result.evaluation_id); } catch {}
    }

    // Convert backend format to frontend format
    const mappedDocuments: DocumentResult[] = result.documents.map((doc: any) => ({
      filename: doc.filename,
      fileHash: doc.file_hash,
      groundTruth: doc.ground_truth,
      apiResponses: doc.api_responses,
      scores: doc.scores,
      mismatches: doc.mismatches,
      iteration_scores: doc.iteration_scores || [],
      iteration_mismatches: doc.iteration_mismatches || []
    }));

    // console.log('Mapped documents for frontend:', mappedDocuments);
    setDocuments(mappedDocuments);

    // Map backend metrics to frontend format
    // console.log('Raw metrics from backend:', result.metrics);
    const mappedMetrics: EvaluationMetrics = {
      truePositives: result.metrics.true_positives,
      falsePositives: result.metrics.false_positives,
      falseNegatives: result.metrics.false_negatives,
      trueNegatives: result.metrics.true_negatives,
      precision: result.metrics.precision,
      recall: result.metrics.recall,
      f1Score: result.metrics.f1_score,
      accuracy: result.metrics.accuracy,
    };
    // console.log('Mapped metrics for frontend:', mappedMetrics);
    setMetrics(mappedMetrics);

    // Generate issues log from all document mismatches
    const allMismatches = mappedDocuments.flatMap(doc => {
      if (doc.iteration_mismatches && doc.iteration_mismatches.length > 0) {
        return doc.iteration_mismatches.flat();
      }
      return doc.mismatches;
    });
    setCalculationLog(allMismatches);

    // DB-based recomputation disabled: rely exclusively on live in-memory metrics
    // (previously triggered recomputeMetricsFromDb here)

    // Emit structured logs similar to dashboard
    try {
      // Colored per-field console logging for TP / FP / FN (TN is aggregated)
      const logPerField = () => {
        const styleTP = 'color:#065f46;font-weight:600';
        const styleFP = 'color:#991b1b;font-weight:600';
        const styleFN = 'color:#92400e;font-weight:600';
        const styleTN = 'color:#475569;font-weight:600';

        console.groupCollapsed('%cPer-field Confusion (iteration view where available)', 'color:#2563eb');
        for (const doc of mappedDocuments) {
          const scores = (doc.iteration_scores && doc.iteration_scores[0]) ? doc.iteration_scores[0] : doc.scores || {};
          const tp: string[] = [];
          const fp: string[] = [];
          const fn: string[] = [];

          for (const [path, score] of Object.entries(scores)) {
            if (score >= 0.99 || score > 0.0) tp.push(path);
            else if (score === -1.0) fp.push(path);
            else if (score === -2.0) fn.push(path);
          }

          console.groupCollapsed(`%c${doc.filename} (${doc.fileHash.slice(0,8)}...)`, 'color:#374151');
          for (const p of tp) console.log('%c[TP]', styleTP, p);
          for (const p of fp) console.log('%c[FP]', styleFP, p);
          for (const p of fn) console.log('%c[FN]', styleFN, p);
          // TNs are not emitted per field by backend; show aggregated total instead
          console.log('%c[TN] aggregated total:', styleTN, mappedMetrics.trueNegatives);
          console.groupEnd();
        }
        console.groupEnd();
      };
      logPerField();
    } catch {}

    setError(null);
  };

  // Compute metrics from DB rows just like the dashboard (ensures parity)
  // DB recompute disabled (no-op). Keeping the signature to avoid refactor ripple.
  const recomputeMetricsFromDb = async (runId: string | null, excluded: string[]) => {
    return;
    if (!runId) return;
    // 1) Fetch field_performance rows and evaluation_metrics mapping
    // const [fieldResp, metricsResp] = await Promise.all([
    //   queryTable('field_performance', 5000),
    //   getEvaluationMetrics(1000),
    // ]);
    const fieldRows: any[] = [];
    const metricsRows: any[] = [];

    // 2) Map evaluation_metrics.id -> label (file_id or run label), find id for this run
    const evalIdForRun = (() => {
      for (const m of metricsRows) {
        const idNum = Number(m.id);
        const label = String(m.file_id ?? idNum);
        if (label === runId) return idNum;
      }
      return null;
    })();
    if (evalIdForRun == null) return;

    // 3) Filter rows for this evaluation
    const rowsForEval = fieldRows.filter((r: any) => Number(r.evaluation_id) === evalIdForRun);

    // 4) Apply the same excludedFields filtering by converting field_path to JSON pointer
    const toPtr = (fieldPath: string) => {
      let ptr = String(fieldPath || '').replace(/\[.*?\]/g, '');
      ptr = ptr.replace(/\./g, '/');
      if (!ptr.startsWith('/')) ptr = '/' + ptr;
      return ptr;
    };
    const filtered = rowsForEval.filter((r: any) => {
      const ptr = toPtr(String(r.field_path || ''));
      return !excluded.some(ex => ptr.startsWith(ex));
    });

    // 5) Sum counts for TP/FP/FN/TN directly from field rows
    const sums = filtered.reduce((acc: any, r: any) => {
      acc.tp += Number(r.tp ?? 0);
      acc.fp += Number(r.fp ?? 0);
      acc.fn += Number(r.fn ?? 0);
      acc.tn += Number(r.tn ?? 0);
      return acc;
    }, { tp: 0, fp: 0, fn: 0, tn: 0 });

    const tn = sums.tn;

    const precision = (sums.tp + sums.fp) > 0 ? sums.tp / (sums.tp + sums.fp) : 0;
    const recall = (sums.tp + sums.fn) > 0 ? sums.tp / (sums.tp + sums.fn) : 0;
    const f1Score = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const accuracy = (sums.tp + sums.fp + sums.fn + tn) > 0 ? (sums.tp + tn) / (sums.tp + sums.fp + sums.fn + tn) : 0;

    setMetrics({
      truePositives: sums.tp,
      falsePositives: sums.fp,
      falseNegatives: sums.fn,
      trueNegatives: tn,
      precision,
      recall,
      f1Score,
      accuracy,
    });

    try {
      console.log('EvaluationPage.DBAligned JSON\n' + JSON.stringify({
        tag: 'EvaluationPage.DBAligned',
        runId,
        excludedFields: excluded,
        counts: sums,
        metrics: { precision, recall, f1Score, accuracy },
        rowsUsed: filtered.length,
      }, null, 2));
    } catch {}
  };

  // DB-based recomputation disabled. If needed later, re-enable and ensure DB rows are complete.
  // useEffect(() => {
  //   if (currentEvaluationId && hasRealData) {
  //     recomputeMetricsFromDb(currentEvaluationId, excludedFields).catch(() => {});
  //   }
  // }, [currentEvaluationId, excludedFields, hasRealData]);

  const loadEvaluationByRunId = async () => {
    if (!runIdInput.trim()) {
      setError('Please enter a run ID');
      return;
    }

    if (!settings.responsesPath) {
      setError('Please configure the Evaluation Runs URI in settings');
      return;
    }

    setIsLoadingRunId(true);
    setError(null);

    try {
      // console.log('Loading evaluation by run ID:', runIdInput);
      const response = await getEvaluationFromS3(runIdInput.trim(), settings.responsesPath);
      const result = response.data;
      
      // console.log('Loaded evaluation from S3:', result);
      loadEvaluationData(result);
      setHasRealData(true);
      
      // Clear the input after successful load
      setRunIdInput('');
    } catch (error: any) {
      console.error('Failed to load evaluation by run ID:', error);
      setError(error.response?.data?.detail || `Failed to load evaluation with run ID: ${runIdInput}`);
    } finally {
      setIsLoadingRunId(false);
    }
  };

  const startEvaluation = async () => {
    if (!settings.sourceDataPath || !settings.groundTruthPath || !settings.extractionEndpoint) {
      setError('Please configure all required settings (Source Data URI, Ground Truth URI, and Extraction Endpoint) in the Settings tab');
      return;
    }

    if (selectedFiles.length === 0) {
      setError('Please select at least one file to process');
      return;
    }

    setIsRunningEvaluation(true);
    setError(null);
    setEvaluationStatus('Starting evaluation...');
    setProgressPercent(0);
    setProgressText(`Processing ${selectedFiles.length} selected files...`);

    try {
      // console.log('Starting evaluation with selected files:', selectedFiles);
      // console.log('Settings:', {
      //   sourceDataPath: settings.sourceDataPath,
      //   groundTruthPath: settings.groundTruthPath,
      //   extractionEndpoint: settings.extractionEndpoint,
      //   extractionTypes: extractionTypes,
      //   excludedFields: excludedFields
      // });

      if (excludedFields.length > 0) {
        // console.log('🔍 Excluded fields that will be ignored in evaluation:');
        excludedFields.forEach((field, index) => {
          // console.log(`  ${index + 1}. ${field}`);
        });
      } else {
        // console.log('ℹ️ No fields excluded - all selected extraction types will be fully evaluated');
      }

      const response = await runEvaluation({
        source_data_uri: settings.sourceDataPath,
        ground_truth_uri: settings.groundTruthPath,
        extraction_endpoint: settings.extractionEndpoint,
        responses_uri: settings.responsesPath || undefined,
        oauth_token: settings.oauthToken || undefined,
        iterations: iterations,
        extraction_types: extractionTypes,
        excluded_fields: excludedFields,
        selected_files: selectedFiles // Add selected files to the request
      });

      // console.log('🚀 Evaluation started successfully:', response.data);
      setCurrentEvaluationId(response.data.evaluation_id);
      setEvaluationStatus('running');
      setProgressText(`Processing ${selectedFiles.length} selected files...`);
      
      // Immediately poll once to get the initial state
      setTimeout(async () => {
        try {
          const initialResponse = await getEvaluationResult(response.data.evaluation_id);
          const initialResult = initialResponse.data;
          // console.log('🔍 Initial evaluation state:', initialResult);
          
          const initialProgress = initialResult.total_iterations > 0 ? (initialResult.completed_iterations / initialResult.total_iterations) * 100 : 0;
          setProgressPercent(initialProgress);
          setProgressText(`${initialResult.completed_iterations}/${initialResult.total_iterations} iterations completed (${initialResult.completed_files}/${initialResult.total_files} files)`);
        } catch (err) {
          console.error('Failed to get initial evaluation state:', err);
        }
      }, 100); // Poll after 100ms to get initial state
    } catch (err: any) {
      console.error('Failed to start evaluation:', err);
      setError(err.response?.data?.detail || 'Failed to start evaluation');
      setIsRunningEvaluation(false);
      setProgressPercent(0);
      setProgressText('');
    }
  };

  const formatPercentage = (value: number): string => {
    return (value * 100).toFixed(1) + '%';
  };

  const handleRefreshCalculations = useCallback(async () => {
    if (!currentEvaluationId || !settings.groundTruthPath || !settings.responsesPath) return;

    // Always recalculate on demand (e.g., after GT save)

    setIsRefreshing(true);
    try {
      const response = await recalculateEvaluation(currentEvaluationId, settings.groundTruthPath, settings.responsesPath, extractionTypes, excludedFields);
      const result = response.data;

      // Update the displayed data with recalculated results
      loadEvaluationData(result);

      // Force re-render of components by updating timestamp
      setRefreshTimestamp(Date.now());
    } catch (error: any) {
      console.error('Failed to refresh calculations:', error);
      setError('Failed to refresh calculations: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsRefreshing(false);
    }
  }, [currentEvaluationId, settings.groundTruthPath, settings.responsesPath, extractionTypes, excludedFields]);

  // Auto-refresh calculations when excluded fields change or after GT save
  useEffect(() => {
    if (!currentEvaluationId || !settings.groundTruthPath || !settings.responsesPath) {
      return;
    }

    // Skip initial mount to avoid overwriting initial metrics with a recalc
    if (!hasInitializedExcludedRefresh.current) {
      hasInitializedExcludedRefresh.current = true;
      return;
    }

    const timeoutId = setTimeout(() => {
      handleRefreshCalculations();
    }, 600); // slight debounce

    return () => clearTimeout(timeoutId);
  }, [excludedFields, currentEvaluationId, settings.groundTruthPath, settings.responsesPath, handleRefreshCalculations]);



  const similarityLegend = [
    { range: '1.0', color: '#28a745', description: 'Perfect Match' },
    { range: '0.7 - 0.9', color: '#fd7e14', description: 'Good Match' },
    { range: '0.5 - 0.7', color: '#ffc107', description: 'Fair Match' },
    { range: '0 - 0.5', color: '#dc3545', description: 'Poor Match' },
    { range: 'Missing', color: '#6f42c1', description: 'Not Found' },
    { range: 'Excluded', color: '#6b7280', description: 'Excluded fields' },
  ];

  return (
    <div style={{
      padding: '2rem',
      maxWidth: '1400px', // Constrain width for most content
      margin: '0 auto',
      backgroundColor: isDarkMode ? '#1a1a1a' : '#f8fafc',
      minHeight: '100vh',
      color: isDarkMode ? '#ffffff' : '#000000',
      transition: 'all 0.3s ease',
      width: '100%',
      boxSizing: 'border-box'
    }}>
      {/* Dark Mode Toggle */}
      {/* Removed floating dark mode toggle button; will be placed in App.tsx top bar */}

      <div style={{
        textAlign: 'center',
        marginBottom: '3rem',
        background: isDarkMode
          ? 'linear-gradient(135deg, #374151 0%, #1f2937 100%)'
          : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        padding: '2rem',
        borderRadius: '16px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
      }}>
        <h1 style={{
          margin: '0',
          fontSize: '2.5rem',
          fontWeight: '700',
          letterSpacing: '-0.02em'
        }}>
          📊 PDF Extraction Evaluation Dashboard
        </h1>
        <p style={{
          margin: '0.5rem 0 0 0',
          fontSize: '1.1rem',
          opacity: 0.9
        }}>
          Advanced document processing analysis and metrics
        </p>
      </div>

      {/* Evaluation Settings */}
      <EvaluationSettings
        iterations={iterations}
        setIterations={setIterations}
        extractionTypes={extractionTypes}
        setExtractionTypes={setExtractionTypes}
        excludedFields={excludedFields}
        setExcludedFields={setExcludedFields}
        sourceFiles={sourceFiles}
        selectedFiles={selectedFiles}
        setSelectedFiles={setSelectedFiles}
        isRunningEvaluation={isRunningEvaluation}
        startEvaluation={startEvaluation}
        progressPercent={progressPercent}
        progressText={progressText}
        evaluationStatus={evaluationStatus}
        isDarkMode={isDarkMode}
        runIdInput={runIdInput}
        setRunIdInput={setRunIdInput}
        isLoadingRunId={isLoadingRunId}
        loadEvaluationByRunId={loadEvaluationByRunId}
      />

      {/* Mock Data Warning - only show if no real data */}
      {!hasRealData && (
        <div style={{
          background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
          color: '#1e40af',
          border: '1px solid #3b82f6',
          borderRadius: '12px',
          padding: '2rem',
          marginBottom: '2rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📋</div>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: '600' }}>
            No Evaluation Data Available
          </h3>
          <p style={{ margin: 0, fontSize: '1rem', opacity: 0.8 }}>
            Run an evaluation above to see detailed metrics and results
          </p>
        </div>
      )}

      {error && (
        <div style={{
          background: '#f8d7da',
          color: '#721c24',
          border: '1px solid #f5c6cb',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '2rem'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Evaluation Results */}
      {documents.length > 0 && (
        <>
          {/* Metrics Overview */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h1 style={{
              margin: '0',
              color: isDarkMode ? '#ffffff' : '#1e293b',
              fontSize: '1.25rem',
              fontWeight: '600'
            }}>
              Metrics Overview
            </h1>
          </div>
          {hasRealData && (
            <div style={{ marginBottom: '2rem' }}>
              <MetricsOverview
                metrics={metrics}
                isDarkMode={isDarkMode}
                calculationLog={calculationLog}
                similarityLegend={similarityLegend}
              />
            </div>
          )}

          {/* Issues Log - Full Width */}
          {/* IssuesLog component removed */}

        </>
      )}

      {/* Document Comparison Results - Below Confusion Matrix */}
            {documents.length > 0 && (
        <h2 style={{ 
          position: 'absolute',
          left: '2.5rem',
          margin: '3.5rem 0 1rem 0', 
          color: isDarkMode ? '#ffffff' : '#495057', 
          fontSize: '1.5rem', 
          fontWeight: '600' 
        }}>
          Extraction Results
        </h2>
      )}

      {/* Similarity Legend Container */}
      {documents.length > 0 && hasRealData && (
        <div style={{ 
          marginTop: '2rem', 
          marginBottom: '-2rem', 
          position: 'relative', 
          left: '50%', 
          transform: 'translateX(-50%)', 
          width: 'calc(60vw - 6rem)', 
          background: isDarkMode ? '#1f2937' : 'white', 
          border: `1px solid ${isDarkMode ? '#374151' : '#e2e8f0'}`, 
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)', 
          padding: '1rem', 
          borderRadius: '8px',
          display: 'flex',
          justifyContent: 'center'
        }}>
          <SimilarityLegend items={similarityLegend} isDarkMode={isDarkMode} />
        </div>
      )}

      {documents.length > 0 && (
        <div style={{ marginTop: '0', marginBottom: '2rem', position: 'relative', left: '50%', transform: 'translateX(-50%)', width: 'calc(100vw - 6rem)', padding: '2rem' }}>
        {/* Document List View */}
        <DocumentResultsViewer
          documents={documents}
          selectedDocument={selectedDocument}
          setSelectedDocument={setSelectedDocument}
          selectedIteration={selectedIteration}
          setSelectedIteration={setSelectedIteration}
          settings={settings}
          isDarkMode={isDarkMode}
          setDocuments={setDocuments}
          excludedFields={excludedFields}
          onGroundTruthSaved={handleRefreshCalculations}
          key={refreshTimestamp}
        />
        </div>
      )}
    </div>
  );
};

export default EvaluationDashboard; 