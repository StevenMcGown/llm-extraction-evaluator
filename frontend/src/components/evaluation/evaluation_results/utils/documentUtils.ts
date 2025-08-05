// Helper to get extracted_data from API response
export const getExtractedData = (apiResponse: any) => 
  apiResponse && apiResponse.extracted_data ? apiResponse.extracted_data : {};

// Helper to filter ground truth by extraction types
export const filterGroundTruthByTypes = (groundTruth: any, extractionTypes: string[]) => {
  if (!groundTruth || !extractionTypes) return {};
  const filtered: any = {};
  for (const key of extractionTypes) {
    if (groundTruth.hasOwnProperty(key)) {
      filtered[key] = groundTruth[key];
    }
  }
  return filtered;
};

// Check if a field path is excluded
export const isFieldExcluded = (fieldPath: string, excludedFields?: string[]): boolean => {
  if (!excludedFields || excludedFields.length === 0) return false;

  // Convert dot notation path to JSON pointer format for comparison
  const jsonPointer = '/' + fieldPath.replace(/\./g, '/').replace(/\[(\d+)\]/g, '/$1');

  const isExcluded = excludedFields.some(excludedPath => {
    // Exact match
    if (jsonPointer === excludedPath) {
      return true;
    }

    // Child of excluded path
    if (jsonPointer.startsWith(excludedPath + '/')) {
      return true;
    }

    // Wildcard pattern matching:
    // `/medications/medications/frequency` should match `/medications/medications/0/frequency`
    // Strategy: Remove array indices from both paths and compare
    const normalizeForWildcard = (path: string) => path.replace(/\/\d+/g, '');

    const normalizedField = normalizeForWildcard(jsonPointer);
    const normalizedExcluded = normalizeForWildcard(excludedPath);

    if (normalizedField === normalizedExcluded) {
      return true;
    }

    // Also check if the excluded path is a pattern that matches this specific field
    // e.g., excluded=/medications/medications/frequency should match field=/medications/medications/0/frequency
    if (!excludedPath.includes('/0/') && !excludedPath.includes('/1/') && !excludedPath.includes('/2/')) {
      // This looks like a wildcard pattern, try to match it against the specific field
      const regex = new RegExp('^' + excludedPath.replace(/\//g, '\\/') + '$');
      const fieldWithWildcard = jsonPointer.replace(/\/\d+/g, '');

      if (regex.test(fieldWithWildcard)) {
        return true;
      }
    }

    return false;
  });

  return isExcluded;
};

// Copy text to clipboard
export const copyToClipboard = async (text: string, type: string) => {
  try {
    await navigator.clipboard.writeText(text);
    console.log(`${type} copied to clipboard`);
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
}; 

// Calculate score as (non-null fields) / (total FN + FP across all iterations)
export const calculateDocumentScore = (doc: any): number => {
  if (!doc.apiResponses || doc.apiResponses.length === 0) return 0;
  
  // Count non-null fields in the API response
  const countNonNullFields = (obj: any): number => {
    if (!obj || typeof obj !== 'object') return 0;
    
    let count = 0;
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined) {
        if (typeof value === 'object' && !Array.isArray(value)) {
          count += countNonNullFields(value);
        } else if (Array.isArray(value)) {
          value.forEach(item => {
            count += countNonNullFields(item);
          });
        } else {
          count += 1;
        }
      }
    }
    return count;
  };
  
  // Get total non-null fields from the best API response (usually the last one)
  const bestResponse = doc.apiResponses[doc.apiResponses.length - 1];
  const extractedData = bestResponse?.extracted_data || {};
  const totalNonNullFields = countNonNullFields(extractedData);
  
  // Count total FN + FP across all iterations
  let totalFnFp = 0;
  
  if (doc.iteration_mismatches) {
    // Count mismatches across all iterations
    doc.iteration_mismatches.forEach((iterationMismatches: string[]) => {
      iterationMismatches.forEach((mismatch: string) => {
        if (mismatch.includes('[FN]') || mismatch.includes('[FP]')) {
          totalFnFp += 1;
        }
      });
    });
  } else if (doc.mismatches) {
    // Fallback to single iteration mismatches
    doc.mismatches.forEach((mismatch: string) => {
      if (mismatch.includes('[FN]') || mismatch.includes('[FP]')) {
        totalFnFp += 1;
      }
    });
  }
  
  // Calculate score: non-null fields / (non-null fields + total errors)
  if (totalNonNullFields === 0 && totalFnFp === 0) return 1; // Perfect case
  if (totalNonNullFields === 0) return 0; // No extracted fields
  
  return totalNonNullFields / (totalNonNullFields + totalFnFp);
}; 