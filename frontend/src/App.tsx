import React, { useState } from 'react';
import HealthStatus from './components/common/HealthStatus';
import { SettingsProvider } from './context/SettingsContext';
import EvaluationDashboard from './components/evaluation/EvaluationDashboard';
import Dashboard from './components/dashboard/Dashboard';

type TabType = 'dashboard' | 'evaluation';

function App() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  const tabStyle = (isActive: boolean) => ({
    padding: '0.75rem 1.5rem',
    background: isActive 
      ? (isDarkMode ? '#374151' : '#ffffff') 
      : 'transparent',
    color: isActive 
      ? (isDarkMode ? '#ffffff' : '#111827')
      : (isDarkMode ? '#9ca3af' : '#6b7280'),
    border: 'none',
    borderBottom: isActive 
      ? `3px solid ${isDarkMode ? '#3b82f6' : '#2563eb'}` 
      : '3px solid transparent',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    transition: 'all 0.2s ease',
    borderRadius: '8px 8px 0 0',
    marginRight: '0.25rem'
  });

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
        {/* Header */}
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
              <span style={{ 
                width: '16px', 
                height: '16px', 
                display: 'inline-block',
                backgroundColor: isDarkMode ? '#fbbf24' : '#1e40af',
                borderRadius: isDarkMode ? '50%' : '2px',
                transition: 'all 0.2s ease'
              }} />
              {isDarkMode ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{
          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
          borderBottom: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
          padding: '0 2rem'
        }}>
          <div style={{ display: 'flex', gap: '0' }}>
            <button
              style={tabStyle(activeTab === 'dashboard')}
              onClick={() => setActiveTab('dashboard')}
              onMouseOver={(e) => {
                if (activeTab !== 'dashboard') {
                  (e.target as HTMLElement).style.backgroundColor = isDarkMode ? '#374151' : '#f9fafb';
                }
              }}
              onMouseOut={(e) => {
                if (activeTab !== 'dashboard') {
                  (e.target as HTMLElement).style.backgroundColor = 'transparent';
                }
              }}
            >
              Dashboard
            </button>
            <button
              style={tabStyle(activeTab === 'evaluation')}
              onClick={() => setActiveTab('evaluation')}
              onMouseOver={(e) => {
                if (activeTab !== 'evaluation') {
                  (e.target as HTMLElement).style.backgroundColor = isDarkMode ? '#374151' : '#f9fafb';
                }
              }}
              onMouseOut={(e) => {
                if (activeTab !== 'evaluation') {
                  (e.target as HTMLElement).style.backgroundColor = 'transparent';
                }
              }}
            >
              Evaluation
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div style={{ padding: '2rem' }}>
          {activeTab === 'dashboard' && (
            <Dashboard isDarkMode={isDarkMode} />
          )}
          {activeTab === 'evaluation' && (
            <EvaluationDashboard isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />
          )}
        </div>
      </div>
    </SettingsProvider>
  );
}

export default App; 