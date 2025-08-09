import { useMemo } from 'react';

export type HighlightType = 'FP' | 'FN';

export interface ValueBasedHighlight {
  type: HighlightType;
  basePathRe: RegExp;
  bracketValue: string; // semantic key and optional expected value
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
    const typeMatch = m.match(/\[(FP|FN)\]/i);
    const pathMatch = m.match(/\[(FP|FN)\]\s+([^:]+):/);
    if (!typeMatch || !pathMatch) return;
    const type = typeMatch[1].toUpperCase() as HighlightType;
    const rawPath = pathMatch[2].trim();

    // 1) General semantic-key format: base[semantic|key|parts].field[optionalValue]
    const general = rawPath.match(/^(.+)\[(.+)\]\.([^.\[]+)(?:\[([^\]]+)\])?$/);
    if (general) {
      const basePath = general[1];     // e.g., medications.medications
      const fieldName = general[3];    // e.g., med_sig
      const regexStr = `^${escapeForRegex(basePath)}\\[\\d+\\]\\.${escapeForRegex(fieldName)}$`;
      try {
        valueBased.push({
          type,
          basePathRe: new RegExp(regexStr),
          bracketValue: general[4] ? `${general[2]}|${general[4]}` : general[2],
        });
      } catch {}
      return;
    }

    // 2) Legacy compound format: base[|X|].field[Y]
    const compound = rawPath.match(/^(.+)\[\|([^\|]+)\|\]\.([^.\[]+)\[([^\]]+)\]$/);
    if (compound) {
      const basePath = compound[1];
      const x = compound[2];
      const fieldName = compound[3];
      const y = compound[4];
      const regexStr = `^${escapeForRegex(basePath)}\\[\\d+\\]\\.${escapeForRegex(fieldName)}$`;
      try {
        valueBased.push({ type, basePathRe: new RegExp(regexStr), bracketValue: `${x}|${y}` });
      } catch {}
      return;
    }

    // 3) Legacy pipe-only: base[|X|].field
    const pipeOnly = rawPath.match(/^(.+)\[\|([^\|]+)\|\]\.([^.]+)$/);
    if (pipeOnly) {
      const basePath = pipeOnly[1];
      const x = pipeOnly[2];
      const fieldName = pipeOnly[3];
      const regexStr = `^${escapeForRegex(basePath)}\\[\\d+\\]\\.${escapeForRegex(fieldName)}$`;
      try {
        valueBased.push({ type, basePathRe: new RegExp(regexStr), bracketValue: x });
      } catch {}
      return;
    }

    // 4) Original bracket-at-end format: some.path[fieldValue]
    const bracketEnd = rawPath.match(/([^\.\[\]]+)\[([^\]]+)\]$/);
    if (bracketEnd) {
      const bracketValue = bracketEnd[2];
      const baseField = rawPath.replace(/\[([^\]]+)\]$/, '');
      const sentinel = '__ARRAY_IDX__';
      const withSentinel = baseField.replace('[||]', sentinel);
      const regexStr = '^' + escapeForRegex(withSentinel).replace(sentinel, '\\[\\d+\\]') + '$';
      try {
        valueBased.push({ type, basePathRe: new RegExp(regexStr), bracketValue });
      } catch {}
      return;
    }

    // 5) Exact path mismatches (no bracket semantics) — map exactly as-is
    // We avoid broad fallbacks to prevent over-highlighting.
    pathMap[rawPath] = type;
  });

  return { pathMap, valueBased };
};

export const useMismatchInfo = (mismatches: string[]): MismatchInfo => {
  return useMemo(() => buildMismatchInfo(mismatches), [mismatches]);
}; 