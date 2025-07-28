import React from 'react';
import SectionHeader from '../../common/SectionHeader';

interface ExtractionTypeSelectorProps {
  extractionTypes: string[];
  setExtractionTypes: (v: string[]) => void;
  isDarkMode: boolean;
}

const ExtractionTypeSelector: React.FC<ExtractionTypeSelectorProps> = ({
  extractionTypes,
  setExtractionTypes,
  isDarkMode,
}) => {
  const toggleExtractionType = (key: string, checked: boolean) => {
    if (checked) setExtractionTypes([...extractionTypes, key]);
    else setExtractionTypes(extractionTypes.filter((t) => t !== key));
  };

  return (
    <div>
      <SectionHeader isDarkMode={isDarkMode}>
        Extraction Types
      </SectionHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
        {[
          { key: 'patient_profile', label: 'Patient Profile' },
          { key: 'icd10_codes', label: 'ICD-10 Codes' },
          { key: 'medications', label: 'Medications' },
          { key: 'allergy', label: 'Allergies' },
        ].map((o) => (
          <label key={o.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
            <input
              type="checkbox"
              checked={extractionTypes.includes(o.key)}
              onChange={(e) => toggleExtractionType(o.key, e.target.checked)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
};

export default ExtractionTypeSelector; 