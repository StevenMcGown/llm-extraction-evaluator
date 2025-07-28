import React, { createContext, useContext, useState, useEffect } from 'react';

export interface Settings {
  groundTruthPath: string;
  sourceDataPath: string;
  responsesPath: string;
  extractionEndpoint: string;
  oauthToken: string;
}

const defaultSettings: Settings = {
  groundTruthPath: '',
  sourceDataPath: '',
  responsesPath: '',
  extractionEndpoint: '',
  oauthToken: '',
};

interface SettingsContextValue {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(() => {
    const stored = localStorage.getItem('appSettings');
    return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
  });

  useEffect(() => {
    localStorage.setItem('appSettings', JSON.stringify(settings));
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, setSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}; 