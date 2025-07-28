import React, { useState, useMemo, useEffect } from 'react';

interface Props {
  calculationLog: string[];
  isDarkMode: boolean;
}

interface LogEntry {
  originalText: string;
  fileName: string;
  field: string;
  issueType: 'False Positive' | 'False Negative' | 'Other';
  expected?: string;
  actual?: string;
  description: string;
  icon: string;
  color: string;
}

const IssuesLog: React.FC<Props> = ({ calculationLog, isDarkMode }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [screenWidth, setScreenWidth] = useState(window.innerWidth);

  // Track screen size changes
  useEffect(() => {
    const handleResize = () => setScreenWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Parse and group logs by file
  const groupedLogs = useMemo(() => {
    const parseLog = (logText: string): LogEntry => {
      // Extract file name from log
      const fileMatch = logText.match(/([^\/\\\[\]]+\.pdf)/i);
      const fileName = fileMatch ? fileMatch[1] : 'Unknown File';
      
      // Extract field name
      const fieldMatch = logText.match(/\]\s+([^:]+):/);
      const field = fieldMatch ? fieldMatch[1].trim() : 'Unknown Field';
      
      // Determine issue type and styling
      const fpMatch = logText.match(/\[FP\]/i);
      const fnMatch = logText.match(/\[FN\]/i);
      const partialMatch = logText.match(/\[Partial\]/i);
      
      let issueType: 'False Positive' | 'False Negative' | 'Other' = 'Other';
      let icon = '';
      let color = '#6b7280';
      
      if (fpMatch || partialMatch) {
        issueType = 'False Positive';
        icon = '';
        color = '#ef4444';
      } else if (fnMatch) {
        issueType = 'False Negative';
        icon = '';
        color = '#f59e0b';
      }
      
      // Extract expected and actual values
      const valueMatch = logText.match(/Expected = '([^']*)', Got = '([^']*)'/);
      let expected = '';
      let actual = '';
      let description = '';
      
      if (valueMatch) {
        expected = valueMatch[1];
        actual = valueMatch[2];
        description = `Expected "${expected}" but got "${actual}"`;
      } else {
        const unexpectedMatch = logText.match(/Unexpected field in API response = '([^']*)'/);
        if (unexpectedMatch) {
          description = `Unexpected field: "${unexpectedMatch[1]}"`;
        } else {
          const missingMatch = logText.match(/Missing from API response, expected = '([^']*)'/);
          if (missingMatch) {
            expected = missingMatch[1];
            description = `Missing expected value: "${expected}"`;
          } else {
            // Clean up the original log text by removing redundant field info
            const cleanText = logText.replace(/^\[[^\]]+\]\s+[^:]+:\s*/, '');
            description = cleanText || logText;
          }
        }
      }
      
      return {
        originalText: logText,
        fileName,
        field,
        issueType,
        expected,
        actual,
        description,
        icon,
        color
      };
    };

    const parsed = calculationLog.map(parseLog);
    
    // Group by file name
    const grouped: Record<string, LogEntry[]> = {};
    parsed.forEach(log => {
      if (!grouped[log.fileName]) {
        grouped[log.fileName] = [];
      }
      grouped[log.fileName].push(log);
    });
    
    return grouped;
  }, [calculationLog]);

  // Filter logs based on search term
  const filteredGroupedLogs = useMemo(() => {
    if (!searchTerm.trim()) return groupedLogs;
    
    const filtered: Record<string, LogEntry[]> = {};
    Object.entries(groupedLogs).forEach(([fileName, logs]) => {
      const filteredLogs = logs.filter(log => 
        log.field.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.fileName.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      if (filteredLogs.length > 0) {
        filtered[fileName] = filteredLogs;
      }
    });
    
    return filtered;
  }, [groupedLogs, searchTerm]);

  const toggleFileCollapse = (fileName: string) => {
    const newCollapsed = new Set(collapsedFiles);
    if (newCollapsed.has(fileName)) {
      newCollapsed.delete(fileName);
    } else {
      newCollapsed.add(fileName);
    }
    setCollapsedFiles(newCollapsed);
  };

  const truncateText = (text: string, maxLength?: number) => {
    // Responsive truncation based on screen width
    let responsiveLength: number;
    if (screenWidth < 768) { // Mobile
      responsiveLength = 40;
    } else if (screenWidth < 1024) { // Tablet
      responsiveLength = 70;
    } else if (screenWidth < 1440) { // Small desktop
      responsiveLength = 100;
    } else { // Large desktop
      responsiveLength = 150;
    }
    
    const finalLength = maxLength || responsiveLength;
    return text.length > finalLength ? `${text.substring(0, finalLength)}...` : text;
  };

  const totalIssues = Object.values(filteredGroupedLogs).reduce((sum, logs) => sum + logs.length, 0);

  return (
    <div style={{ marginBottom: '2rem' }}>
      {/* Header with search */}
      <div style={{
        background: isDarkMode ? '#060A10' : '#ffffff',
        border: `1px solid ${isDarkMode ? '#333333' : '#e5e7eb'}`,
        borderRadius: '8px 8px 0 0',
        padding: '1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '1rem'
      }}>
        <div>
          <h3 style={{ 
            color: isDarkMode ? '#ffffff' : '#374151', 
            margin: '0', 
            fontSize: '1.1rem', 
            fontWeight: '600' 
          }}>
            🔍 Issues Log ({totalIssues} issues)
          </h3>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="Search by field or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              background: isDarkMode ? '#101927' : '#f9fafb',
              border: `1px solid ${isDarkMode ? '#444444' : '#d1d5db'}`,
              borderRadius: '6px',
              padding: '0.5rem 0.75rem',
              color: isDarkMode ? '#ffffff' : '#374151',
              fontSize: '0.9rem',
              width: '250px',
              outline: 'none'
            }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={{
                background: 'transparent',
                border: 'none',
                color: isDarkMode ? '#888888' : '#6b7280',
                cursor: 'pointer',
                fontSize: '1.2rem',
                padding: '0.25rem'
              }}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Issues content */}
      <div style={{
        background: isDarkMode ? '#060A10' : '#ffffff',
        border: `1px solid ${isDarkMode ? '#333333' : '#e5e7eb'}`,
        borderTop: 'none',
        borderRadius: '0 0 8px 8px',
        height: '400px',
        overflowY: 'auto',
        boxShadow: isDarkMode ? '0 4px 6px rgba(0,0,0,0.3)' : '0 4px 6px rgba(0,0,0,0.1)'
      }}>
        {totalIssues > 0 ? (
          Object.entries(filteredGroupedLogs)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([fileName, logs]) => {
              const isCollapsed = collapsedFiles.has(fileName);
              const issueCount = logs.length;
              
              return (
                <div key={fileName} style={{ borderBottom: `1px solid ${isDarkMode ? '#333333' : '#e5e7eb'}` }}>
                  {/* File header - clickable to toggle */}
                  <div
                    onClick={() => toggleFileCollapse(fileName)}
                    style={{
                      background: isDarkMode ? '#101927' : '#f8f9fa',
                      padding: '0.75rem 1rem',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: isCollapsed ? 'none' : `1px solid ${isDarkMode ? '#333333' : '#e5e7eb'}`,
                      transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = isDarkMode ? '#2a2a2a' : '#f1f5f9'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isDarkMode ? '#101927' : '#f8f9fa'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: isDarkMode ? '#ffffff' : '#374151', fontSize: '0.9rem' }}>
                        {isCollapsed ? '▶' : '▼'}
                      </span>
                      <span style={{ color: isDarkMode ? '#ffffff' : '#374151', fontWeight: '600', fontSize: '0.95rem' }}>
                        📄 {fileName}
                      </span>
                    </div>
                    <span style={{ 
                      color: isDarkMode ? '#888888' : '#6b7280', 
                      fontSize: '0.85rem',
                      background: isDarkMode ? '#333333' : '#e5e7eb',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px'
                    }}>
                      {issueCount} issue{issueCount !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* File logs - collapsible */}
                  {!isCollapsed && (
                    <div style={{ padding: '0' }}>
                      {logs.map((log, index) => (
                        <div
                          key={index}
                          style={{
                            padding: '0.75rem 1rem',
                            borderBottom: index < logs.length - 1 ? `1px solid ${isDarkMode ? '#2a2a2a' : '#f1f5f9'}` : 'none',
                            background: isDarkMode ? '#0C131E' : '#ffffff',
                            position: 'relative'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                            {/* Issue type indicator */}
                            <div style={{
                              background: log.color,
                              color: '#ffffff',
                              fontSize: '0.75rem',
                              padding: '0.2rem 0.4rem',
                              borderRadius: '4px',
                              fontWeight: '600',
                              flexShrink: 0,
                              marginTop: '0.1rem'
                            }}>
                              {log.icon} {log.issueType.replace(' ', '-')}
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                color: isDarkMode ? '#ffffff' : '#374151',
                                fontSize: '0.9rem',
                                fontWeight: '600',
                                marginBottom: '0.25rem'
                              }}>
                                {log.field}
                              </div>
                              
                              <div style={{
                                color: isDarkMode ? '#cccccc' : '#6b7280',
                                fontSize: '0.85rem',
                                lineHeight: '1.4',
                                fontFamily: 'monospace'
                              }}>
                                {/* Truncated description with tooltip */}
                                <span 
                                  title={log.description}
                                  style={{ cursor: log.description.length > 50 ? 'help' : 'default' }}
                                >
                                  {truncateText(log.description)}
                                </span>
                              </div>

                              {/* Expected/Actual values if available */}
                              {log.expected && log.actual && (
                                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                                  <div style={{ color: isDarkMode ? '#888888' : '#6b7280', marginBottom: '0.2rem' }}>
                                    <span style={{ color: '#f59e0b' }}>Expected:</span>{' '}
                                    <span 
                                      style={{ color: isDarkMode ? '#ffffff' : '#374151', fontFamily: 'monospace' }}
                                      title={log.expected}
                                    >
                                      {truncateText(log.expected, 30)}
                                    </span>
                                  </div>
                                  <div style={{ color: isDarkMode ? '#888888' : '#6b7280' }}>
                                    <span style={{ color: '#ef4444' }}>Actual:</span>{' '}
                                    <span 
                                      style={{ color: isDarkMode ? '#ffffff' : '#374151', fontFamily: 'monospace' }}
                                      title={log.actual}
                                    >
                                      {truncateText(log.actual, 30)}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
        ) : (
          <div style={{ 
            textAlign: 'center', 
            color: isDarkMode ? '#888888' : '#6b7280', 
            padding: '3rem',
            background: isDarkMode ? '#060A10' : '#ffffff'
          }}>
            {searchTerm ? (
              <>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🔍</div>
                <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: isDarkMode ? '#ffffff' : '#374151' }}>
                  No issues found matching "{searchTerm}"
                </p>
                <p style={{ fontSize: '0.9rem' }}>
                  Try adjusting your search terms
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>✅</div>
                <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: isDarkMode ? '#ffffff' : '#374151' }}>
                  No issues found
                </p>
                <p style={{ fontSize: '0.9rem' }}>
                  All extractions match ground truth perfectly!
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IssuesLog; 