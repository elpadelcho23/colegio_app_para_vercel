export const EXCEL_IMPORT_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  allowedExtensions: ['.xlsx', '.xls'],
} as const;

export type ExcelImportType = 'cursos' | 'alumnos' | 'asistencias' | 'notas';

export function isAllowedExcelImportFile(file: File): { ok: true } | { ok: false; error: string } {
  const name = file.name.toLowerCase();
  const hasAllowedExtension = EXCEL_IMPORT_LIMITS.allowedExtensions.some((ext) => name.endsWith(ext));
  if (!hasAllowedExtension) {
    return { ok: false, error: 'El archivo debe ser Excel (.xlsx o .xls).' };
  }
  if (file.size > EXCEL_IMPORT_LIMITS.maxFileBytes) {
    return { ok: false, error: 'El archivo supera el tamaño máximo de 5 MB.' };
  }
  if (file.size === 0) {
    return { ok: false, error: 'El archivo está vacío.' };
  }
  return { ok: true };
}

export function parseImportType(value: FormDataEntryValue | null): ExcelImportType | null {
  const type = String(value || '').trim();
  if (type === 'cursos' || type === 'alumnos' || type === 'asistencias' || type === 'notas') return type;
  return null;
}
