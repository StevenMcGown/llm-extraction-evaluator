import React from 'react';
import SectionHeader from '../../common/SectionHeader';
import FileUploader from './FileUploader';

interface SourceFileSelectorProps {
  sourceFiles: string[];
  selectedFiles: string[];
  setSelectedFiles: (v: string[]) => void;
  isDarkMode: boolean;
}

const SourceFileSelector: React.FC<SourceFileSelectorProps> = ({
  sourceFiles,
  selectedFiles,
  setSelectedFiles,
  isDarkMode,
}) => {
  return (
    <div>
      <SectionHeader isDarkMode={isDarkMode}>Source Files</SectionHeader>
      
      {/* File Uploader */}
      <div style={{ marginBottom: '1rem' }}>
        <FileUploader />
      </div>
      
      <div
        style={{
          maxHeight: 200,
          overflowY: 'auto',
          border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
          borderRadius: 8,
          padding: 8,
          background: isDarkMode ? '#111827' : '#f3f4f6',
        }}
      >
        {sourceFiles.map((f) => (
          <label key={f} style={{ 
            display: 'flex', 
            gap: 6, 
            alignItems: 'center', 
            fontSize: 14,
            color: isDarkMode ? '#d1d5db' : '#374151'
          }}>
            <input
              type="checkbox"
              checked={selectedFiles.includes(f)}
              onChange={(e) =>
                setSelectedFiles(
                  e.target.checked
                    ? [...selectedFiles, f]
                    : selectedFiles.filter((x) => x !== f),
                )
              }
            />
            {f}
          </label>
        ))}
      </div>
      {sourceFiles.length > 0 && (
        <div style={{ 
          fontSize: 12, 
          marginTop: 4, 
          display: 'flex', 
          justifyContent: 'space-between',
          color: isDarkMode ? '#d1d5db' : '#374151'
        }}>
          <span>
            {selectedFiles.length} of {sourceFiles.length} files selected
          </span>
          <button
            onClick={() => {
              if (selectedFiles.length === sourceFiles.length) {
                setSelectedFiles([]);  // Unselect all if everything is selected
              } else {
                setSelectedFiles(sourceFiles);  // Select all if not everything is selected
              }
            }}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: '#3b82f6', 
              cursor: 'pointer' 
            }}
          >
            {selectedFiles.length === sourceFiles.length ? 'Unselect All' : 'Select All'}
          </button>
        </div>
      )}
    </div>
  );
};

export default SourceFileSelector; 