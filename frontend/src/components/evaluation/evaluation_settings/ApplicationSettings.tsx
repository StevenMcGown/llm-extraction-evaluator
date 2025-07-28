import React, { useState, useEffect } from 'react';
import { useSettings } from '../../../context/SettingsContext';
import SectionHeader from '../../common/SectionHeader';

interface ApplicationSettingsProps {
  isDarkMode: boolean;
}

const ApplicationSettings: React.FC<ApplicationSettingsProps> = ({ isDarkMode }) => {
  const { settings, setSettings } = useSettings();
  const [local, setLocal] = useState(() => ({
    ...settings,
    // Initialize from environment variables if not already set
    sourceDataPath: settings.sourceDataPath || (import.meta as any).env.SOURCE_DATA_URI || '',
    groundTruthPath: settings.groundTruthPath || (import.meta as any).env.GROUND_TRUTH_URI || '',
    responsesPath: settings.responsesPath || (import.meta as any).env.RESPONSES_URI || '',
    extractionEndpoint: settings.extractionEndpoint || (import.meta as any).env.EXTRACTION_ENDPOINT || '',
    oauthToken: settings.oauthToken || (import.meta as any).env.OAUTH_TOKEN || '',
  }));

  // Auto-update context whenever local changes
  useEffect(() => {
    setSettings(local);
  }, [local, setSettings]);

  const handleChange = (field: keyof typeof local, value: any) => {
    setLocal((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div style={{ marginBottom: '2rem' }}>

      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        <div>
          <SectionHeader isDarkMode={isDarkMode}>
            Source Data URI
          </SectionHeader>
          <input
            type="text"
            value={local.sourceDataPath}
            onChange={(e) => handleChange('sourceDataPath', e.target.value)}
            placeholder="s3://bucket/source_files/"
            style={{ 
              padding: '0.75rem', 
              width: '100%',
              border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
              borderRadius: '4px',
              fontSize: '0.9rem',
              backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
              color: isDarkMode ? '#d1d5db' : '#374151'
            }}
          />
        </div>

        <div>
          <SectionHeader isDarkMode={isDarkMode}>
            Ground Truth URI
          </SectionHeader>
          <input
            type="text"
            value={local.groundTruthPath}
            onChange={(e) => handleChange('groundTruthPath', e.target.value)}
            placeholder="s3://bucket/ground_truth/"
            style={{ 
              padding: '0.75rem', 
              width: '100%',
              border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
              borderRadius: '4px',
              fontSize: '0.9rem',
              backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
              color: isDarkMode ? '#d1d5db' : '#374151'
            }}
          />
        </div>

        <div>
          <SectionHeader isDarkMode={isDarkMode}>
            Responses URI
          </SectionHeader>
          <input
            type="text"
            value={local.responsesPath}
            onChange={(e) => handleChange('responsesPath', e.target.value)}
            placeholder="s3://bucket/responses/"
            style={{ 
              padding: '0.75rem', 
              width: '100%',
              border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
              borderRadius: '4px',
              fontSize: '0.9rem',
              backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
              color: isDarkMode ? '#d1d5db' : '#374151'
            }}
          />
        </div>

        <div>
          <SectionHeader isDarkMode={isDarkMode}>
            Extraction Endpoint
          </SectionHeader>
          <input
            type="text"
            value={local.extractionEndpoint}
            onChange={(e) => handleChange('extractionEndpoint', e.target.value)}
            placeholder=""
            style={{ 
              padding: '0.75rem', 
              width: '100%',
              border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
              borderRadius: '4px',
              fontSize: '0.9rem',
              backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
              color: isDarkMode ? '#d1d5db' : '#374151'
            }}
          />
        </div>

        <div>
          <SectionHeader isDarkMode={isDarkMode}>
            OAuth Token (optional)
          </SectionHeader>
          <input
            type="password"
            value={local.oauthToken}
            onChange={(e) => handleChange('oauthToken', e.target.value)}
            placeholder="Bearer token for authentication"
            style={{ 
              padding: '0.75rem', 
              width: '100%',
              border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
              borderRadius: '4px',
              fontSize: '0.9rem',
              backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
              color: isDarkMode ? '#d1d5db' : '#374151'
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default ApplicationSettings; 