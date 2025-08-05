import React, { useState, useRef } from 'react';
import { buildMismatchInfo, HighlightType, MismatchInfo } from './utils/mismatch';
import { getValueAtPath, resolveScore, getScoreColor } from './utils/jsonUtils';
import { getPdfUrl } from './utils/fileUtils';
import { getExtractedData, filterGroundTruthByTypes, isFieldExcluded, copyToClipboard, calculateDocumentScore } from './utils/documentUtils';

interface DocumentResult {
  filename: string;
  fileHash: string;
  groundTruth: any;
  apiResponses: any[];
  scores: Record<string, number>;
  mismatches: string[];
  // New fields for per-iteration evaluation
  iteration_scores?: Record<string, number>[];  // Scores for each iteration
  iteration_mismatches?: string[][];  // Mismatches for each iteration
}

interface Settings {
  sourceDataPath: string;
  groundTruthPath: string;
  extractionEndpoint: string;
  responsesPath?: string;
  oauthToken?: string;
}

interface Props {
  documents: DocumentResult[];
  selectedDocument: DocumentResult | null;
  setSelectedDocument: React.Dispatch<React.SetStateAction<DocumentResult | null>>;
  selectedIteration: number;
  setSelectedIteration: React.Dispatch<React.SetStateAction<number>>;
  settings: Settings;
  isDarkMode: boolean;
  setDocuments: React.Dispatch<React.SetStateAction<DocumentResult[]>>;
  excludedFields?: string[];
  onGroundTruthSaved?: () => void;
}

const DocumentResultsViewer: React.FC<Props> = ({
  documents,
  selectedDocument,
  setSelectedDocument,
  selectedIteration,
  setSelectedIteration,
  settings,
  isDarkMode,
  setDocuments,
  excludedFields = [],
  onGroundTruthSaved
}) => {
  // State for panel toggles, widths, and heights
  const [panelToggles, setPanelToggles] = useState<Record<string, { gt: boolean; api: boolean; pdf: boolean }>>({});
  const [panelWidths, setPanelWidths] = useState<Record<string, { gt: number; api: number; pdf: number }>>({});
  const [panelHeights, setPanelHeights] = useState<Record<string, number>>({});
  const [issuesHeights, setIssuesHeights] = useState<Record<string, number>>({});

  // State for editing ground truth
  const [editingGroundTruth, setEditingGroundTruth] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState<Record<string, boolean>>({});
  const [fullGroundTruth, setFullGroundTruth] = useState<Record<string, any>>({});

  // Refs for synchronized scrolling
  const groundTruthRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const apiResponseRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Helper functions for panel management
  const getPanelToggles = (filename: string) =>
    panelToggles[filename] || { gt: true, api: true, pdf: true };

  const getPanelWidths = (filename: string) => {
    const storedWidths = panelWidths[filename] || { gt: 33.33, api: 33.33, pdf: 33.34 };
    const toggles = getPanelToggles(filename);

    // Calculate total width of visible panels
    const visiblePanels = [];
    if (toggles.gt) visiblePanels.push('gt');
    if (toggles.api) visiblePanels.push('api');
    if (toggles.pdf) visiblePanels.push('pdf');

    if (visiblePanels.length === 0) return storedWidths;

    // Get the stored widths for visible panels and normalize to 100%
    const visibleWidthsSum = visiblePanels.reduce((sum, panel) => sum + storedWidths[panel as keyof typeof storedWidths], 0);
    const scale = 100 / visibleWidthsSum;

    return {
      gt: toggles.gt ? storedWidths.gt * scale : 0,
      api: toggles.api ? storedWidths.api * scale : 0,
      pdf: toggles.pdf ? storedWidths.pdf * scale : 0
    };
  };

  const getPanelHeight = (filename: string) => panelHeights[filename] || 600;
  const getIssuesHeight = (filename: string) => issuesHeights[filename] || 300;

  const setPanelToggle = (filename: string, panel: 'gt' | 'api' | 'pdf', value: boolean) => {
    setPanelToggles(prev => ({
      ...prev,
      [filename]: { ...getPanelToggles(filename), [panel]: value }
    }));
  };

  // Resizing handlers
  const handleVerticalResize = (filename: string, newHeight: number) => {
    const minHeight = 300;
    const maxHeight = 1200;
    const constrainedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

    setPanelHeights(prev => ({
      ...prev,
      [filename]: constrainedHeight
    }));
  };

  const handleIssuesResize = (filename: string, newHeight: number) => {
    const minHeight = 100;
    const maxHeight = 600;
    const constrainedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

    setIssuesHeights(prev => ({
      ...prev,
      [filename]: constrainedHeight
    }));
  };

  type Corner = 'gt-api' | 'api-pdf';

  const startCornerResize = (
    filename: string,
    corner: Corner,
    startX: number,
    startY: number,
    startWidths: { gt: number; api: number; pdf: number },
    startHeight: number
  ) => {
    const container = document.getElementById(`panels-${filename}`);
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const containerW = rect.width;

    const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
    let isDragging = false;

    // Disable pointer events on PDF iframe during resize
    const pdfIframe = container.querySelector('iframe');
    if (pdfIframe) {
      pdfIframe.style.pointerEvents = 'none';
    }

    const onMouseMove = (e: MouseEvent) => {
      // Only update if we're actually dragging (mouse button is down)
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const deltaPct = (dx / containerW) * 100;

      let { gt, api, pdf } = startWidths;
      const toggles = getPanelToggles(filename);

      if (corner === 'gt-api') {
        const MIN = 20;
        const pdfMin = toggles.pdf ? MIN : 0;

        // 1) unclamped target for GT
        const unclampedGt = startWidths.gt + deltaPct;
        // 2) max GT possible = 100 - MIN(API) - MIN(PDF)
        const maxGt = 100 - MIN - pdfMin;
        const newGt = clamp(unclampedGt, MIN, maxGt);

        // how many percent we had to take from the other two
        let shrink = newGt - startWidths.gt;

        // 3) shrink API first
        let newApi = startWidths.api;
        if (toggles.api) {
          const apiShrinkable = startWidths.api - MIN;
          const takeFromApi = Math.min(apiShrinkable, shrink);
          newApi -= takeFromApi;
          shrink -= takeFromApi;
        }

        // 4) then shrink PDF if needed
        let newPdf = toggles.pdf ? startWidths.pdf : 0;
        if (toggles.pdf && shrink > 0) {
          const pdfShrinkable = startWidths.pdf - pdfMin;
          const takeFromPdf = Math.min(pdfShrinkable, shrink);
          newPdf -= takeFromPdf;
          shrink -= takeFromPdf;
        }

        gt = newGt;
        api = newApi;
        pdf = newPdf;
      } else {
        // grow/shrink API, shrink/grow PDF
        const newApi = clamp(api + deltaPct, 20, 80 - gt);
        const newPdf = 100 - gt - newApi;
        api = newApi; pdf = newPdf;
      }

      const newHeight = clamp(startHeight + dy, 300, 1200);

      setPanelWidths(prev => ({
        ...prev,
        [filename]: { gt, api, pdf }
      }));
      setPanelHeights(prev => ({
        ...prev,
        [filename]: newHeight
      }));
    };

    const cleanup = () => {
      isDragging = false;
      // Re-enable pointer events on PDF iframe
      if (pdfIframe) {
        pdfIframe.style.pointerEvents = 'auto';
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mouseleave', onMouseUp);
      window.removeEventListener('blur', onMouseUp);
    };

    const onMouseUp = () => {
      cleanup();
    };

    // Set dragging flag to true when we start
    isDragging = true;

    // Add multiple event listeners to ensure cleanup happens
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mouseleave', onMouseUp);
    window.addEventListener('blur', onMouseUp);
  };

  const handleResize = (filename: string, dragX: number, containerWidth: number, resizeType: 'gt-api' | 'gt-pdf' | 'api-pdf') => {
    const toggles = getPanelToggles(filename);
    const storedWidths = panelWidths[filename] || { gt: 33.33, api: 33.33, pdf: 33.34 };
    const dragPercent = (dragX / containerWidth) * 100;

    if (resizeType === 'gt-api' && toggles.gt && toggles.api) {
      // Dragging between GT and API
      const gtPercent = Math.max(20, Math.min(80, dragPercent));
      const apiPercent = toggles.pdf ? Math.max(20, storedWidths.api) : 100 - gtPercent;
      const pdfPercent = toggles.pdf ? Math.max(20, 100 - gtPercent - apiPercent) : 0;

      setPanelWidths(prev => ({
        ...prev,
        [filename]: { gt: gtPercent, api: apiPercent, pdf: pdfPercent }
      }));
    } else if (resizeType === 'gt-pdf' && toggles.gt && toggles.pdf && !toggles.api) {
      // Dragging between GT and PDF (when API is hidden)
      const gtPercent = Math.max(20, Math.min(80, dragPercent));
      const pdfPercent = 100 - gtPercent;

      setPanelWidths(prev => ({
        ...prev,
        [filename]: { gt: gtPercent, api: 0, pdf: pdfPercent }
      }));
    } else if (resizeType === 'api-pdf' && toggles.api && toggles.pdf) {
      // Dragging between API and PDF
      const gtPercent = toggles.gt ? storedWidths.gt : 0;
      const apiPercent = Math.max(20, Math.min(80 - gtPercent, dragPercent - gtPercent));
      const pdfPercent = 100 - gtPercent - apiPercent;

      setPanelWidths(prev => ({
        ...prev,
        [filename]: { gt: gtPercent, api: apiPercent, pdf: Math.max(20, pdfPercent) }
      }));
    }
  };

  // Synchronized scrolling handlers
  const handleGroundTruthScroll = (filename: string) => (e: React.UIEvent<HTMLDivElement>) => {
    const apiRef = apiResponseRefs.current[filename];
    if (apiRef) {
      apiRef.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const handleApiResponseScroll = (filename: string) => (e: React.UIEvent<HTMLDivElement>) => {
    const gtRef = groundTruthRefs.current[filename];
    if (gtRef) {
      gtRef.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Ground truth editing handlers
  const handleEditGroundTruth = (filename: string, value: string) => {
    try {
      setEditingGroundTruth(prev => ({ ...prev, [filename]: value }));
    } catch (error) {
      console.error('Error updating ground truth text:', error);
    }
  };

  const handleEditClick = (filename: string, groundTruth: any) => {
    try {
      const jsonString = groundTruth ? JSON.stringify(groundTruth, null, 2) : '{}';
      setEditingGroundTruth(prev => ({ ...prev, [filename]: jsonString }));
      setFullGroundTruth(prev => ({ ...prev, [filename]: groundTruth || {} }));
      setIsEditing(prev => ({ ...prev, [filename]: true }));
    } catch (error) {
      console.error('Error setting up ground truth editing:', error);
      alert('Error opening ground truth for editing');
    }
  };

  const handleSaveGroundTruth = async (origFilename: string, fileHash: string, event?: React.MouseEvent) => {
    if (event) event.preventDefault();
    console.log('Save clicked for', origFilename);
    const shaFilename = fileHash + '.json';
    try {
      const raw = editingGroundTruth[origFilename];
      if (!raw) {
        alert('Ground truth cannot be empty.');
        return;
      }
      let parsed;
      try { parsed = JSON.parse(raw); } catch (e) { alert('Invalid JSON'); return; }
      const resp = await fetch('http://localhost:8000/save-ground-truth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: shaFilename, content: parsed, ground_truth_uri: settings.groundTruthPath }) });
      if (!resp.ok) { alert('Failed to save'); return; }
      const updated = documents.map(d => d.filename === origFilename ? { ...d, groundTruth: parsed } : d);
      setDocuments(updated);
      setIsEditing(prev => ({ ...prev, [origFilename]: false }));

      // Automatically refresh calculations after saving ground truth
      if (onGroundTruthSaved) {
        onGroundTruthSaved();
      }
    } catch (e) { console.error(e); alert('Unexpected error'); }
  };

  const handleSeedGroundTruth = (filename: string, apiResponse: any) => {
    setEditingGroundTruth(prev => ({ ...prev, [filename]: JSON.stringify(apiResponse, null, 2) }));
    setIsEditing(prev => ({ ...prev, [filename]: true }));
  };

  const handleCopyGroundTruth = (doc: DocumentResult) => {
    if (doc.groundTruth) {
      const jsonString = JSON.stringify(doc.groundTruth, null, 2);
      copyToClipboard(jsonString, 'Ground Truth');
    }
  };

  const handleCopyApiResponse = (doc: DocumentResult) => {
    const apiResponse = doc.apiResponses[selectedIteration] || doc.apiResponses[0];
    if (apiResponse) {
      const jsonString = JSON.stringify(apiResponse, null, 2);
      copyToClipboard(jsonString, 'API Response');
    }
  };

  // Enhanced renderer: highlights both by exact path and by value matches within bracketed mismatch descriptions
  const renderJsonScore = (
    data: any,
    scores: Record<string, number>,
    mismatchInfo: MismatchInfo = { pathMap: {}, valueBased: [] },
    groundTruthData: any = {},
    path: string = '',
    showMissingKeys: boolean = true,
    rootData?: any  // Add rootData parameter
  ) => {
    // Set rootData to current data on first call
    const currentRootData = rootData || data;
    
    if (typeof data !== 'object' || data === null) {
      return <span>{JSON.stringify(data)}</span>;
    }

    if (Array.isArray(data)) {
      return (
        <span>
          [
          {data.map((v, i) => (
            <div key={i} style={{ paddingLeft: 16 }}>
              {renderJsonScore(v, scores, mismatchInfo, groundTruthData, `${path}[${i}]`, showMissingKeys, currentRootData)}
              {i < data.length - 1 && ','}
            </div>
          ))}
          ]
        </span>
      );
    }

    return (
      <span>
        {'{'}
        {(() => {
          const dataKeys = Object.keys(data || {});
          let allKeys = dataKeys;
          if (showMissingKeys) {
            let gtKeys: string[] = [];
            const gtAtPath = path ? getValueAtPath(groundTruthData, path) : groundTruthData;
            if (gtAtPath && typeof gtAtPath === 'object' && !Array.isArray(gtAtPath)) {
              gtKeys = Object.keys(gtAtPath);
            }
            allKeys = [...new Set([...dataKeys, ...gtKeys])];
          }

          return allKeys.map((k, idx) => {
            const v = data?.[k];
            const full = path ? `${path}.${k}` : k;
            const normalizedFull = full.replace(/\[\d+\]/g, '');
            const score = resolveScore(full, scores);

            let highlight: HighlightType | undefined;

            // First: value-based (bracketed) matches
            if (v != null && typeof v !== 'object') {
              const valStr = String(v).toLowerCase();
              for (const entry of mismatchInfo.valueBased) {
                if (entry.basePathRe.test(full)) {
                  // Check if this is compound format (dosage|value)
                  if (entry.bracketValue.includes('|')) {
                    const [dosage, expectedValue] = entry.bracketValue.split('|');
                    
                    // For compound format, check both dosage and value match
                    if (full.match(/medications\.medications\[\d+\]\./)) {
                      const indexMatch = full.match(/medications\.medications\[(\d+)\]\./);
                      if (indexMatch) {
                        const index = parseInt(indexMatch[1]);
                        const medication = currentRootData?.medications?.medications?.[index];
                        if (medication && medication.dosage === dosage && valStr === expectedValue.toLowerCase()) {
                          highlight = entry.type;
                          console.log('✅ compound match', { full, value: v, dosage: medication.dosage, expectedDosage: dosage, expectedValue });
                          break;
                        }
                      }
                    }
                  } else {
                    // For pipe-bracket format, check if this field belongs to a medication with the expected dosage
                    if (full.match(/medications\.medications\[\d+\]\./)) {
                      const indexMatch = full.match(/medications\.medications\[(\d+)\]\./);
                      if (indexMatch) {
                        const index = parseInt(indexMatch[1]);
                        const medication = currentRootData?.medications?.medications?.[index];
                        if (medication && medication.dosage === entry.bracketValue) {
                          highlight = entry.type;
                          console.log('✅ dosage-based match', { full, value: v, dosage: medication.dosage, expectedDosage: entry.bracketValue });
                          break;
                        }
                      }
                    } else if (valStr === entry.bracketValue.toLowerCase()) {
                      // Original exact value matching
                      highlight = entry.type;
                      console.log('✅ value-based match', { full, value: v, entry: entry.basePathRe.toString(), bracketValue: entry.bracketValue });
                      break;
                    }
                  }
                }
              }
            }

            // Fallback: exact / normalized pathMap matches
            if (!highlight) {
              if (mismatchInfo.pathMap[full]) {
                highlight = mismatchInfo.pathMap[full];
              } else if (mismatchInfo.pathMap[normalizedFull]) {
                highlight = mismatchInfo.pathMap[normalizedFull];
              }
            }
 
            // DEBUG LOGGING: print any resolved FP/FN highlight for inspection
            if (highlight === 'FP' || highlight === 'FN') {
              // eslint-disable-next-line no-console
              console.log(`🎨 [${highlight}]`, { path: full, value: v, normalizedPath: normalizedFull });
            }

            const gtValue = getValueAtPath(groundTruthData, full);
            const valuesAreIdentical = JSON.stringify(v) === JSON.stringify(gtValue);
            const fieldIsExcluded = isFieldExcluded(full, excludedFields);

            // Key styling
            let keyStyle: React.CSSProperties | undefined;
            if (fieldIsExcluded) {
              keyStyle = { color: isDarkMode ? '#6b7280' : '#9ca3af', fontWeight: 'normal', opacity: 0.6 };
            } else if (highlight === 'FN') {
              keyStyle = { backgroundColor: '#8b5cf620', padding: '0 4px', color: '#8b5cf6', fontWeight: 'bold' };
            } else if (highlight === 'FP') {
              keyStyle = { backgroundColor: 'rgba(255,179,179,0.25)', padding: '0 4px', color: '#ef4444', fontWeight: 'bold' };
            } else if (score === undefined || score === 1.0 || valuesAreIdentical) {
              keyStyle = { color: '#28a745', fontWeight: 'bold' };
            } else {
              keyStyle = { color: isDarkMode ? '#d1d5db' : '#374151', fontWeight: 'normal' };
            }

            // Value styling
            let valueStyle: React.CSSProperties | undefined;
            if (fieldIsExcluded) {
              valueStyle = { color: isDarkMode ? '#6b7280' : '#9ca3af', fontWeight: 'normal', opacity: 0.6 };
            } else if (highlight === 'FN') {
              valueStyle = { backgroundColor: '#8b5cf620', padding: '0 4px', color: '#8b5cf6', fontWeight: 'bold' };
            } else if (highlight === 'FP') {
              valueStyle = { backgroundColor: 'rgba(255,179,179,0.25)', padding: '0 4px', color: '#ef4444', fontWeight: 'bold' };
            } else if (score === undefined || score === 1.0 || valuesAreIdentical) {
              valueStyle = { color: '#28a745', fontWeight: 'bold' };
            } else {
              const color = getScoreColor(score);
              valueStyle = { backgroundColor: `${color}20`, padding: '0 4px', color: color, fontWeight: 'bold' };
            }

            return (
              <div key={`${full}-${idx}`} style={{ paddingLeft: 16 }}>
                <span style={keyStyle}>{JSON.stringify(k)}</span>: {typeof v === 'object' ? (
                  renderJsonScore(v, scores, mismatchInfo, groundTruthData, full, showMissingKeys, currentRootData)
                ) : (
                  <span style={valueStyle}>{JSON.stringify(v)}</span>
                )}{idx < allKeys.length - 1 && ','}
              </div>
            );
          });
        })()}
        {'}'}
      </span>
    );
  };


  if (documents.length === 0) {
    return null;
  }

  return (
    <div className={isDarkMode ? 'dark' : ''} style={{
      marginBottom: '2rem',
      position: 'relative',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'calc(100vw - 6rem)', // full viewport width minus 2rem margin on each side
      padding: '2rem'
    }}>
      {/* Document List View */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {documents
          .sort((a, b) => a.filename.localeCompare(b.filename))
          .map((doc) => {
            const isOpen = selectedDocument?.filename === doc.filename;
            const toggles = getPanelToggles(doc.filename);
            const widths = getPanelWidths(doc.filename);
            const containerHeight = getPanelHeight(doc.filename);
            const displayName = `${doc.filename} (${doc.fileHash.substring(0, 8)}...)`;
            const hasApiResponse = doc.apiResponses && doc.apiResponses.length > 0;

            // Calculate score as (non-null fields) / (non-null fields + total FN + FP across all iterations)
            const averageScore = calculateDocumentScore(doc);

            // Keep iteration-specific scores for highlighting
            const currentIterationScores = doc.iteration_scores && doc.iteration_scores[selectedIteration]
              ? doc.iteration_scores[selectedIteration]
              : doc.scores;

            const extractionTypes = (doc.apiResponses[selectedIteration] || doc.apiResponses[0] || {}).extractionTypes || [];
            const filteredGroundTruth = filterGroundTruthByTypes(doc.groundTruth, extractionTypes);

            // Safely parse editing ground truth with error handling
            let parsedEditingGroundTruth = {};
            if (editingGroundTruth[doc.filename]) {
              try {
                parsedEditingGroundTruth = JSON.parse(editingGroundTruth[doc.filename]);
              } catch (error) {
                // Invalid JSON during editing - just use empty object, don't crash
                parsedEditingGroundTruth = {};
              }
            }

            const filteredEditingGroundTruth = filterGroundTruthByTypes(
              parsedEditingGroundTruth,
              extractionTypes
            );

            // Use iteration-specific mismatches if available, otherwise fall back to general mismatches
            const currentIterationMismatches = doc.iteration_mismatches && doc.iteration_mismatches[selectedIteration]
              ? doc.iteration_mismatches[selectedIteration]
              : doc.mismatches;

            const mismatchInfo = buildMismatchInfo(currentIterationMismatches);

            // DEBUG: Log the mismatches and built info
            if (currentIterationMismatches.length > 0) {
              // eslint-disable-next-line no-console
              console.log('🔍 Processing mismatches for', doc.filename, ':', currentIterationMismatches);
              // eslint-disable-next-line no-console
              console.log('📊 Built MismatchInfo:', JSON.stringify(mismatchInfo, null, 2));
            }

            return (
              <div
                key={`${doc.filename}-${currentIterationMismatches.length}-${selectedIteration}`}
                style={{
                  overflow: 'hidden',
                  position: 'relative',
                  borderRadius: '8px',
                  border: isOpen ? `1px solid ${isDarkMode ? '#374151' : '#e2e8f0'}` : 'none',
                  boxShadow: isOpen ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
                  backgroundColor: isOpen ? (isDarkMode ? '#1f2937' : 'white') : 'transparent'
                }}
              >
                {/* Document Header */}
                <div
                  onClick={() => setSelectedDocument(isOpen ? null : doc)}
                  style={{
                    background: isDarkMode
                      ? 'linear-gradient(135deg, #374151 0%, #1f2937 100%)'
                      : 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
                    padding: '1rem 1.5rem',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${isDarkMode ? '#374151' : '#dee2e6'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    transition: 'background-color 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontSize: '1.2rem', color: isDarkMode ? '#9ca3af' : '#6c757d', fontWeight: 'bold' }}>
                      {isOpen ? '▼' : '▶'}
                    </span>
                    <div>
                      <strong style={{ fontSize: '1.1rem', color: isDarkMode ? '#ffffff' : '#495057' }}>{displayName}</strong>
                      {hasApiResponse && (
                        <span style={{
                          fontSize: '0.8rem',
                          color: averageScore === 1.0 ? '#28a745' : averageScore > 0.5 ? '#fd7e14' : '#dc3545',
                          marginLeft: '1rem',
                          backgroundColor: averageScore === 1.0 ? '#d4edda' : averageScore > 0.5 ? '#fff3cd' : '#f8d7da',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '12px',
                          border: `1px solid ${averageScore === 1.0 ? '#c3e6cb' : averageScore > 0.5 ? '#ffeaa7' : '#f5c6cb'}`,
                          // Darker text for dark mode
                          filter: isDarkMode ? 'brightness(1.2) contrast(1.1)' : 'none'
                        }}>
                          ✓ Score: {(averageScore * 100).toFixed(0)}%
                        </span>
                      )}

                    </div>
                  </div>
                </div>

                {/* Three-Column Content */}
                {isOpen && (
                  <>
                    <div style={{ position: 'relative' }}>
                      <div
                        style={{
                          display: 'flex',
                          height: containerHeight,
                          position: 'relative',
                          width: '100%',
                          minWidth: 0,
                          overflowX: 'hidden'
                        }}
                        id={`panels-${doc.filename}`}
                      >
                        {/* Left Column - Ground Truth */}
                        {toggles.gt && (
                          <div style={{
                            width: `${widths.gt}%`,
                            overflow: 'auto',
                            padding: '0.5rem 0.5rem 0.5rem 0.5rem',
                            backgroundColor: isDarkMode ? '#1f2937' : '#f8f9fa',
                            borderRight: `1px solid ${isDarkMode ? '#374151' : '#dee2e6'}`,
                            minWidth: 0,
                            boxSizing: 'border-box',
                            display: 'flex',
                            flexDirection: 'column',
                            height: '100%',
                          }}>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: '0.25rem',
                              paddingBottom: '0.25rem',
                              borderBottom: `2px solid ${isDarkMode ? '#374151' : '#e9ecef'}`
                            }}>
                              <h4 style={{ margin: 0, color: isDarkMode ? '#ffffff' : '#495057', fontSize: '1.1rem' }}>Ground Truth</h4>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {doc.groundTruth && !isEditing[doc.filename] && (
                                  <>
                                    <button
                                      onClick={() => handleCopyGroundTruth(doc)}
                                      style={{
                                        padding: '0.4rem',
                                        background: 'transparent',
                                        color: isDarkMode ? '#d1d5db' : '#6b7280',
                                        border: 'none',
                                        borderRadius: 4,
                                        cursor: 'pointer',
                                        fontSize: '1.2rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '2rem',
                                        height: '2rem',
                                        transition: 'all 0.2s ease'
                                      }}
                                      title="Copy Ground Truth JSON"
                                      onMouseOver={(e) => e.currentTarget.style.color = isDarkMode ? '#ffffff' : '#374151'}
                                      onMouseOut={(e) => e.currentTarget.style.color = isDarkMode ? '#d1d5db' : '#6b7280'}
                                    >
                                      ⧉
                                    </button>
                                    <button
                                      onClick={() => handleEditClick(doc.filename, doc.groundTruth)}
                                      style={{
                                        padding: '0.3rem 1rem',
                                        background: '#ffe066',
                                        color: '#222',
                                        border: 'none',
                                        borderRadius: 4,
                                        fontWeight: 600
                                      }}
                                    >
                                      Edit
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {isEditing[doc.filename] ? (
                              <div>
                                <textarea
                                  value={editingGroundTruth[doc.filename] || ''}
                                  onChange={e => handleEditGroundTruth(doc.filename, e.target.value)}
                                  style={{ width: '100%', minHeight: 300, fontFamily: 'monospace', fontSize: '1rem', borderRadius: 6, border: '1px solid #ccc', padding: 8 }}
                                />
                                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                                  <button type="button" onClick={e => handleSaveGroundTruth(doc.filename, doc.fileHash, e)} style={{ padding: '0.5rem 1.5rem', background: '#10b981', color: 'white', border: 'none', borderRadius: 4, fontWeight: 600 }}>Save</button>
                                  <button type="button" onClick={() => setIsEditing(prev => ({ ...prev, [doc.filename]: false }))} style={{ padding: '0.5rem 1.5rem', background: '#e5e7eb', color: '#222', border: 'none', borderRadius: 4, fontWeight: 600 }}>Cancel</button>
                                </div>
                              </div>
                            ) : doc.groundTruth ? (
                              <div
                                ref={(el) => { groundTruthRefs.current[doc.filename] = el; }}
                                onScroll={handleGroundTruthScroll(doc.filename)}
                                style={{
                                  backgroundColor: isDarkMode ? '#374151' : '#f8f9fa',
                                  padding: '0.25rem',
                                  borderRadius: '4px',
                                  border: `1px solid ${isDarkMode ? '#4b5563' : '#e9ecef'}`,
                                  overflow: 'auto',
                                  flex: 1,
                                  minHeight: 0,
                                  height: '100%',
                                  scrollbarWidth: 'thin',
                                  scrollbarColor: isDarkMode ? '#6b7280 #374151' : '#cbd5e1 #f8f9fa'
                                }}
                                className="custom-scrollbar">
                                {(() => {
                                  // Use iteration-specific scores if available, otherwise fall back to general scores
                                  const currentIterationScores = doc.iteration_scores && doc.iteration_scores[selectedIteration]
                                    ? doc.iteration_scores[selectedIteration]
                                    : doc.scores;

                                  return renderJsonScore(
                                    filteredGroundTruth,
                                    currentIterationScores,
                                    mismatchInfo,
                                    getExtractedData(doc.apiResponses[selectedIteration] || doc.apiResponses[0] || {}),
                                    '',
                                    true,
                                    filteredGroundTruth
                                  );
                                })()}
                              </div>
                            ) : (
                              <div style={{ textAlign: 'center', padding: '2rem', color: isDarkMode ? '#9ca3af' : '#6c757d', fontStyle: 'italic', backgroundColor: isDarkMode ? '#1f2937' : '#f8f9fa', border: `2px dashed ${isDarkMode ? '#4b5563' : '#dee2e6'}`, borderRadius: '4px' }}>
                                <div style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>📄</div>
                                <div>No ground truth file found</div>
                                <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', color: isDarkMode ? '#6b7280' : '#868e96' }}>
                                  Ground truth data is not available for this document
                                </div>
                                <button onClick={() => handleSeedGroundTruth(doc.filename, getExtractedData(doc.apiResponses[selectedIteration] || doc.apiResponses[0] || {}))} style={{ marginTop: 16, padding: '0.5rem 1.5rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 4, fontWeight: 600 }}>Start a ground truth file by seeding</button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Resize Handle - Between any two adjacent visible panels */}
                        {toggles.gt && (toggles.api || (!toggles.api && toggles.pdf)) && (
                          <div
                            style={{
                              width: '4px',
                              backgroundColor: isDarkMode ? '#4b5563' : '#d1d5db',
                              cursor: 'col-resize',
                              position: 'relative',
                              zIndex: 10
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const container = document.getElementById(`panels-${doc.filename}`);
                              if (!container) return;

                              const startX = e.clientX;
                              const containerRect = container.getBoundingClientRect();

                              let isDragging = false;

                              // Disable pointer events on PDF iframe during resize
                              const pdfIframe = container.querySelector('iframe');
                              if (pdfIframe) {
                                pdfIframe.style.pointerEvents = 'none';
                              }

                              const handleMouseMove = (moveEvent: MouseEvent) => {
                                // Only update if we're actually dragging
                                if (!isDragging) return;

                                const newX = moveEvent.clientX - containerRect.left;
                                // Determine which panels we're resizing between
                                const isGtAndApi = toggles.api;
                                const isGtAndPdf = !toggles.api && toggles.pdf;
                                handleResize(doc.filename, newX, containerRect.width, isGtAndApi ? 'gt-api' : 'gt-pdf');
                              };

                              const cleanup = () => {
                                isDragging = false;
                                // Re-enable pointer events on PDF iframe
                                if (pdfIframe) {
                                  pdfIframe.style.pointerEvents = 'auto';
                                }
                                document.removeEventListener('mousemove', handleMouseMove);
                                document.removeEventListener('mouseup', handleMouseUp);
                                document.removeEventListener('mouseleave', handleMouseUp);
                                window.removeEventListener('blur', handleMouseUp);
                              };

                              const handleMouseUp = () => {
                                cleanup();
                              };

                              // Set dragging flag to true when we start
                              isDragging = true;

                              document.addEventListener('mousemove', handleMouseMove);
                              document.addEventListener('mouseup', handleMouseUp);
                              document.addEventListener('mouseleave', handleMouseUp);
                              window.addEventListener('blur', handleMouseUp);
                            }}
                          />
                        )}



                        {/* Middle Column - API Response */}
                        {toggles.api && (
                          <div style={{
                            width: `${widths.api}%`,
                            overflow: 'auto',
                            padding: '0.5rem 0.5rem 0.5rem 0.5rem',
                            backgroundColor: isDarkMode ? '#1f2937' : '#fff',
                            borderRight: `1px solid ${isDarkMode ? '#374151' : '#dee2e6'}`,
                            minWidth: 0,
                            boxSizing: 'border-box',
                            display: 'flex',
                            flexDirection: 'column',
                            height: '100%',
                          }}>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: '0.25rem',
                              paddingBottom: '0.25rem',
                              borderBottom: `2px solid ${isDarkMode ? '#374151' : '#e9ecef'}`
                            }}>
                              <h4 style={{ margin: 0, color: isDarkMode ? '#ffffff' : '#495057', fontSize: '1.1rem' }}>API Response</h4>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {hasApiResponse && (
                                  <button
                                    onClick={() => handleCopyApiResponse(doc)}
                                    style={{
                                      padding: '0.4rem',
                                      background: 'transparent',
                                      color: isDarkMode ? '#d1d5db' : '#6b7280',
                                      border: 'none',
                                      borderRadius: 4,
                                      cursor: 'pointer',
                                      fontSize: '1.2rem',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      width: '2rem',
                                      height: '2rem',
                                      transition: 'all 0.2s ease'
                                    }}
                                    title="Copy API Response JSON"
                                    onMouseOver={(e) => e.currentTarget.style.color = isDarkMode ? '#ffffff' : '#374151'}
                                    onMouseOut={(e) => e.currentTarget.style.color = isDarkMode ? '#d1d5db' : '#6b7280'}
                                  >
                                    ⧉
                                  </button>
                                )}
                                {doc.apiResponses.length > 1 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <button
                                      onClick={() => setSelectedIteration(Math.max(0, selectedIteration - 1))}
                                      disabled={selectedIteration === 0}
                                      style={{
                                        padding: '0.25rem 0.5rem',
                                        border: 'none',
                                        borderRadius: '4px',
                                        fontSize: '0.8rem',
                                        backgroundColor: selectedIteration === 0 ? (isDarkMode ? '#374151' : '#e9ecef') : (isDarkMode ? '#4b5563' : '#6c757d'),
                                        color: selectedIteration === 0 ? (isDarkMode ? '#9ca3af' : '#6c757d') : 'white',
                                        cursor: selectedIteration === 0 ? 'not-allowed' : 'pointer',
                                        fontWeight: 'bold'
                                      }}
                                    >
                                      ←
                                    </button>
                                    <span style={{
                                      fontSize: '0.8rem',
                                      fontWeight: 'bold',
                                      color: isDarkMode ? '#ffffff' : '#000000'
                                    }}>
                                      {selectedIteration + 1}/{doc.apiResponses.length}
                                    </span>
                                    <button
                                      onClick={() => setSelectedIteration(Math.min(doc.apiResponses.length - 1, selectedIteration + 1))}
                                      disabled={selectedIteration === doc.apiResponses.length - 1}
                                      style={{
                                        padding: '0.25rem 0.5rem',
                                        border: 'none',
                                        borderRadius: '4px',
                                        fontSize: '0.8rem',
                                        backgroundColor: selectedIteration === doc.apiResponses.length - 1 ? (isDarkMode ? '#374151' : '#e9ecef') : (isDarkMode ? '#4b5563' : '#6c757d'),
                                        color: selectedIteration === doc.apiResponses.length - 1 ? (isDarkMode ? '#9ca3af' : '#6c757d') : 'white',
                                        cursor: selectedIteration === doc.apiResponses.length - 1 ? 'not-allowed' : 'pointer',
                                        fontWeight: 'bold'
                                      }}
                                    >
                                      →
                                    </button>
                                  </div>
                                )}

                              </div>
                            </div>

                            <div
                              ref={(el) => { apiResponseRefs.current[doc.filename] = el; }}
                              onScroll={handleApiResponseScroll(doc.filename)}
                              style={{
                                backgroundColor: isDarkMode ? '#374151' : '#f8f9fa',
                                padding: '0.25rem',
                                borderRadius: '4px',
                                border: `1px solid ${isDarkMode ? '#4b5563' : '#e9ecef'}`,
                                overflow: 'auto',
                                flex: 1,
                                minHeight: 0,
                                height: '100%',
                                scrollbarWidth: 'thin',
                                scrollbarColor: isDarkMode ? '#6b7280 #374151' : '#cbd5e1 #f8f9fa'
                              }}
                              className="custom-scrollbar">
                              {hasApiResponse ? (
                                (() => {
                                  // Use iteration-specific scores if available, otherwise fall back to general scores
                                  const currentIterationScores = doc.iteration_scores && doc.iteration_scores[selectedIteration]
                                    ? doc.iteration_scores[selectedIteration]
                                    : doc.scores;

                                  return renderJsonScore(
                                    getExtractedData(doc.apiResponses[selectedIteration] || doc.apiResponses[0]),
                                    currentIterationScores,
                                    mismatchInfo,
                                    filteredGroundTruth,
                                    '',
                                    false,  // Don't show missing keys in API response
                                    getExtractedData(doc.apiResponses[selectedIteration] || doc.apiResponses[0])
                                  );
                                })()
                              ) : (
                                <div style={{ textAlign: 'center', color: isDarkMode ? '#9ca3af' : '#6c757d', padding: '2rem' }}>
                                  <p>No API response available</p>
                                  <p style={{ fontSize: '0.8rem' }}>Run an evaluation to see extraction results</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Resize Handle 2 - Between API and PDF (only when API is visible) */}
                        {toggles.api && toggles.pdf && (
                          <div
                            style={{
                              width: '4px',
                              backgroundColor: isDarkMode ? '#4b5563' : '#d1d5db',
                              cursor: 'col-resize',
                              position: 'relative',
                              zIndex: 10
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const container = document.getElementById(`panels-${doc.filename}`);
                              if (!container) return;

                              const containerRect = container.getBoundingClientRect();

                              let isDragging = false;

                              // Disable pointer events on PDF iframe during resize
                              const pdfIframe = container.querySelector('iframe');
                              if (pdfIframe) {
                                pdfIframe.style.pointerEvents = 'none';
                              }

                              const handleMouseMove = (moveEvent: MouseEvent) => {
                                // Only update if we're actually dragging
                                if (!isDragging) return;

                                const newX = moveEvent.clientX - containerRect.left;
                                handleResize(doc.filename, newX, containerRect.width, 'api-pdf');
                              };

                              const cleanup = () => {
                                isDragging = false;
                                // Re-enable pointer events on PDF iframe
                                if (pdfIframe) {
                                  pdfIframe.style.pointerEvents = 'auto';
                                }
                                document.removeEventListener('mousemove', handleMouseMove);
                                document.removeEventListener('mouseup', handleMouseUp);
                                document.removeEventListener('mouseleave', handleMouseUp);
                                window.removeEventListener('blur', handleMouseUp);
                              };

                              const handleMouseUp = () => {
                                cleanup();
                              };

                              // Set dragging flag to true when we start
                              isDragging = true;

                              document.addEventListener('mousemove', handleMouseMove);
                              document.addEventListener('mouseup', handleMouseUp);
                              document.addEventListener('mouseleave', handleMouseUp);
                              window.addEventListener('blur', handleMouseUp);
                            }}
                          />
                        )}



                        {/* Right Column - PDF */}
                        {toggles.pdf && (
                          <div style={{
                            width: `${widths.pdf}%`,
                            display: 'flex',
                            flexDirection: 'column',
                            backgroundColor: isDarkMode ? '#1f2937' : 'white',
                            overflow: 'auto',
                            minWidth: 0,
                            boxSizing: 'border-box',
                            height: '100%',
                          }}>

                            {doc.filename.toLowerCase().endsWith('.pdf') ? (
                              <div style={{
                                flex: 1,
                                padding: '0',
                                minHeight: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                height: '100%',
                              }}>
                                <iframe
                                  src={getPdfUrl(doc.fileHash, doc.filename, settings.sourceDataPath)}
                                  title={`PDF: ${doc.filename}`}
                                  style={{
                                    width: '100%',
                                    flex: 1,
                                    border: 'none',
                                    borderRadius: '8px',
                                    backgroundColor: 'white',
                                    minHeight: 0,
                                    height: '100%',
                                    display: 'block',
                                  }}
                                />
                              </div>
                            ) : (
                              <div style={{
                                flex: 1,
                                padding: '0',
                                minHeight: 0,
                                display: 'flex',
                                flexDirection: 'column'
                              }}>
                                <pre style={{
                                  padding: '0.25rem',
                                  overflow: 'auto',
                                  flex: 1,
                                  backgroundColor: isDarkMode ? '#374151' : '#f8f9fa',
                                  border: `1px solid ${isDarkMode ? '#4b5563' : '#e9ecef'}`,
                                  borderRadius: '4px',
                                  margin: 0,
                                  minHeight: '500px'
                                }}>
                                  {doc.groundTruth
                                    ? JSON.stringify(doc.groundTruth, null, 2)
                                    : 'No content available'}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* GT ↔ API corner */}
                      {toggles.gt && toggles.api && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '3px',
                            left: `calc(${widths.gt}% - 3px)`,
                            width: '6px',
                            height: '6px',
                            cursor: 'nwse-resize',
                            zIndex: 20,
                            backgroundColor: isDarkMode ? '#6b7280' : '#9ca3af',
                            borderRadius: '0 0 3px 0',
                            borderTop: `1px solid ${isDarkMode ? '#4b5563' : '#d1d5db'}`,
                            borderLeft: `1px solid ${isDarkMode ? '#4b5563' : '#d1d5db'}`,
                          }}
                          onMouseDown={e => {
                            e.preventDefault(); e.stopPropagation();
                            const startX = e.clientX;
                            const startY = e.clientY;
                            const startWidths = getPanelWidths(doc.filename);
                            const startHeight = getPanelHeight(doc.filename);
                            startCornerResize(doc.filename, 'gt-api', startX, startY, startWidths, startHeight);
                          }}
                        />
                      )}

                      {/* API ↔ PDF corner */}
                      {toggles.api && toggles.pdf && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '3px',
                            left: `calc(${widths.gt + widths.api}% - 3px)`,
                            width: '6px',
                            height: '6px',
                            cursor: 'nwse-resize',
                            zIndex: 20,
                            backgroundColor: isDarkMode ? '#6b7280' : '#9ca3af',
                            borderRadius: '0 0 3px 0',
                            borderTop: `1px solid ${isDarkMode ? '#4b5563' : '#d1d5db'}`,
                            borderLeft: `1px solid ${isDarkMode ? '#4b5563' : '#d1d5db'}`,
                          }}
                          onMouseDown={e => {
                            e.preventDefault(); e.stopPropagation();
                            const startX = e.clientX;
                            const startY = e.clientY;
                            const startWidths = getPanelWidths(doc.filename);
                            const startHeight = getPanelHeight(doc.filename);
                            startCornerResize(doc.filename, 'api-pdf', startX, startY, startWidths, startHeight);
                          }}
                        />
                      )}

                      {/* Vertical Resize Handle - Bottom of container */}
                      <div
                        style={{
                          height: '6px',
                          backgroundColor: isDarkMode ? '#4b5563' : '#d1d5db',
                          cursor: 'ns-resize',
                          position: 'relative',
                          zIndex: 10,
                          borderRadius: '0 0 8px 8px'
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const startY = e.clientY;
                          const startHeight = containerHeight;

                          let isDragging = false;

                          const handleMouseMove = (moveEvent: MouseEvent) => {
                            // Only update if we're actually dragging
                            if (!isDragging) return;

                            const deltaY = moveEvent.clientY - startY;
                            const newHeight = startHeight + deltaY;
                            handleVerticalResize(doc.filename, newHeight);
                          };

                          const cleanup = () => {
                            isDragging = false;
                            document.removeEventListener('mousemove', handleMouseMove);
                            document.removeEventListener('mouseup', handleMouseUp);
                            document.removeEventListener('mouseleave', handleMouseUp);
                            window.removeEventListener('blur', handleMouseUp);
                          };

                          const handleMouseUp = () => {
                            cleanup();
                          };

                          // Set dragging flag to true when we start
                          isDragging = true;

                          document.addEventListener('mousemove', handleMouseMove);
                          document.addEventListener('mouseup', handleMouseUp);
                          document.addEventListener('mouseleave', handleMouseUp);
                          window.addEventListener('blur', handleMouseUp);
                        }}
                      />
                    </div>

                    {/* Issues Found - moved to bottom of card */}
                    {currentIterationMismatches && currentIterationMismatches.length > 0 && (
                      <div style={{
                        marginTop: '1.5rem',
                        backgroundColor: isDarkMode ? '#1f2937' : '#f8f9fa',
                        borderRadius: '0 0 8px 8px'
                      }}>
                        {/* Issues Header with resize handle */}
                        <div style={{
                          padding: '0rem 1rem 0.25rem 1rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: `1px solid ${isDarkMode ? '#374151' : '#e9ecef'}`
                        }}>
                          <h5 style={{ margin: '0', color: isDarkMode ? '#f87171' : '#dc3545', fontSize: '0.9rem', fontWeight: '600' }}>
                            Issues Found ({currentIterationMismatches.length})
                          </h5>
                          <div style={{
                            fontSize: '0.7rem',
                            color: isDarkMode ? '#9ca3af' : '#6c757d',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}>
                          </div>
                        </div>

                        {/* Resizable issues container */}
                        <div style={{
                          padding: '0',
                          position: 'relative'
                        }}>
                          <div className="custom-scrollbar" style={{
                            height: `${getIssuesHeight(doc.filename)}px`,
                            overflow: 'auto',
                            scrollbarWidth: 'thin',
                            scrollbarColor: isDarkMode ? '#6b7280 #1f2937' : '#cbd5e1 #f8f9fa',
                            backgroundColor: isDarkMode ? '#111827' : '#ffffff'
                          }}>
                            {currentIterationMismatches.map((mismatch, index) => {
                              // Detect issue type based on mismatch content
                              const fpMatch = mismatch.match(/\[FP\]/i);
                              const fnMatch = mismatch.match(/\[FN\]/i);
                              const partialMatch = mismatch.match(/\[PARTIAL\]/i);

                              let issueType = 'Other';
                              let bgColor = isDarkMode ? '#374151' : '#f8f9fa';
                              let textColor = isDarkMode ? '#ffffff' : '#000000';
                              let borderColor = '#e5e7eb';
                              let icon = '⚠️';

                              if (fpMatch || partialMatch) {
                                issueType = 'False Positive';
                                bgColor = isDarkMode ? '#7f1d1d' : '#fef2f2';
                                textColor = isDarkMode ? '#fecaca' : '#991b1b';
                                borderColor = '#dc2626';
                                icon = '❌';
                              } else if (fnMatch) {
                                issueType = 'False Negative';
                                bgColor = isDarkMode ? '#78350f' : '#fffbeb';
                                textColor = isDarkMode ? '#fcd34d' : '#92400e';
                                borderColor = '#f59e0b';
                                icon = '❗';
                              }

                              return (
                                <div key={index} style={{
                                  padding: '0.25rem 0.5rem',
                                  borderBottom: index < currentIterationMismatches.length - 1 ? `1px solid ${isDarkMode ? '#374151' : '#f1f5f9'}` : 'none',
                                  fontSize: '0.75rem',
                                  backgroundColor: bgColor,
                                  color: textColor,
                                  borderLeft: `3px solid ${borderColor}`,
                                  marginBottom: '0',
                                  fontFamily: 'monospace'
                                }}>
                                  {mismatch}
                                </div>
                              );
                            })}
                          </div>

                          {/* Drag handle for resizing issues */}
                          <div style={{
                            height: '6px',
                            backgroundColor: isDarkMode ? '#4b5563' : '#d1d5db',
                            cursor: 'ns-resize',
                            position: 'relative',
                            marginTop: '4px',
                            borderRadius: '0 0 4px 4px'
                          }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const startY = e.clientY;
                              const startHeight = getIssuesHeight(doc.filename);

                              let isDragging = false;

                              const handleMouseMove = (moveEvent: MouseEvent) => {
                                if (!isDragging) return;

                                const deltaY = moveEvent.clientY - startY;
                                const newHeight = startHeight + deltaY;
                                handleIssuesResize(doc.filename, newHeight);
                              };

                              const cleanup = () => {
                                isDragging = false;
                                document.removeEventListener('mousemove', handleMouseMove);
                                document.removeEventListener('mouseup', handleMouseUp);
                                document.removeEventListener('mouseleave', handleMouseUp);
                                window.removeEventListener('blur', handleMouseUp);
                              };

                              const handleMouseUp = () => {
                                cleanup();
                              };

                              isDragging = true;

                              document.addEventListener('mousemove', handleMouseMove);
                              document.addEventListener('mouseup', handleMouseUp);
                              document.addEventListener('mouseleave', handleMouseUp);
                              window.addEventListener('blur', handleMouseUp);
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default DocumentResultsViewer; 