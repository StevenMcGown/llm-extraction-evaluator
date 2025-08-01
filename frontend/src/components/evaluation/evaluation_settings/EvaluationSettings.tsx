import React, { useState } from 'react';
import { useSettings } from '../../../context/SettingsContext';
import SchemaFieldSelector from './SchemaFieldSelector';
import ExtractionTypeSelector from './ExtractionTypeSelector';
import SourceFileSelector from './SourceFileSelector';
import IterationSelector from './IterationSelector';
import ApplicationSettings from './ApplicationSettings';

export interface EvaluationSettingsProps {
  iterations: number;
  setIterations: (v: number) => void;
  extractionTypes: string[];
  setExtractionTypes: (v: string[]) => void;
  excludedFields: string[];
  setExcludedFields: (v: string[]) => void;
  sourceFiles: string[];
  selectedFiles: string[];
  setSelectedFiles: (v: string[]) => void;
  isRunningEvaluation: boolean;
  startEvaluation: () => void;
  progressPercent: number;
  progressText: string;
  evaluationStatus: string;
  isDarkMode: boolean;
  // Load Evaluation props
  runIdInput: string;
  setRunIdInput: (v: string) => void;
  isLoadingRunId: boolean;
  loadEvaluationByRunId: () => void;
}

const EvaluationSettings: React.FC<EvaluationSettingsProps> = ({
  iterations,
  setIterations,
  extractionTypes,
  setExtractionTypes,
  excludedFields,
  setExcludedFields,
  sourceFiles,
  selectedFiles,
  setSelectedFiles,
  isRunningEvaluation,
  startEvaluation,
  progressPercent,
  progressText,
  evaluationStatus,
  isDarkMode,
  runIdInput,
  setRunIdInput,
  isLoadingRunId,
  loadEvaluationByRunId,
}) => {
  const { settings } = useSettings();

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ 
        marginBottom: '1rem', 
        color: isDarkMode ? '#ffffff' : '#495057',
        fontSize: '1.5rem',
        fontWeight: '600'
      }}>
        Evaluation Settings
      </h2>
      <div
        style={{
          background: isDarkMode ? '#1f2937' : 'white',
          border: `1px solid ${isDarkMode ? '#374151' : '#e2e8f0'}`,
          borderRadius: 16,
          padding: '2rem',
          boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
        }}
      >
      {/* Iterations & extraction types */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '2rem',
          marginBottom: '2rem',
        }}
      >
        {/* left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <ExtractionTypeSelector 
            extractionTypes={extractionTypes}
            setExtractionTypes={setExtractionTypes}
            isDarkMode={isDarkMode}
          />
          
          <IterationSelector 
            iterations={iterations}
            setIterations={setIterations}
            isDarkMode={isDarkMode}
          />
          
          {/* Schema Field Selector */}
          <SchemaFieldSelector 
            isDarkMode={isDarkMode}
            onChange={setExcludedFields}
          />
        </div>

        {/* right */}
        <div>
          {/* Application Settings Section - moved to top of right side */}
          <ApplicationSettings isDarkMode={isDarkMode} />
          
          {/* Divider */}
          <div style={{ 
            height: '1px', 
            backgroundColor: isDarkMode ? '#374151' : '#e5e7eb', 
            margin: '1.5rem 0' 
          }} />

          <SourceFileSelector 
            sourceFiles={sourceFiles}
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
            isDarkMode={isDarkMode}
          />
        </div>
      </div>

      {/* start button & load evaluation controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            disabled={
              isRunningEvaluation ||
              !settings.sourceDataPath ||
              !settings.groundTruthPath ||
              !settings.extractionEndpoint ||
              selectedFiles.length === 0
            }
            onClick={startEvaluation}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: 8,
              background: isRunningEvaluation ? '#6b7280' : '#3b82f6',
              color: '#fff',
              border: 'none',
              cursor: isRunningEvaluation ? 'not-allowed' : 'pointer',
            }}
          >
            {isRunningEvaluation ? 'Running…' : 'Start Evaluation'}
          </button>
          {evaluationStatus && (
            <div style={{ fontStyle: 'italic', fontSize: 14 }}>Status: {evaluationStatus}</div>
          )}
        </div>

        {/* Load Evaluation by Run ID */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
          <div style={{
            color: isDarkMode ? '#ffffff' : '#495057',
            fontSize: '0.875rem',
            fontWeight: '600',
            textAlign: 'right'
          }}>
            Load Evaluation from S3
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Enter Run ID (e.g., 2024-01-15T10-30-45-abc123)"
              value={runIdInput}
              onChange={(e) => setRunIdInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && loadEvaluationByRunId()}
              style={{
                padding: '0.5rem',
                borderRadius: '6px',
                border: `1px solid ${isDarkMode ? '#374151' : '#d1d5db'}`,
                background: isDarkMode ? '#374151' : 'white',
                color: isDarkMode ? '#ffffff' : '#111827',
                fontSize: '0.875rem',
                width: '280px'
              }}
              disabled={isLoadingRunId}
            />
            <button
              onClick={loadEvaluationByRunId}
              disabled={isLoadingRunId || !runIdInput.trim()}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: 'none',
                background: isLoadingRunId || !runIdInput.trim() 
                  ? (isDarkMode ? '#4b5563' : '#e5e7eb') 
                  : (isDarkMode ? '#3b82f6' : '#2563eb'),
                color: isLoadingRunId || !runIdInput.trim() 
                  ? (isDarkMode ? '#9ca3af' : '#9ca3af') 
                  : 'white',
                fontSize: '0.875rem',
                fontWeight: '500',
                cursor: isLoadingRunId || !runIdInput.trim() ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {isLoadingRunId ? 'Loading...' : 'Load Evaluation'}
            </button>
          </div>
        </div>
      </div>

      {(isRunningEvaluation || progressPercent > 0) && (
        <>
          <div style={{ marginTop: 24, height: 16, background: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
            <div
              style={{
                width: `${progressPercent}%`,
                background: progressPercent === 100 ? '#10b981' : '#3b82f6',
                height: '100%',
                transition: 'width .3s',
              }}
            />
          </div>
          <div style={{ textAlign: 'center', fontSize: 14, marginTop: 4 }}>{progressText}</div>
        </>
      )}
      </div>
    </div>
  );
};

export default EvaluationSettings; 