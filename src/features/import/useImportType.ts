import { useCallback, useState } from 'react';
import { IMPORT_TYPES, type ImportType } from '@/domain';

/** localStorage key of the last import type chosen on this device (FEAT-3). */
export const IMPORT_TYPE_STORAGE_KEY = 'trip-planner.import-type';

/** FEAT-2 behaviour (name, duration, tag) until the user picks another type. */
export const DEFAULT_IMPORT_TYPE: ImportType = 'tags';

function isImportType(value: unknown): value is ImportType {
  return IMPORT_TYPES.some((type) => type === value);
}

/** The stored type, or the default when storage is blocked (private modes) or holds junk. */
export function readImportType(): ImportType {
  try {
    const stored = window.localStorage.getItem(IMPORT_TYPE_STORAGE_KEY);
    return isImportType(stored) ? stored : DEFAULT_IMPORT_TYPE;
  } catch {
    return DEFAULT_IMPORT_TYPE;
  }
}

function writeImportType(type: ImportType): void {
  try {
    window.localStorage.setItem(IMPORT_TYPE_STORAGE_KEY, type);
  } catch {
    // Only a convenience: without storage the choice lasts until the dialog closes.
  }
}

/**
 * The import type chosen in the dialog, remembered per device (FEAT-3). Not personal data and not
 * per user: it only picks the AI prompt and the format hints.
 */
export function useImportType(): [ImportType, (type: ImportType) => void] {
  const [type, setType] = useState<ImportType>(readImportType);
  const choose = useCallback((next: ImportType) => {
    setType(next);
    writeImportType(next);
  }, []);
  return [type, choose];
}
