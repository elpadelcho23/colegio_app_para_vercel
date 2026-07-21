import type { GradeMappingField } from './excel-column-map';

export interface GradeExcelMapping {
  headerRow: number;
  columns: Partial<Record<GradeMappingField, number | null>>;
}

export const GRADE_MAPPABLE_FIELDS: Array<{
  field: GradeMappingField;
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
  { field: 'dni', label: 'DNI', required: false, hint: 'Opcional: mejora el match del alumno' },
  { field: 'evaluacion', label: 'Evaluación', required: true },
  { field: 'calificacion', label: 'Calificación', required: true, hint: '1–10 o texto (S/C…)' },
  { field: 'importancia', label: 'Importancia / peso', required: false },
  { field: 'entrega', label: 'Fecha de entrega', required: false },
  { field: 'motivo', label: 'Motivo', required: false },
  { field: 'tipo', label: 'Tipo', required: false },
  { field: 'periodo', label: 'Período', required: false },
];

const FIELD_LABELS: Record<GradeMappingField, string> = {
  fecha: 'Fecha',
  escuela: 'Escuela',
  curso: 'Curso',
  turno: 'Turno',
  materia: 'Materia',
  nombre: 'Alumno',
  dni: 'DNI',
  evaluacion: 'Evaluación',
  calificacion: 'Calificación',
  importancia: 'Importancia',
  entrega: 'Entrega',
  motivo: 'Motivo',
  tipo: 'Tipo',
  periodo: 'Período',
};

export function gradeFieldLabel(field: GradeMappingField) {
  return FIELD_LABELS[field];
}

export function parseGradeExcelMapping(raw: unknown): GradeExcelMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const headerRow = Number(value.headerRow);
  if (!Number.isFinite(headerRow) || headerRow < 1) return null;

  const columns: Partial<Record<GradeMappingField, number | null>> = {};
  const source = value.columns;
  if (!source || typeof source !== 'object') return null;

  for (const [field, index] of Object.entries(source as Record<string, unknown>)) {
    if (!(field in FIELD_LABELS)) continue;
    if (index === null || index === '' || index === undefined) {
      columns[field as GradeMappingField] = null;
      continue;
    }
    const parsed = Number(index);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    columns[field as GradeMappingField] = parsed;
  }

  return { headerRow: Math.floor(headerRow), columns };
}

export function parseGradeExcelMappingJson(text: string | null | undefined): GradeExcelMapping | null {
  if (!text || typeof text !== 'string') return null;
  try {
    return parseGradeExcelMapping(JSON.parse(text));
  } catch {
    return null;
  }
}

export function validateGradeExcelMapping(mapping: GradeExcelMapping | null): string[] {
  if (!mapping) return ['Configurá el mapeo de columnas antes de importar.'];

  const errors: string[] = [];
  for (const field of ['fecha', 'escuela', 'curso', 'turno', 'materia', 'nombre', 'evaluacion', 'calificacion'] as const) {
    if (mapping.columns[field] == null) {
      errors.push(`Asigná la columna de ${FIELD_LABELS[field]}.`);
    }
  }
  return errors;
}

export function gradeMappingToColumnMap(mapping: GradeExcelMapping) {
  const columnMap: Partial<Record<GradeMappingField, number>> = {};
  for (const [field, index] of Object.entries(mapping.columns)) {
    if (index == null) continue;
    columnMap[field as GradeMappingField] = index;
  }
  return columnMap;
}

export function gradeColumnMapToMapping(
  headerRow: number,
  columnMap: Partial<Record<GradeMappingField, number>>,
): GradeExcelMapping {
  const columns: Partial<Record<GradeMappingField, number | null>> = {};
  for (const { field } of GRADE_MAPPABLE_FIELDS) {
    columns[field] = columnMap[field] ?? null;
  }
  return { headerRow, columns };
}

export function serializeGradeMappingForClient(mapping: GradeExcelMapping) {
  return {
    headerRow: mapping.headerRow,
    columns: Object.fromEntries(
      GRADE_MAPPABLE_FIELDS.map(({ field }) => [field, mapping.columns[field] ?? null]),
    ),
  };
}
