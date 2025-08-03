export const getPdfUrl = (hash: string, originalName: string, sourceDataPath: string): string => {
  const ext = originalName.split('.').pop() || 'pdf';
  const key = hash.endsWith(`.${ext}`) ? hash : `${hash}.${ext}`;
  const fullPath = `${sourceDataPath.replace(/\/$/, '')}/${encodeURIComponent(key)}`;
  if (fullPath.startsWith('s3://')) {
    return `http://localhost:8000/proxy-pdf?uri=${encodeURIComponent(fullPath)}`;
  }
  return fullPath;
}; 