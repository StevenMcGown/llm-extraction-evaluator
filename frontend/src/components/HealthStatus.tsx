import React from 'react';
import { useEffect, useState } from 'react';
import { getHealth } from '../services/api';

function HealthStatus() {
  const [status, setStatus] = useState<string>('loading');

  useEffect(() => {
    getHealth()
      .then((resp) => setStatus(resp.data.status))
      .catch(() => setStatus('error'));
  }, []);

  return <p>{status}</p>;
}

export default HealthStatus; 