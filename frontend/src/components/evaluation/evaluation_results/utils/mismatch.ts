import { useMemo } from 'react';

export type HighlightType = 'FP' | 'FN';

export interface ValueBasedHighlight {
  type: HighlightType;
  basePathRe: RegExp;
  bracketValue: string;
}

export interface MismatchInfo {
  pathMap: Record<string, HighlightType>;
  valueBased: ValueBasedHighlight[];
}

const escapeForRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildMismatchInfo = (mismatches: string[]): MismatchInfo => {
  const pathMap: Record<string, HighlightType> = {};
  const valueBased: ValueBasedHighlight[] = [];

  mismatches.forEach((m) => {
    console.log('🔍 Processing mismatch:', m);
    const typeMatch = m.match(/\[(FP|FN)\]/i);
    const pathMatch = m.match(/\[(FP|FN)\]\s+([^:]+):/);
    if (!typeMatch || !pathMatch) return;
    const type = typeMatch[1].toUpperCase() as HighlightType;
    const rawPath = pathMatch[2].trim();
    console.log('  rawPath:', rawPath);

    // Handle compound format: medications.medications[|500mg|].med_sig[Daily]
    const compoundMatch = rawPath.match(/^(.+)\[\|([^\|]+)\|\]\.([^.\[]+)\[([^\]]+)\]$/);
    if (compoundMatch) {
      const basePath = compoundMatch[1];
      const dosageValue = compoundMatch[2];
      const fieldName = compoundMatch[3];
      const actualValue = compoundMatch[4];
      
      const regexStr = `^${escapeForRegex(basePath)}\\[\\d+\\]\\.${escapeForRegex(fieldName)}$`;
      
      try {
        valueBased.push({
          type,
          basePathRe: new RegExp(regexStr),
          bracketValue: `${dosageValue}|${actualValue}`,
        });
        console.log('✅ Compound entry:', { type, regexStr, dosage: dosageValue, value: actualValue });
      } catch {
        /* ignore invalid */
      }
      return;
    }

    // Handle pipe-only format: medications.medications[|750mg|].med_sig
    const pipeBracketMatch = rawPath.match(/^(.+)\[\|([^\|]+)\|\]\.([^.]+)$/);
    if (pipeBracketMatch) {
      const basePath = pipeBracketMatch[1];
      const dosageValue = pipeBracketMatch[2];
      const fieldName = pipeBracketMatch[3];
      
      const regexStr = `^${escapeForRegex(basePath)}\\[\\d+\\]\\.${escapeForRegex(fieldName)}$`;
      
      try {
        valueBased.push({
          type,
          basePathRe: new RegExp(regexStr),
          bracketValue: dosageValue,
        });
        console.log('✅ Pipe-bracket entry:', { type, regexStr, bracketValue: dosageValue });
      } catch {
        /* ignore invalid */
      }
      return;
    }

    // Handle original format: medications.medications[||].med_name[cefpodoxime]
    const bracketMatch = rawPath.match(/([^\.\[\]]+)\[([^\]]+)\]$/);
    if (bracketMatch) {
      const bracketValue = bracketMatch[2];
      const baseField = rawPath.replace(/\[([^\]]+)\]$/, '');
      const sentinel = '__ARRAY_IDX__';
      const withSentinel = baseField.replace('[||]', sentinel);
      const regexStr = '^' + escapeForRegex(withSentinel).replace(sentinel, '\\[\\d+\\]') + '$';
      try {
        valueBased.push({
          type,
          basePathRe: new RegExp(regexStr),
          bracketValue,
        });
        console.log('✅ Standard bracket entry:', { type, regexStr, bracketValue });
      } catch {
        /* ignore invalid */
      }
    } else {
      // Generic path-level mismatch
      const strippedAll = rawPath.replace(/\[[^\]]+\]/g, '');
      if (!pathMap[strippedAll]) pathMap[strippedAll] = type;
      const withoutNonNumeric = rawPath.replace(/\[[^\d\]]+\]/g, '');
      if (!pathMap[withoutNonNumeric]) pathMap[withoutNonNumeric] = type;
      console.log('✅ Path-level entry:', { strippedAll, withoutNonNumeric, type });
    }
  });

  return { pathMap, valueBased };
};

// Optional React hook helper
export const useMismatchInfo = (mismatches: string[]): MismatchInfo => {
  return useMemo(() => buildMismatchInfo(mismatches), [mismatches]);
}; 