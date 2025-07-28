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

      {/* start button & status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
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