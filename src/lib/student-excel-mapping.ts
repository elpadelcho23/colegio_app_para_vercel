import type { StudentMappingField } from './excel-column-map';

export interface StudentExcelMapping {
  headerRow: number;
  columns: Partial<Record<StudentMappingField, number | null>>;
}

export interface StudentExcelMappingTemplate extends StudentExcelMapping {
  id: string;
  name: string;
  columnLabels: string[];
  updatedAt: string;
}

export const STUDENT_MAPPABLE_FIELDS: Array<{
  field: StudentMappingField;
  label: string;
  required: boolean;
  hint?: string;
}> = [
  { field: 'escuela', label: 'Escuela', required: true },
  { field: 'curso', label: 'Curso', required: true },
  { field: 'turno', label: 'Turno', required: true },
  { field: 'apellido', label: 'Apellido', required: false, hint: 'Opcional si ya tenés Nombre completo' },
  { field: 'nombre', label: 'Nombre', required: false, hint: 'Obligatorio si no usás Apellido' },
  { field: 'dni', label: 'DNI', required: false },
  { field: 'tutor', label: 'Tutor / contacto', required: false },
  { field: 'materias', label: 'Materias', required: false },
];

const FIELD_LABELS: Record<StudentMappingField, string> = {
  escuela: 'Escuela',
  curso: 'Curso',
  turno: 'Turno',
  nombre: 'Nombre',
  apellido: 'Apellido',
  dni: 'DNI',
  tutor: 'Tutor',
  materias: 'Materias',
};

export function studentFieldLabel(field: StudentMappingField) {
  return FIELD_LABELS[field];
}

export function parseStudentExcelMapping(raw: unknown): StudentExcelMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const headerRow = Number(value.headerRow);
  if (!Number.isFinite(headerRow) || headerRow < 1) return null;

  const columns: Partial<Record<StudentMappingField, number | null>> = {};
  const source = value.columns;
  if (!source || typeof source !== 'object') return null;

  for (const [field, index] of Object.entries(source as Record<string, unknown>)) {
    if (!(field in FIELD_LABELS)) continue;
    if (index === null || index === '' || index === undefined) {
      columns[field as StudentMappingField] = null;
      continue;
    }
    const parsed = Number(index);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    columns[field as StudentMappingField] = parsed;
  }

  return { headerRow: Math.floor(headerRow), columns };
}

export function parseStudentExcelMappingJson(text: string | null | undefined): StudentExcelMapping | null {
  if (!text || typeof text !== 'string') return null;
  try {
    return parseStudentExcelMapping(JSON.parse(text));
  } catch {
    return null;
  }
}

export function validateStudentExcelMapping(mapping: StudentExcelMapping | null): string[] {
  if (!mapping) return ['Configurá el mapeo de columnas antes de importar.'];

  const errors: string[] = [];
  const { columns } = mapping;

  for (const field of ['escuela', 'curso', 'turno'] as const) {
    if (columns[field] == null) {
      errors.push(`Asigná la columna de ${FIELD_LABELS[field]}.`);
    }
  }

  if (columns.nombre == null && columns.apellido == null) {
    errors.push('Asigná al menos Nombre o Apellido.');
  }

  return errors;
}

export function mappingToColumnMap(mapping: StudentExcelMapping) {
  const columnMap: Partial<Record<StudentMappingField, number>> = {};
  for (const [field, index] of Object.entries(mapping.columns)) {
    if (index == null) continue;
    columnMap[field as StudentMappingField] = index;
  }
  return columnMap;
}

export function columnMapToMapping(headerRow: number, columnMap: Partial<Record<StudentMappingField, number>>): StudentExcelMapping {
  const columns: Partial<Record<StudentMappingField, number | null>> = {};
  for (const { field } of STUDENT_MAPPABLE_FIELDS) {
    columns[field] = columnMap[field] ?? null;
  }
  return { headerRow, columns };
}

export function serializeMappingForClient(mapping: StudentExcelMapping) {
  return {
    headerRow: mapping.headerRow,
    columns: Object.fromEntries(
      STUDENT_MAPPABLE_FIELDS.map(({ field }) => [field, mapping.columns[field] ?? null]),
    ),
  };
}
