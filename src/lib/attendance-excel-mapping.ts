import type { AttendanceMappingField } from './excel-column-map';

export interface AttendanceExcelMapping {
  headerRow: number;
  columns: Partial<Record<AttendanceMappingField, number | null>>;
}

export interface AttendanceExcelMappingTemplate extends AttendanceExcelMapping {
  id: string;
  name: string;
  columnLabels: string[];
  updatedAt: string;
}

export const ATTENDANCE_MAPPABLE_FIELDS: Array<{
  field: AttendanceMappingField;
  label: string;
  required: boolean;
  hint?: string;
}> = [
  { field: 'fecha', label: 'Fecha', required: true, hint: 'AAAA-MM-DD o fecha de Excel' },
  { field: 'escuela', label: 'Escuela / Colegio', required: true },
  { field: 'curso', label: 'Curso', required: true },
  { field: 'turno', label: 'Turno', required: true },
  { field: 'materia', label: 'Materia', required: true },
  { field: 'nombre', label: 'Alumno', required: true },
  { field: 'estado', label: 'Estado', required: true, hint: 'Presente, Ausente, P o A' },
];

const FIELD_LABELS: Record<AttendanceMappingField, string> = {
  fecha: 'Fecha',
  escuela: 'Escuela',
  curso: 'Curso',
  turno: 'Turno',
  materia: 'Materia',
  nombre: 'Alumno',
  estado: 'Estado',
};

export function attendanceFieldLabel(field: AttendanceMappingField) {
  return FIELD_LABELS[field];
}

export function parseAttendanceExcelMapping(raw: unknown): AttendanceExcelMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const headerRow = Number(value.headerRow);
  if (!Number.isFinite(headerRow) || headerRow < 1) return null;

  const columns: Partial<Record<AttendanceMappingField, number | null>> = {};
  const source = value.columns;
  if (!source || typeof source !== 'object') return null;

  for (const [field, index] of Object.entries(source as Record<string, unknown>)) {
    if (!(field in FIELD_LABELS)) continue;
    if (index === null || index === '' || index === undefined) {
      columns[field as AttendanceMappingField] = null;
      continue;
    }
    const parsed = Number(index);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    columns[field as AttendanceMappingField] = parsed;
  }

  return { headerRow: Math.floor(headerRow), columns };
}

export function parseAttendanceExcelMappingJson(text: string | null | undefined): AttendanceExcelMapping | null {
  if (!text || typeof text !== 'string') return null;
  try {
    return parseAttendanceExcelMapping(JSON.parse(text));
  } catch {
    return null;
  }
}

export function validateAttendanceExcelMapping(mapping: AttendanceExcelMapping | null): string[] {
  if (!mapping) return ['Configurá el mapeo de columnas antes de importar.'];

  const errors: string[] = [];
  for (const field of ['fecha', 'escuela', 'curso', 'turno', 'materia', 'nombre', 'estado'] as const) {
    if (mapping.columns[field] == null) {
      errors.push(`Asigná la columna de ${FIELD_LABELS[field]}.`);
    }
  }
  return errors;
}

export function attendanceMappingToColumnMap(mapping: AttendanceExcelMapping) {
  const columnMap: Partial<Record<AttendanceMappingField, number>> = {};
  for (const [field, index] of Object.entries(mapping.columns)) {
    if (index == null) continue;
    columnMap[field as AttendanceMappingField] = index;
  }
  return columnMap;
}

export function attendanceColumnMapToMapping(
  headerRow: number,
  columnMap: Partial<Record<AttendanceMappingField, number>>,
): AttendanceExcelMapping {
  const columns: Partial<Record<AttendanceMappingField, number | null>> = {};
  for (const { field } of ATTENDANCE_MAPPABLE_FIELDS) {
    columns[field] = columnMap[field] ?? null;
  }
  return { headerRow, columns };
}

export function serializeAttendanceMappingForClient(mapping: AttendanceExcelMapping) {
  return {
    headerRow: mapping.headerRow,
    columns: Object.fromEntries(
      ATTENDANCE_MAPPABLE_FIELDS.map(({ field }) => [field, mapping.columns[field] ?? null]),
    ),
  };
}
