import React, { useState } from 'react';
import { uploadFile } from '../../../services/api';
import { useSettings } from '../../../context/SettingsContext';

const FileUploader: React.FC = () => {
  const [status, setStatus] = useState<string>('');
  const { settings } = useSettings();

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    let success = 0;
    let skipped = 0;
    let failed = 0;
    setStatus(`Uploading ${fileList.length} file(s)…`);
    for (const file of Array.from(fileList)) {
      try {
        const resp = await uploadFile(file, settings.sourceDataPath);
        if (resp.data.is_duplicate) {
          skipped += 1;
        } else {
          success += 1;
        }
      } catch (err) {
        console.error('Upload failed', err);
        failed += 1;
      }
    }
    setStatus(`Uploaded ${success}, Skipped ${skipped}, Failed ${failed}`);
    // Reset input value so same file can be uploaded again if needed
    e.target.value = '';
  };

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'inline-block', padding: '0.5rem 1rem', background: '#1976d2', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>
        Upload File(s)
        <input type="file" style={{ display: 'none' }} onChange={handleChange} multiple />
      </label>
      {status && <span style={{ marginLeft: '1rem' }}>{status}</span>}
    </div>
  );
};

export default FileUploader; 