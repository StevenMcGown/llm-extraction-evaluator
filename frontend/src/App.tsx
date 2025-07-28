import React, { useState } from 'react';
import HealthStatus from './components/HealthStatus';
import { SettingsProvider } from './context/SettingsContext';
import EvaluationDashboard from './components/evaluation/EvaluationDashboard';

function App() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  return (
    <SettingsProvider>
      <div style={{ 
        fontFamily: 'sans-serif', 
        margin: '0', 
        padding: '0',
        border: 'none',
        outline: 'none',
        minHeight: '100vh', 
        backgroundColor: isDarkMode ? '#1a1a1a' : '#f8f9fa',
        color: isDarkMode ? '#ffffff' : '#000000',
        transition: 'all 0.3s ease'
      }}>
        {/* Simple header */}
        <div style={{ 
          display: 'flex', 
          gap: '2rem', 
          marginBottom: '0', 
          borderBottom: `1px solid ${isDarkMode ? '#374151' : '#e0e0e0'}`, 
          backgroundColor: isDarkMode ? '#1f2937' : 'white', 
          padding: '0 2rem', 
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)' 
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            padding: '0.75rem 0',
            fontSize: '1.2rem',
            fontWeight: '600',
            color: isDarkMode ? '#ffffff' : '#374151'
          }}>
            LLM Extraction Evaluator
          </div>
          <div style={{ marginLeft: 'auto', display:'flex', alignItems:'center', gap: '1rem' }}>
            <HealthStatus />
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1rem',
                background: isDarkMode ? '#374151' : '#ffffff',
                color: isDarkMode ? '#ffffff' : '#374151',
                border: `1px solid ${isDarkMode ? '#4b5563' : '#e5e7eb'}`,
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '600',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
              }}
              onMouseOver={(e) => {
                (e.target as HTMLElement).style.background = isDarkMode ? '#4b5563' : '#f3f4f6';
              }}
              onMouseOut={(e) => {
                (e.target as HTMLElement).style.background = isDarkMode ? '#374151' : '#ffffff';
              }}
            >
              <span style={{ fontSize: '1rem' }}>
                {isDarkMode ? '☀️' : '🌙'}
              </span>
              {isDarkMode ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>

        <div style={{ padding: '2rem' }}>
          <EvaluationDashboard isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />
        </div>
      </div>
    </SettingsProvider>
  );
}

export default App; 