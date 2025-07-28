import React, { useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { listFiles, downloadFile, uploadGroundTruth, recalculateEvaluation, listEvaluations, getEvaluationResult } from '../services/api';

function S3Browser() {
  const { settings } = useSettings();

  interface FileData {
    key: string;
    content: string;
  }

  interface GroundTruthData {
    key: string;
    content: string;
  }

  const [files, setFiles] = useState<FileData[]>([]);
  const [groundTruthFiles, setGroundTruthFiles] = useState<GroundTruthData[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrls, setPdfUrls] = useState<Record<string, string>>({});
  const [seedingStatus, setSeedingStatus] = useState<Record<string, string>>({});

  // Fetch PDF blob helper
  const fetchPdf = async (key: string) => {
    if (pdfUrls[key]) return; // already fetched
    try {
      const resp = await downloadFile(parsedBucket, key, true);
      const blob = new Blob([resp.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrls((prev) => ({ ...prev, [key]: url }));
    } catch (err) {
      console.error('Failed to fetch PDF', err);
    }
  };

  const [parsedBucket, setParsedBucket] = useState<string>('');
  const [parsedGroundTruthBucket, setParsedGroundTruthBucket] = useState<string>('');
  const [nameMap, setNameMap] = useState<Record<string,string|undefined>>({});
  const [groundTruthMap, setGroundTruthMap] = useState<Record<string,string|undefined>>({});
  const [prettyPrintSet, setPrettyPrintSet] = useState<Set<string>>(new Set());
  const [editModeSet, setEditModeSet] = useState<Set<string>>(new Set());
  const [editBuffer, setEditBuffer] = useState<Record<string,string>>({});

  const togglePretty = (fileKey: string, enabled: boolean) => {
    setPrettyPrintSet(prev => {
      const next = new Set(prev);
      if (enabled) next.add(fileKey);
      else next.delete(fileKey);
      return next;
    });
  };

  const toggleEditMode = (fileKey: string, enable: boolean, currentContent: string) => {
    setEditModeSet(prev => {
      const next = new Set(prev);
      if (enable) next.add(fileKey); else next.delete(fileKey);
      return next;
    });
    if (enable) {
      const pretty = (() => { try { return JSON.stringify(JSON.parse(currentContent), null, 2);} catch { return currentContent;} })();
      setEditBuffer(prev => ({ ...prev, [fileKey]: pretty }));
    }
  };

  const triggerRefreshCalculations = async () => {
    try {
      // Find the most recent evaluation to refresh
      const response = await listEvaluations();
      const evaluations = response.data.evaluations;
      const completedEvals = evaluations.filter((e: any) => e.status === 'completed');
      
      if (completedEvals.length > 0) {
        const latestEval = completedEvals[0];
        await recalculateEvaluation(latestEval.evaluation_id, settings.groundTruthPath, [], []); // Using empty arrays for extraction types and excluded fields - you may want to customize this
        console.log('Calculations refreshed automatically after ground truth save');
      }
    } catch (error) {
      console.error('Failed to refresh calculations after ground truth save:', error);
      // Don't show an alert here as it would be disruptive - just log the error
    }
  };

  const handleSaveEdit = async (fileKey: string) => {
    const jsonText = editBuffer[fileKey];
    try {
      // validate JSON
      const parsed = JSON.parse(jsonText);
      const pdfFilename = fileKey.split('/').pop() || '';
      const groundTruthFilename = pdfFilename.replace('.pdf', '.json');
      const gtData = parseS3Uri(settings.groundTruthPath);
      const prefix = gtData.prefix ? (gtData.prefix.endsWith('/') ? gtData.prefix : gtData.prefix + '/') : '';
      const fullKey = `${prefix}${groundTruthFilename}`;
      const minified = JSON.stringify(parsed);
      await uploadGroundTruth(gtData.bucket, fullKey, minified);
      // update local display with minified version so pretty toggle works
      setGroundTruthFiles(prev => prev.map(g=> g.key===fileKey? { ...g, content: minified }: g));
      toggleEditMode(fileKey,false,'');
      
      // Automatically refresh calculations after saving ground truth
      await triggerRefreshCalculations();
    }catch(err:any){
      alert('Failed to save JSON: '+err.message);
    }
  };
  
  const closeModal = () => {
    // if (pdfUrl) URL.revokeObjectURL(pdfUrl); // This line is no longer needed
    // setPdfUrl(null); // This line is no longer needed
  };
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>('');

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

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
    // Extract hash from key like "source_files/hash.pdf" or just "hash.pdf"
    const parts = key.split('/');
    const filename = parts[parts.length - 1];
    return filename.split('.')[0]; // Remove extension
  };

  const seedGroundTruth = async (pdfKey: string) => {
    if (!settings.extractionEndpoint) {
      setError('Extraction endpoint is required for seeding');
      return;
    }

    setSeedingStatus(prev => ({ ...prev, [pdfKey]: 'Seeding...' }));

    try {
      // Fetch the PDF bytes as blob to send exactly what S3 stores
      const blobResp = await downloadFile(parsedBucket, pdfKey, true);
      const pdfBlob = new Blob([blobResp.data], { type: 'application/pdf' });
      const formData = new FormData();
      formData.append('file', pdfBlob, `${getFileHashFromKey(pdfKey)}.pdf`);

      // Build URL with query parameters - ensure it has the correct path
      const baseUrl = settings.extractionEndpoint.endsWith('/') ? settings.extractionEndpoint : settings.extractionEndpoint + '/';
      const url = new URL(baseUrl + 'api/v1/process/');
      url.searchParams.append('extraction_types', 'patient_profile');
      url.searchParams.append('extraction_types', 'icd10_codes');
      url.searchParams.append('extraction_types', 'medications');
      url.searchParams.append('extraction_types', 'allergy');
      url.searchParams.append('datacontext', 'eval_test');

      // Prepare headers
      const headers: Record<string, string> = {
        'accept': 'application/json',
      };

      // Add OAuth token if provided
      if (settings.oauthToken) {
        headers['Authorization'] = `Bearer ${settings.oauthToken}`;
      }

      // Make the extraction request with proper headers
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Extraction failed: ${response.status} ${response.statusText}`);
      }

      const extractionResult = await response.json();
      
      // Save the extraction result to S3 as ground truth
      try {
        // Get the exact same filename as the PDF but with .json extension
        const pdfFilename = pdfKey.split('/').pop() || '';
        const groundTruthFilename = pdfFilename.replace('.pdf', '.json');
        
        // Parse ground truth URI to get bucket and prefix
        const groundTruthData = parseS3Uri(settings.groundTruthPath);

        // Build key using the prefix path from the URI (if any)
        const prefix = groundTruthData.prefix ? (groundTruthData.prefix.endsWith('/') ? groundTruthData.prefix : groundTruthData.prefix + '/') : '';
        const fullGroundTruthKey = `${prefix}${groundTruthFilename}`;

        // Upload the JSON response to S3 at the exact ground-truth URI (bucket + prefix)
        await uploadGroundTruth(groundTruthData.bucket, fullGroundTruthKey, JSON.stringify(extractionResult, null, 2));
        
        // Update the ground truth files with the new seeded data
        setGroundTruthFiles(prev => prev.map(gt => 
          gt.key === pdfKey 
            ? { ...gt, content: JSON.stringify(extractionResult, null, 2) }
            : gt
        ));

        setSeedingStatus(prev => ({ ...prev, [pdfKey]: 'Seeded successfully and saved to S3' }));
      } catch (uploadErr: any) {
        console.error('Failed to save ground truth to S3:', uploadErr);
        setSeedingStatus(prev => ({ ...prev, [pdfKey]: `Extraction successful but failed to save to S3: ${uploadErr.message}` }));
      }
    } catch (err: any) {
      console.error('Seeding failed:', err);
      setSeedingStatus(prev => ({ ...prev, [pdfKey]: `Seeding failed: ${err.message}` }));
    }
  };

  const handleFetch = async () => {
    if (!settings.sourceDataPath) {
      setError('Source Data URI is required');
      return;
    }

    if (!settings.groundTruthPath) {
      setError('Ground Truth URI is required');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      // Parse source data S3 URI
      const sourceData = parseS3Uri(settings.sourceDataPath);
      setParsedBucket(sourceData.bucket);

      // Parse ground truth S3 URI
      const groundTruthData = parseS3Uri(settings.groundTruthPath);
      setParsedGroundTruthBucket(groundTruthData.bucket);

      // Fetch source files and sort by original file name if available
      const sourceResp = await listFiles(sourceData.bucket, sourceData.prefix || undefined);
      const sourceFileEntries: { key: string; original_name?: string }[] = sourceResp.data.files.sort((a: any, b: any) => {
        const nameA = (a.original_name || a.key).toLowerCase();
        const nameB = (b.original_name || b.key).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      const sourceKeys: string[] = sourceFileEntries.map((f) => f.key);
      
      // Create name mapping for source files
      const temp: Record<string,string|undefined> = {};
      sourceFileEntries.forEach((f: any) => {temp[f.key]=f.original_name});
      setNameMap(temp);

      // Fetch ground truth files
      const groundTruthResp = await listFiles(groundTruthData.bucket, groundTruthData.prefix || undefined);
      const groundTruthEntries = groundTruthResp.data.files;
      const groundTruthKeys = groundTruthEntries.map((f: any) => f.key);
      
      // Create name mapping for ground truth files
      const gtTemp: Record<string,string|undefined> = {};
      groundTruthEntries.forEach((f: any) => {gtTemp[f.key]=f.original_name});
      setGroundTruthMap(gtTemp);

      // Create a map of file hash to ground truth key
      const hashToGroundTruth: Record<string, string> = {};
      groundTruthKeys.forEach((gtKey: string) => {
        const gtHash = getFileHashFromKey(gtKey);
        hashToGroundTruth[gtHash] = gtKey;
      });

      // Fetch content for each source key in parallel
      const filePromises = sourceKeys.map(async (key) => {
        try {
          const fileResp = await downloadFile(sourceData.bucket, key);
          return { key, content: fileResp.data as string } as FileData;
        } catch {
          return { key, content: '<Failed to load>' } as FileData;
        }
      });

      // Fetch content for corresponding ground truth files
      const groundTruthPromises = sourceKeys.map(async (key) => {
        const hash = getFileHashFromKey(key);
        const gtKey = hashToGroundTruth[hash];
        
        if (gtKey) {
          try {
            const gtResp = await downloadFile(groundTruthData.bucket, gtKey);
            return { key, content: gtResp.data as string } as GroundTruthData;
          } catch {
            return { key, content: '<Failed to load ground truth>' } as GroundTruthData;
          }
        } else {
          return { key, content: '<No ground truth found>' } as GroundTruthData;
        }
      });

      const [filesWithContent, groundTruthWithContent] = await Promise.all([
        Promise.all(filePromises),
        Promise.all(groundTruthPromises)
      ]);
      
      setFiles(filesWithContent);
      setGroundTruthFiles(groundTruthWithContent);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || 'Failed to fetch files');
      setFiles([]);
      setGroundTruthFiles([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: '2rem' }}>
      <div style={{ 
        background: '#f8f9fa', 
        padding: '1.5rem', 
        borderRadius: '8px', 
        marginBottom: '2rem',
        border: '1px solid #e9ecef'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, color: '#495057' }}>Load Files from S3</h2>
          <button
            onClick={handleFetch}
            style={{ 
              padding: '0.75rem 2rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '500',
              transition: 'background-color 0.2s',
              boxShadow: '0 2px 4px rgba(0,123,255,0.2)'
            }}
            disabled={loading || !settings.sourceDataPath || !settings.groundTruthPath}
            onMouseOver={(e) => (e.target as HTMLElement).style.backgroundColor = '#0056b3'}
            onMouseOut={(e) => (e.target as HTMLElement).style.backgroundColor = '#007bff'}
          >
            {loading ? 'Loading…' : 'Load Files'}
          </button>
        </div>

        {(!settings.sourceDataPath || !settings.groundTruthPath) && (
          <div style={{ 
            padding: '0.75rem',
            backgroundColor: '#fff3cd',
            color: '#856404',
            border: '1px solid #ffeaa7',
            borderRadius: '4px',
            fontSize: '0.9rem'
          }}>
            Please configure Source Data URI and Ground Truth URI in the Settings tab to load files.
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

      {files.length > 0 && (
        <div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '1.5rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <input
                type="text"
                placeholder="Search files..."
                value={searchTerm}
                onChange={e=>setSearchTerm(e.target.value)}
                style={{ 
                  padding: '0.5rem 1rem', 
                  border: '1px solid #ced4da',
                  borderRadius: '20px',
                  fontSize: '0.9rem',
                  minWidth: '250px'
                }}
              />
            </div>
            <h3 style={{ margin: 0, color: '#495057' }}>
              Found {files.length} file{files.length !== 1 ? 's' : ''}
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {files
              .filter(({ key }) => {
                const original = nameMap[key] || key;
                return original.toLowerCase().includes(searchTerm.toLowerCase());
              })
              .map(({ key, content }) => {
            const isOpen = expanded.has(key);
            const displayName = `${nameMap[key] || key.split('/').pop()} (${key.split('/').pop()?.split('.')[0]})`;
                const groundTruth = groundTruthFiles.find(gt => gt.key === key);
                const hasGroundTruth = groundTruth && groundTruth.content !== '<No ground truth found>';
                const seedingStatusForFile = seedingStatus[key];
                
            return (
              <div
                key={key}
                style={{
                      border: '1px solid #dee2e6',
                      borderRadius: '8px',
                  overflow: 'hidden',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      backgroundColor: 'white'
                }}
              >
                    {/* Title section */}
                <div
                  onClick={() => toggleExpand(key)}
                  style={{
                        background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
                        padding: '1rem 1.5rem',
                    cursor: 'pointer',
                        borderBottom: '1px solid #dee2e6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                        transition: 'background-color 0.2s'
                  }}
                      onMouseOver={(e) => (e.target as HTMLElement).style.backgroundColor = '#f1f3f4'}
                      onMouseOut={(e) => (e.target as HTMLElement).style.background = 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)'}
                >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '1.2rem', color: '#6c757d', fontWeight: 'bold' }}>
                      {isOpen ? '▼' : '▶'}
                    </span>
                        <div>
                          <strong style={{ fontSize: '1.1rem', color: '#495057' }}>{displayName}</strong>
                          {hasGroundTruth && (
                            <span style={{ 
                              fontSize: '0.8rem', 
                              color: '#28a745', 
                              marginLeft: '1rem',
                              backgroundColor: '#d4edda',
                              padding: '0.25rem 0.5rem',
                              borderRadius: '12px',
                              border: '1px solid #c3e6cb'
                            }}>
                              ✓ Ground Truth Available
                            </span>
                          )}
                        </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                          gap: '1rem',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {['Ground Truth', 'PDF'].map((label) => (
                          <label key={label} style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.25rem', 
                            fontSize: '0.9rem',
                            fontWeight: '500',
                            color: '#6c757d'
                          }}>
                        <input type="checkbox" />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Content section */}
                {isOpen && (
                      <div style={{ display: 'flex', minHeight: '600px' }}>
                        {/* Left side - Ground Truth */}
                        <div style={{ 
                          flex: '1', 
                          borderRight: '1px solid #dee2e6',
                          overflow: 'auto',
                          padding: '1.5rem',
                          backgroundColor: '#f8f9fa'
                        }}>
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'space-between', 
                            marginBottom: '1rem',
                            paddingBottom: '0.5rem',
                            borderBottom: '2px solid #e9ecef'
                          }}>
                            <h4 style={{ margin: 0, color: '#495057', fontSize: '1.1rem' }}>Ground Truth</h4>
                            {hasGroundTruth && (
                              <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
                                <label style={{ fontSize: '0.8rem', display:'flex', alignItems:'center', gap:'0.25rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={prettyPrintSet.has(key)}
                                    onChange={(e)=>togglePretty(key, e.target.checked)}
                                  />
                                  Pretty
                                </label>
                                { !editModeSet.has(key) ? (
                                    <button onClick={()=>toggleEditMode(key,true,groundTruth?.content||'')} 
                                      style={{ 
                                        fontSize:'0.8rem', 
                                        background:'none', 
                                        border:'1px solid #007bff', 
                                        color:'#007bff', 
                                        cursor:'pointer', 
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '4px',
                                        transition: 'all 0.2s'
                                      }}>
                                      Edit
                                    </button>
                                  ) : (
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                      <button onClick={()=>handleSaveEdit(key)} 
                                        style={{ 
                                          fontSize:'0.8rem', 
                                          backgroundColor: '#28a745',
                                          color: 'white',
                                          border: 'none',
                                          padding: '0.25rem 0.75rem',
                                          borderRadius: '4px',
                                          cursor: 'pointer'
                                        }}>
                                        Save
                                      </button>
                                      <button onClick={()=>toggleEditMode(key,false,'')} 
                                        style={{ 
                                          fontSize:'0.8rem', 
                                          backgroundColor: '#6c757d',
                                          color: 'white',
                                          border: 'none',
                                          padding: '0.25rem 0.75rem',
                                          borderRadius: '4px',
                                          cursor: 'pointer'
                                        }}>
                                        Cancel
                                      </button>
                                    </div>
                                  ) }
                              </div>
                            )}
                          </div>
                          
                          {hasGroundTruth ? (
                            <div>
                              {hasGroundTruth && !editModeSet.has(key) && (
                                <pre style={{
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  margin: 0,
                                  fontSize: '0.85rem',
                                  lineHeight: '1.4',
                                  backgroundColor: 'white',
                                  padding: '1rem',
                                  borderRadius: '4px',
                                  border: '1px solid #e9ecef'
                                }}>
                                  {(() => {
                                     if (!prettyPrintSet.has(key)) return groundTruth.content;
                                     try {
                                       return JSON.stringify(JSON.parse(groundTruth.content), null, 2);
                                     } catch {
                                       return groundTruth.content;
                                     }
                                   })()}
                                </pre>
                              )}
                              {editModeSet.has(key) && (
                                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                                  <textarea
                                    value={editBuffer[key]}
                                    onChange={e=> setEditBuffer(prev=>({ ...prev, [key]: e.target.value }))}
                                    style={{ 
                                      width:'100%', 
                                      height:'400px', 
                                      fontFamily:'monospace', 
                                      fontSize:'0.85rem',
                                      padding: '1rem',
                                      border: '1px solid #ced4da',
                                      borderRadius: '4px',
                                      resize: 'vertical'
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div style={{
                              textAlign: 'center',
                              padding: '2rem',
                              backgroundColor: 'white',
                              borderRadius: '4px',
                              border: '2px dashed #dee2e6'
                            }}>
                              <p style={{ 
                                color: '#6c757d', 
                                fontStyle: 'italic', 
                                marginBottom: '1rem',
                                fontSize: '1rem'
                              }}>
                                No ground truth file found for this PDF
                              </p>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  seedGroundTruth(key);
                                }}
                                disabled={!settings.extractionEndpoint || seedingStatusForFile === 'Seeding...'}
                                style={{
                                  background: 'none',
                                  border: '2px solid #007bff',
                                  color: '#007bff',
                                  cursor: 'pointer',
                                  fontSize: '0.9rem',
                                  padding: '0.75rem 1.5rem',
                                  borderRadius: '6px',
                                  fontWeight: '500',
                                  transition: 'all 0.2s'
                                }}
                              >
                                {seedingStatusForFile === 'Seeding...' ? 'Seeding...' : 'Start ground truth file by seeding it'}
                              </button>
                              {seedingStatusForFile && seedingStatusForFile !== 'Seeding...' && (
                                <p style={{ 
                                  marginTop: '1rem', 
                                  fontSize: '0.85rem',
                                  color: seedingStatusForFile.includes('failed') ? '#dc3545' : '#28a745',
                                  fontWeight: '500'
                                }}>
                                  {seedingStatusForFile}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Right side - PDF */}
                        <div style={{ flex: '2', backgroundColor: 'white' }}>
                          {key.toLowerCase().endsWith('.pdf') ? (
                      <iframe
                        src={pdfUrls[key] || (()=>{fetchPdf(key); return ''})()}
                        title={key}
                        width="100%"
                              height="100%"
                        style={{ border: 'none' }}
                      />
                          ) : (
                      <pre
                        style={{
                                padding: '1.5rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          margin: 0,
                                height: '100%',
                                overflow: 'auto',
                                fontSize: '0.9rem',
                                lineHeight: '1.5'
                        }}
                      >
                        {content}
                      </pre>
                    )}
                        </div>
                      </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}

export default S3Browser; 