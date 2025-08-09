import React, { useState } from 'react';
import { listFiles, downloadFile, uploadGroundTruth } from '../../../services/api';
import { useSettings } from '../../../context/SettingsContext';

interface ExtractionJob {
  fileKey: string;
  fileName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  runNumber?: number;
  error?: string;
  startTime?: Date;
  endTime?: Date;
}

const EvaluationRunner: React.FC = () => {
  const { settings } = useSettings();

  // State
  const [jobs, setJobs] = useState<ExtractionJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const parseS3Uri = (uri: string) => {
    const match = uri.match(/^s3:\/\/(?<bucket>[^\/]+)\/(?<prefix>.*)$/);
    if (!match || !match.groups) {
      throw new Error('Invalid S3 URI. Expected format s3://bucket/prefix');
    }
    return {
      bucket: match.groups.bucket,
      prefix: match.groups.prefix
    };
  };

  const getFileHashFromKey = (key: string) => {
    const parts = key.split('/');
    const filename = parts[parts.length - 1];
    return filename.split('.')[0];
  };

  const loadSourceFiles = async () => {
    if (!settings.sourceDataPath) {
      setError('Source Data URI is required');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const sourceData = parseS3Uri(settings.sourceDataPath);
      const sourceResp = await listFiles(sourceData.bucket, sourceData.prefix || undefined);
      const sourceFileEntries: { key: string; original_name?: string }[] = sourceResp.data.files.sort((a: any, b: any) => {
        const nameA = (a.original_name || a.key).toLowerCase();
        const nameB = (b.original_name || b.key).toLowerCase();
        return nameA.localeCompare(nameB);
      });

      const newJobs: ExtractionJob[] = sourceFileEntries.map(entry => ({
        fileKey: entry.key,
        fileName: entry.original_name || entry.key.split('/').pop() || entry.key,
        status: 'pending'
      }));

      setJobs(newJobs);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || 'Failed to load source files');
    } finally {
      setLoading(false);
    }
  };

  const runExtraction = async (job: ExtractionJob): Promise<any> => {
    const sourceData = parseS3Uri(settings.sourceDataPath);
    
    // Download the PDF
    const blobResp = await downloadFile(sourceData.bucket, job.fileKey, true);
    const pdfBlob = new Blob([blobResp.data], { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', pdfBlob, job.fileName);

    // Build base URL
    const baseUrl = settings.extractionEndpoint.endsWith('/') ? settings.extractionEndpoint : settings.extractionEndpoint + '/';

    // Prepare headers
    const headers: Record<string, string> = {
      'accept': 'application/json',
    };

    if (settings.oauthToken) {
      headers['Authorization'] = `Bearer ${settings.oauthToken}`;
    }

    // Helper to extract GUID from various possible keys
    const extractGuid = (obj: any): string | undefined => {
      if (!obj) return undefined;
      const direct = obj.guid || obj.id || obj.job_id || obj.task_id || obj.JobId;
      if (direct) return direct;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof k === 'string' && ['guid','id','job_id','task_id','jobid'].includes(k.toLowerCase())) {
          return v as string;
        }
      }
      return undefined;
    };

    // 1) Upload
    const uploadUrl = new URL(baseUrl + 'api/v1/upload/');
    uploadUrl.searchParams.append('extraction_types', 'patient_profile');
    uploadUrl.searchParams.append('extraction_types', 'icd10_codes');
    uploadUrl.searchParams.append('extraction_types', 'medications');
    uploadUrl.searchParams.append('extraction_types', 'allergy');
    uploadUrl.searchParams.append('datacontext', 'eval_testing');

    const uploadResp = await fetch(uploadUrl.toString(), {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!uploadResp.ok) {
      throw new Error(`Upload failed: ${uploadResp.status} ${uploadResp.statusText}`);
    }

    const uploadJson = await uploadResp.json();
    const guid = extractGuid(uploadJson);
    if (!guid) {
      throw new Error(`Upload response missing GUID: ${JSON.stringify(uploadJson)}`);
    }

    // 2) Poll status
    const statusUrl = new URL(baseUrl + `api/v1/status/${guid}`);
    const maxWaitMs = 10 * 60 * 1000; // 10 minutes
    const pollBaseMs = 1500;
    const pollMaxMs = 5000;
    let waited = 0;
    let delay = pollBaseMs;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const statusResp = await fetch(statusUrl.toString(), { headers });
      if (!statusResp.ok) {
        // Treat as transient for a short while
        await new Promise(r => setTimeout(r, delay));
        waited += delay;
        delay = Math.min(pollMaxMs, Math.floor(delay * 1.5));
        if (waited > maxWaitMs) {
          throw new Error(`Status polling timed out after ${Math.round(maxWaitMs/1000)}s`);
        }
        continue;
      }

      const statusJson = await statusResp.json();
      const statusVal = String(statusJson.status || '').toLowerCase();
      if (['completed', 'complete', 'done', 'finished', 'success'].includes(statusVal)) {
        break;
      }
      if (['failed', 'error'].includes(statusVal)) {
        throw new Error(`Extraction failed for ${job.fileName}: ${JSON.stringify(statusJson)}`);
      }

      await new Promise(r => setTimeout(r, delay));
      waited += delay;
      delay = Math.min(pollMaxMs, Math.floor(delay * 1.5));
      if (waited > maxWaitMs) {
        throw new Error(`Status polling timed out after ${Math.round(maxWaitMs/1000)}s`);
      }
    }

    // 3) Retrieve
    const retrieveUrl = new URL(baseUrl + `api/v1/retrieve/${guid}`);
    const retrieveResp = await fetch(retrieveUrl.toString(), { headers });
    if (!retrieveResp.ok) {
      throw new Error(`Retrieve failed: ${retrieveResp.status} ${retrieveResp.statusText}`);
    }

    return await retrieveResp.json();
  };

  const generateEvaluationRunId = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const runId = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${runId}`;
  };

  const saveEvaluationMetadata = async (evaluationRunId: string) => {
    const responsesData = parseS3Uri(settings.responsesPath);
    const metadata = {
      evaluation_run_id: evaluationRunId,
      created_at: new Date().toISOString(),
      config: {
        source_data_uri: settings.sourceDataPath,
        responses_uri: settings.responsesPath,
        extraction_endpoint: settings.extractionEndpoint,
        extraction_types: ['patient_profile', 'icd10_codes', 'medications', 'allergy'],
        iterations: 1, // Frontend currently only does 1 iteration per job
        selected_files: jobs.map(job => job.fileName)
      },
      status: 'running'
    };
    
    const prefix = responsesData.prefix ? (responsesData.prefix.endsWith('/') ? responsesData.prefix : responsesData.prefix + '/') : '';
    const metadataKey = `${prefix}evaluation_runs/${evaluationRunId}/metadata.json`;
    
    try {
      await uploadGroundTruth(responsesData.bucket, metadataKey, JSON.stringify(metadata, null, 2));
      console.log('Saved evaluation metadata to:', metadataKey);
    } catch (error) {
      console.error('Failed to save evaluation metadata:', error);
    }
  };

  const saveResponse = async (job: ExtractionJob, extractionResult: any, runNumber: number, evaluationRunId: string) => {
    const responsesData = parseS3Uri(settings.responsesPath);
    const fileHash = getFileHashFromKey(job.fileKey);
    
    // Build key using new structure: evaluation_runs/{runId}/responses/{fileHash}/{runNumber}.json
    const prefix = responsesData.prefix ? (responsesData.prefix.endsWith('/') ? responsesData.prefix : responsesData.prefix + '/') : '';
    const responseKey = `${prefix}evaluation_runs/${evaluationRunId}/responses/${fileHash}/${runNumber}.json`;
    
    await uploadGroundTruth(responsesData.bucket, responseKey, JSON.stringify(extractionResult));
  };

  const runEvaluations = async () => {
    if (!settings.sourceDataPath || !settings.responsesPath || !settings.extractionEndpoint) {
      setError('All configuration fields are required');
      return;
    }

    setIsRunning(true);
    setError(null);

    // Generate evaluation run ID for this batch
    const evaluationRunId = generateEvaluationRunId();
    console.log('Starting evaluation run:', evaluationRunId);

    // Save evaluation metadata
    await saveEvaluationMetadata(evaluationRunId);

    const CONCURRENCY = 4;
    let cursor = 0;

    const worker = async () => {
      while (true) {
        let index: number;
        let job: ExtractionJob | undefined;
        // get next job
        ({ index, job } = (() => {
          if (cursor >= jobs.length) return { index: -1, job: undefined };
          const i = cursor;
          cursor += 1;
          return { index: i, job: jobs[i] };
        })());
        if (job === undefined || index === -1) break;

        // mark running
        setJobs(prev => prev.map((j, idx) => idx === index ? { ...j, status: 'running', startTime: new Date() } : j));
        try {
          const extractionResult = await runExtraction(job);
          const runNumber = 1;
          await saveResponse(job, extractionResult, runNumber, evaluationRunId);
          setJobs(prev => prev.map((j, idx) => idx === index ? { ...j, status: 'completed', runNumber, endTime: new Date() } : j));
        } catch (err: any) {
          console.error('Extraction failed for', job.fileName, err);
          setJobs(prev => prev.map((j, idx) => idx === index ? { ...j, status: 'failed', error: err?.message || String(err), endTime: new Date() } : j));
        }
      }
    };

    // Launch workers
    const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker());
    await Promise.all(workers);

    setIsRunning(false);
  };

  const getStatusColor = (status: ExtractionJob['status']) => {
    switch (status) {
      case 'pending': return '#6c757d';
      case 'running': return '#007bff';
      case 'completed': return '#28a745';
      case 'failed': return '#dc3545';
      default: return '#6c757d';
    }
  };

  const getStatusIcon = (status: ExtractionJob['status']) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'running': return '🔄';
      case 'completed': return '✅';
      case 'failed': return '❌';
      default: return '⏳';
    }
  };

  const completedCount = jobs.filter(j => j.status === 'completed').length;
  const failedCount = jobs.filter(j => j.status === 'failed').length;

  return (
    <div style={{ marginTop: '2rem' }}>
      {!settings.sourceDataPath || !settings.responsesPath || !settings.extractionEndpoint ? (
        <div style={{ 
          background: '#fff3cd', 
          padding: '1.5rem', 
          borderRadius: '8px', 
          marginBottom: '2rem',
          border: '1px solid #ffeaa7',
          textAlign: 'center'
        }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#856404' }}>Configuration Required</h3>
          <p style={{ margin: '0 0 1rem 0', color: '#856404' }}>
            Please configure your settings in the <strong>Settings</strong> tab before running evaluations.
          </p>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#856404' }}>
            Required: Source Data URI, Evaluation Runs URI, and Extraction Endpoint
          </p>
        </div>
      ) : (
        <div style={{ 
          background: '#f8f9fa', 
          padding: '1.5rem', 
          borderRadius: '8px', 
          marginBottom: '2rem',
          border: '1px solid #e9ecef'
        }}>
          <h2 style={{ margin: '0 0 1.5rem 0', color: '#495057' }}>Evaluation Runner</h2>
          
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <button
              onClick={loadSourceFiles}
              disabled={loading}
              style={{ 
                padding: '0.75rem 2rem',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: '500'
              }}
            >
              {loading ? 'Loading…' : 'Load Source Files'}
            </button>

            <button
              onClick={runEvaluations}
              disabled={isRunning || jobs.length === 0}
              style={{ 
                padding: '0.75rem 2rem',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: '500'
              }}
            >
              {isRunning ? 'Running Evaluations…' : 'Start Evaluation Run'}
            </button>
          </div>

          {jobs.length > 0 && (
            <div style={{ 
              display: 'flex', 
              gap: '2rem', 
              fontSize: '0.9rem',
              color: '#495057',
              fontWeight: '500'
            }}>
              <span>Total: {jobs.length}</span>
              <span style={{ color: '#28a745' }}>Completed: {completedCount}</span>
              <span style={{ color: '#dc3545' }}>Failed: {failedCount}</span>
              <span>Remaining: {jobs.length - completedCount - failedCount}</span>
            </div>
          )}

          {error && (
            <div style={{ 
              marginTop: '1rem',
              padding: '0.75rem',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              border: '1px solid #f5c6cb',
              borderRadius: '4px',
              fontSize: '0.9rem'
            }}>
              {error}
            </div>
          )}
        </div>
      )}

      {jobs.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 1rem 0', color: '#495057' }}>Extraction Jobs</h3>
          <div style={{ 
            maxHeight: '400px', 
            overflowY: 'auto',
            border: '1px solid #dee2e6',
            borderRadius: '8px',
            backgroundColor: 'white'
          }}>
            {jobs.map((job, index) => (
              <div
                key={job.fileKey}
                style={{
                  padding: '1rem',
                  borderBottom: index < jobs.length - 1 ? '1px solid #dee2e6' : 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '500', marginBottom: '0.25rem' }}>
                    {job.fileName}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                    {job.fileKey}
                  </div>
                  {job.error && (
                    <div style={{ fontSize: '0.8rem', color: '#dc3545', marginTop: '0.25rem' }}>
                      Error: {job.error}
                    </div>
                  )}
                </div>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  color: getStatusColor(job.status),
                  fontWeight: '500'
                }}>
                  <span>{getStatusIcon(job.status)}</span>
                  <span style={{ textTransform: 'capitalize' }}>{job.status}</span>
                  {job.runNumber && <span>(Run #{job.runNumber})</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EvaluationRunner; 