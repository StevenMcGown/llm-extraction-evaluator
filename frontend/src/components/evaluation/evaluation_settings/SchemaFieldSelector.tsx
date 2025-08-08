import React, { useState, useEffect } from 'react';
import SectionHeader from '../../common/SectionHeader';
import defaultSchema from '../../../schema.json';

interface SchemaFieldSelectorProps {
  schema?: any;
  onChange?: (excludeFields: string[]) => void;
  isDarkMode?: boolean;
  showExcludedJson?: boolean;
}
 
const SchemaFieldSelector: React.FC<SchemaFieldSelectorProps> = ({
  schema,
  onChange,
  isDarkMode = false,
  showExcludedJson = true,
}) => {
  const [excludeFields, setExcludeFields] = useState<string[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const currentSchema = schema || defaultSchema;

  useEffect(() => {
    if (onChange) {
      onChange(excludeFields);
    }
  }, [excludeFields, onChange]);

  const toggleExpanded = (path: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedNodes(newExpanded);
  };

  const toggleField = (jsonPointer: string) => {
    setExcludeFields(prev => {
      if (prev.includes(jsonPointer)) {
        // Including a field - remove it and all its children
        console.log(`✅ Including field in evaluation: ${jsonPointer}`);
        return prev.filter(field => !field.startsWith(jsonPointer));
      } else {
        // Excluding a field - add it and all its children
        console.log(`🌟 Excluding field from ALL array items: ${jsonPointer}`);
        const newExcluded = [...prev, jsonPointer];

        // Add all child fields that start with this path
        Object.entries(currentSchema).forEach(([key, value]) => {
          const addChildFields = (obj: any, path: string) => {
            if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
              Object.entries(obj).forEach(([childKey, childValue]) => {
                const childPath = path ? `${path}/${childKey}` : `/${childKey}`;
                if (childPath.startsWith(jsonPointer) && childPath !== jsonPointer) {
                  newExcluded.push(childPath);
                }
                if (typeof childValue === 'object' && childValue !== null) {
                  addChildFields(childValue, childPath);
                }
              });
            } else if (Array.isArray(obj) && obj.length > 0) {
              // Handle array items
              obj.forEach((item, index) => {
                if (typeof item === 'object' && item !== null) {
                  Object.entries(item).forEach(([childKey, childValue]) => {
                    const childPath = `${path}/${index}/${childKey}`;
                    if (childPath.startsWith(jsonPointer) && childPath !== jsonPointer) {
                      newExcluded.push(childPath);
                    }
                  });
                }
              });
            }
          };
          addChildFields(value, `/${key}`);
        });

        return [...new Set(newExcluded)]; // Remove duplicates
      }
    });
  };

  const isFieldExcluded = (jsonPointer: string): boolean => {
    return excludeFields.includes(jsonPointer);
  };

  const isFieldDisabled = (jsonPointer: string): boolean => {
    // Check if any parent is excluded
    const pathParts = jsonPointer.split('/').filter(part => part);
    for (let i = 1; i < pathParts.length; i++) {
      const parentPath = '/' + pathParts.slice(0, i).join('/');
      if (excludeFields.includes(parentPath)) {
        return true;
      }
    }
    return false;
  };

  const renderField = (
    value: any,
    key: string,
    path: string = '',
    level: number = 0,
    isLast: boolean = false
  ): React.ReactNode => {
    const jsonPointer = path ? `${path}/${key}` : `/${key}`;
    const isExpanded = expandedNodes.has(jsonPointer);
    const isExcluded = isFieldExcluded(jsonPointer);
    const indent = level * 20;

    // Tree connector logic
    const showTreeConnector = level > 0;
    const treeConnector = showTreeConnector ? (isLast ? '└── ' : '├── ') : '';

    if (Array.isArray(value)) {
      return (
        <div key={jsonPointer}>
          <div style={{
            marginLeft: `${indent}px`,
            display: 'flex',
            alignItems: 'center',
            marginBottom: '4px',
            fontSize: '14px'
          }}>
            <button
              onClick={() => toggleExpanded(jsonPointer)}
              style={{
                background: isDarkMode ? '#374151' : '#f3f4f6',
                border: `1px solid ${isDarkMode ? '#4b5563' : '#d1d5db'}`,
                borderRadius: '2px',
                cursor: 'pointer',
                padding: '0px',
                marginRight: '6px',
                color: isDarkMode ? '#e5e7eb' : '#374151',
                fontSize: '10px',
                fontWeight: 'bold',
                width: '16px',
                height: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
            >
              {isExpanded ? '−' : '+'}
            </button>
            <span style={{
              color: isDarkMode ? '#e5e7eb' : '#374151',
              fontWeight: level === 0 ? 'bold' : 'normal'
            }}>
              {treeConnector}{key}
            </span>
            <input
              type="checkbox"
              checked={!isExcluded}
              disabled={isFieldDisabled(jsonPointer)}
              onChange={() => toggleField(jsonPointer)}
              style={{
                marginLeft: '8px',
                opacity: isFieldDisabled(jsonPointer) ? 0.5 : 1,
                cursor: isFieldDisabled(jsonPointer) ? 'not-allowed' : 'pointer'
              }}
            />
          </div>
          {isExpanded && value.length > 0 && (
            <div>
              {/* Show field patterns for all array items */}
              {value.length > 0 && typeof value[0] === 'object' && value[0] !== null && (
                <div style={{
                  marginLeft: `${(level + 1) * 20}px`,
                  marginBottom: '8px'
                }}>

                  {Object.keys(value[0]).map((fieldKey, index, array) => {
                    const wildcardPath = `${jsonPointer}/${fieldKey}`;
                    const isWildcardExcluded = isFieldExcluded(wildcardPath);
                    const isLastField = index === array.length - 1;
                    const fieldValue = value[0][fieldKey];
                    return (
                      <div key={fieldKey} style={{
                        marginLeft: `${(level + 2) * 20}px`,
                        display: 'flex',
                        alignItems: 'center',
                        marginBottom: '2px',
                        fontSize: '14px'
                      }}>
                        <span style={{
                          color: isWildcardExcluded
                            ? (isDarkMode ? '#6b7280' : '#9ca3af')
                            : (isDarkMode ? '#e5e7eb' : '#374151'),
                          textDecoration: isWildcardExcluded ? 'line-through' : 'none'
                        }}>
                          {isLastField ? '└── ' : '├── '}{fieldKey}: <em>{typeof fieldValue}</em>
                        </span>
                        <input
                          type="checkbox"
                          checked={!isWildcardExcluded}
                          disabled={isFieldDisabled(wildcardPath)}
                          onChange={() => toggleField(wildcardPath)}
                          style={{
                            marginLeft: '6px',
                            opacity: isFieldDisabled(wildcardPath) ? 0.5 : 1,
                            cursor: isFieldDisabled(wildcardPath) ? 'not-allowed' : 'pointer'
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    if (typeof value === 'object' && value !== null) {
      return (
        <div key={jsonPointer}>
          <div style={{
            marginLeft: `${indent}px`,
            display: 'flex',
            alignItems: 'center',
            marginBottom: '4px',
            fontSize: '14px'
          }}>
            <button
              onClick={() => toggleExpanded(jsonPointer)}
              style={{
                background: isDarkMode ? '#374151' : '#f3f4f6',
                border: `1px solid ${isDarkMode ? '#4b5563' : '#d1d5db'}`,
                borderRadius: '2px',
                cursor: 'pointer',
                padding: '0px',
                marginRight: '6px',
                color: isDarkMode ? '#e5e7eb' : '#374151',
                fontSize: '10px',
                fontWeight: 'bold',
                width: '16px',
                height: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
            >
              {isExpanded ? '−' : '+'}
            </button>
            <span style={{
              color: isDarkMode ? '#e5e7eb' : '#374151',
              fontWeight: level === 0 ? 'bold' : 'normal'
            }}>
              {treeConnector}{key}
            </span>
            <input
              type="checkbox"
              checked={!isExcluded}
              disabled={isFieldDisabled(jsonPointer)}
              onChange={() => toggleField(jsonPointer)}
              style={{
                marginLeft: '8px',
                opacity: isFieldDisabled(jsonPointer) ? 0.5 : 1,
                cursor: isFieldDisabled(jsonPointer) ? 'not-allowed' : 'pointer'
              }}
            />
          </div>
          {isExpanded && (
            <div>
              {Object.entries(value).map(([subKey, subValue], index, array) =>
                renderField(subValue, subKey, jsonPointer, level + 1, index === array.length - 1)
              )}
            </div>
          )}
        </div>
      );
    }

    // Primitive value
    return (
      <div key={jsonPointer} style={{
        marginLeft: `${indent}px`,
        display: 'flex',
        alignItems: 'center',
        marginBottom: '4px',
        fontSize: '14px'
      }}>
        <div style={{ width: '20px' }}></div>
        <span style={{ color: isDarkMode ? '#e5e7eb' : '#374151' }}>
          {treeConnector}{key}: <em>{typeof value}</em>
        </span>
        <input
          type="checkbox"
          checked={!isExcluded}
          disabled={isFieldDisabled(jsonPointer)}
          onChange={() => toggleField(jsonPointer)}
          style={{
            marginLeft: '8px',
            opacity: isFieldDisabled(jsonPointer) ? 0.5 : 1,
            cursor: isFieldDisabled(jsonPointer) ? 'not-allowed' : 'pointer'
          }}
        />
      </div>
    );
  };

  return (
    <div>
      <SectionHeader isDarkMode={isDarkMode}>
        Schema Field Selector
      </SectionHeader>

      <div style={{
        marginBottom: '16px',
        fontFamily: 'monospace'
      }}>
        {Object.entries(currentSchema).map(([key, value], index, array) =>
          renderField(value, key, '', 0, index === array.length - 1)
        )}
      </div>

      {showExcludedJson && (
        <div>
          <div style={{
            display: 'block',
            marginBottom: '1rem',
            color: isDarkMode ? '#ffffff' : '#495057',
            fontSize: '1.0rem',
            fontWeight: '600'
          }}>
            Excluded Fields (JSON):
          </div>
          <div style={{
            fontSize: '12px',
            marginBottom: '8px',
            color: isDarkMode ? '#9ca3af' : '#6b7280',
            fontStyle: 'italic'
          }}>
            Note: Excluding array container fields (e.g., "/medications/medications/frequency") will exclude that field from ALL array items.
          </div>
          <pre style={{
            backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
            border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
            borderRadius: '4px',
            padding: '12px',
            fontSize: '12px',
            overflow: 'auto',
            maxHeight: '150px',
            color: isDarkMode ? '#d1d5db' : '#374151'
          }}>
            {JSON.stringify(excludeFields, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default SchemaFieldSelector; 