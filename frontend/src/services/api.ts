import axios from 'axios';

// Default API client points to FastAPI backend
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const apiClient = axios.create({
  baseURL: (import.meta as any).env.VITE_API_BASE_URL || 'http://localhost:8000',
});

export const getHealth = () => apiClient.get('/health');

// ---- S3 files ----
export const listFiles = (bucket: string, prefix?: string) =>
  apiClient.get('/list-files/', { params: { bucket, prefix } });

export const downloadFile = (bucket: string, key: string, asBlob = false) =>
  apiClient.get('/download/', {
    params: { bucket, key },
    responseType: asBlob ? 'blob' : 'text',
  });

// Load data from S3 to backend (ground truth + source)
export const loadData = (ground: string, source: string) =>
  apiClient.post('/sync-data/', {
    ground_truth: ground,
    source_data: source,
  });

// ---- Database utilities ----
export const writeDb = () => apiClient.post('/db-test-write/');
export const checkDb = () => apiClient.get('/db-test/');
export const listTables = () => apiClient.get('/db-tables/');
export const queryTable = (table: string, limit = 100) =>
  apiClient.get('/db-query/', { params: { table, limit } });

// ---- File upload ----
export const uploadFile = (file: File, targetUri?: string) => {
  const form = new FormData();
  form.append('file', file);
  if (targetUri) form.append('target_uri', targetUri);
  return apiClient.post('/upload-file/', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

// ---- Ground truth upload ----
export const uploadGroundTruth = (bucket: string, key: string, jsonContent: string) => {
  return apiClient.post('/upload-ground-truth/', {
    bucket,
    key,
    content: JSON.parse(jsonContent),
  });
};

// ---- Evaluation APIs ----
export const runEvaluation = (data: {
  source_data_uri: string;
  ground_truth_uri: string;
  extraction_endpoint: string;
  responses_uri?: string;
  oauth_token?: string;
  iterations: number;
  extraction_types?: string[];
  excluded_fields?: string[];
  selected_files?: string[];
}) => apiClient.post('/run-evaluation/', data);

export const getEvaluationResult = (evaluationId: string) => 
  apiClient.get(`/evaluation/${evaluationId}`);

export const getEvaluationFromS3 = (runId: string, responsesUri: string) => 
  apiClient.get(`/evaluation/s3/${runId}`, { params: { responses_uri: responsesUri } });

export const recalculateEvaluation = (evaluationId: string, groundTruthUri: string, responsesUri: string, extractionTypes?: string[], excludedFields?: string[]) =>
  apiClient.post(`/recalculate-evaluation/${evaluationId}`, { 
    ground_truth_uri: groundTruthUri,
    responses_uri: responsesUri,
    extraction_types: extractionTypes,
    excluded_fields: excludedFields
  });

export const listEvaluations = () => apiClient.get('/evaluations/');

// ---- Ground Truth Seeding ----
export const checkMissingGroundTruth = (sourceDataUri: string, groundTruthUri: string) =>
  apiClient.get('/check-missing-ground-truth/', {
    params: { source_data_uri: sourceDataUri, ground_truth_uri: groundTruthUri }
  });

export const seedGroundTruth = (data: {
  source_data_uri: string;
  ground_truth_uri: string;
  extraction_endpoint: string;
  oauth_token?: string;
  extraction_types?: string[];
  file_hash?: string;
}) => apiClient.post('/seed-ground-truth/', data);

export const listSourceFiles = (sourceDataUri: string) =>
  apiClient.get('/list-source-files/', { params: { source_data_uri: sourceDataUri } });

export default apiClient; 