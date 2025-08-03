export const getValueAtPath = (obj: any, path: string): any => {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (part.includes('[') && part.includes(']')) {
      const [key, indexStr] = part.split('[');
      const index = parseInt(indexStr.replace(']', ''));
      current = current?.[key]?.[index];
    } else {
      current = current?.[part];
    }
    if (current === undefined) return undefined;
  }
  return current;
};

export const resolveScore = (path: string, scores: Record<string, number>): number | undefined => {
  if (scores[path] !== undefined) return scores[path];
  const noIndices = path.replace(/\[\d+\]/g, '');
  return scores[noIndices];
};

export const getScoreColor = (score: number): string => {
  if (score === 1.0) return '#28a745';
  if (score >= 0.7) return '#fd7e14';
  if (score >= 0.5) return '#ffc107';
  return '#dc3545';
}; 