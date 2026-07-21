import type ExcelJS from 'exceljs';
import {
  buildColumnMapFromHeaders,
  buildAttendanceColumnMapFromHeaders,
  buildGradeColumnMapFromHeaders,
  mergeStudentNombre,
  missingStudentFields,
  normalizeAttendanceEstado,
  normalizeDniValue,
  normalizeTurnoValue,
  parseSpreadsheetDate,
  reinforceAttendanceMapWithSamples,
  reinforceGradeMapWithSamples,
  reinforceStudentMapWithSamples,
  scoreAttendanceHeaderRow,
  scoreGradeHeaderRow,
  scoreStudentHeaderRow,
  splitMateriasValue,
  type AttendanceMappingField,
  type GradeMappingField,
  type StudentField,
  type StudentMappingField,
} from '../lib/excel-column-map';
import {
  attendanceColumnMapToMapping,
  attendanceFieldLabel,
  attendanceMappingToColumnMap,
  type AttendanceExcelMapping,
  validateAttendanceExcelMapping,
} from '../lib/attendance-excel-mapping';
import {
  gradeColumnMapToMapping,
  gradeFieldLabel,
  gradeMappingToColumnMap,
  type GradeExcelMapping,
  validateGradeExcelMapping,
} from '../lib/grade-excel-mapping';
import {
  columnMapToMapping,
  mappingToColumnMap,
  studentFieldLabel,
  type StudentExcelMapping,
  validateStudentExcelMapping,
} from '../lib/student-excel-mapping';

export type ParsedCellValue = string | number | null;

export interface ParsedStudentRow {
  rowNumber: number;
  escuela: string;
  curso: string;
  turno: string | null;
  nombre: string;
  dni: string | null;
  tutor: string | null;
  materias: string[];
  errors: string[];
  warnings: string[];
}

export interface ParsedStudentSheet {
  sheetName: string;
  headerRow: number;
  columnMap: Partial<Record<StudentMappingField, number>>;
  detectedHeaders: string[];
  rows: ParsedStudentRow[];
  validRows: ParsedStudentRow[];
  invalidRows: ParsedStudentRow[];
  mappingErrors: string[];
  requiresMapping: boolean;
}

export interface ParseStudentWorksheetOptions {
  preferredSheetNames?: string[];
  mapping?: StudentExcelMapping | null;
}

export function cellText(value: ExcelJS.CellValue): ParsedCellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value && value.result != null) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value && value.text != null) return String(value.text).trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
  }
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  return text || null;
}

function readRowValues(worksheet: ExcelJS.Worksheet, rowNumber: number, maxColumns: number) {
  const values: ParsedCellValue[] = [];
  for (let column = 1; column <= maxColumns; column += 1) {
    values.push(cellText(worksheet.getRow(rowNumber).getCell(column).value));
  }
  while (values.length && (values[values.length - 1] === null || values[values.length - 1] === '')) {
    values.pop();
  }
  return values;
}

function detectHeaderRow(worksheet: ExcelJS.Worksheet, maxScanRows = 15) {
  const maxColumns = Math.max(worksheet.columnCount || 0, worksheet.actualColumnCount || 0, 12);
  let bestRow = 1;
  let bestScore = 0;
  let bestHeaders: string[] = [];
  let bestMap: Partial<Record<StudentMappingField, number>> = {};

  for (let rowNumber = 1; rowNumber <= Math.min(maxScanRows, worksheet.rowCount || maxScanRows); rowNumber += 1) {
    const values = readRowValues(worksheet, rowNumber, maxColumns);
    const headers = values.map((value) => String(value ?? '').trim());
    const score = scoreStudentHeaderRow(headers);
    if (score <= bestScore) continue;

    let columnMap = buildColumnMapFromHeaders(headers);
    const sampleRows: Array<Array<string | number | null>> = [];
    for (let offset = 1; offset <= 5; offset += 1) {
      const sample = readRowValues(worksheet, rowNumber + offset, maxColumns);
      if (sample.some((value) => value !== null && value !== '')) sampleRows.push(sample);
    }
    if (sampleRows.length) {
      columnMap = reinforceStudentMapWithSamples(headers, columnMap, sampleRows);
    }

    bestRow = rowNumber;
    bestScore = score;
    bestHeaders = headers;
    bestMap = columnMap;
  }

  return {
    headerRow: bestRow,
    columnMap: bestMap,
    detectedHeaders: bestHeaders,
    score: bestScore,
  };
}

function getMappedValue(
  values: ParsedCellValue[],
  columnMap: Partial<Record<StudentMappingField, number>>,
  field: StudentMappingField,
) {
  const index = columnMap[field];
  if (index == null) return null;
  return values[index] ?? null;
}

function columnLabel(
  columnMap: Partial<Record<StudentMappingField, number>>,
  field: StudentMappingField,
  detectedHeaders: string[],
) {
  const index = columnMap[field];
  if (index == null) return null;
  return detectedHeaders[index] || `columna ${index + 1}`;
}

function describeStudentFieldError(
  field: StudentField,
  columnMap: Partial<Record<StudentMappingField, number>>,
  detectedHeaders: string[],
  rowNumber: number,
) {
  const label = studentFieldLabel(field);
  const mappedColumn = columnLabel(columnMap, field, detectedHeaders);
  if (!mappedColumn) {
    return `Falta ${label}: no hay columna asignada en el mapeo (fila ${rowNumber}).`;
  }
  return `Falta ${label} en columna "${mappedColumn}" (fila ${rowNumber}).`;
}

function parseStudentDataRow(
  rowNumber: number,
  values: ParsedCellValue[],
  columnMap: Partial<Record<StudentMappingField, number>>,
  detectedHeaders: string[],
): ParsedStudentRow | null {
  const hasValue = values.some((value) => value !== null && value !== '');
  if (!hasValue) return null;

  const escuela = String(getMappedValue(values, columnMap, 'escuela') ?? '').trim();
  const curso = String(getMappedValue(values, columnMap, 'curso') ?? '').trim();
  const nombre = mergeStudentNombre(
    getMappedValue(values, columnMap, 'apellido'),
    getMappedValue(values, columnMap, 'nombre'),
  );
  const turnoRaw = getMappedValue(values, columnMap, 'turno');
  const turno = normalizeTurnoValue(turnoRaw);
  const dni = normalizeDniValue(getMappedValue(values, columnMap, 'dni'));
  const tutor = String(getMappedValue(values, columnMap, 'tutor') ?? '').trim() || null;
  const materias = splitMateriasValue(getMappedValue(values, columnMap, 'materias'));
  const errors: string[] = [];
  const warnings: string[] = [];

  const missing = missingStudentFields({ escuela, curso, turno, nombre });
  for (const field of missing) {
    errors.push(describeStudentFieldError(field, columnMap, detectedHeaders, rowNumber));
  }

  if (!turno && String(turnoRaw ?? '').trim()) {
    const mappedColumn = columnLabel(columnMap, 'turno', detectedHeaders);
    const columnHint = mappedColumn ? ` en columna "${mappedColumn}"` : '';
    errors.push(
      `Turno no reconocido${columnHint} (fila ${rowNumber}): "${String(turnoRaw).trim()}". Usá Mañana, Tarde o Noche.`,
    );
  }

  if (columnMap.dni == null && detectedHeaders.some((header) => /dni|documento|legajo/i.test(header))) {
    warnings.push('Hay una columna de documento en el Excel, pero no está asignada a DNI en el mapeo.');
  }

  if (columnMap.apellido != null && columnMap.nombre == null) {
    warnings.push(`Fila ${rowNumber}: se usa solo Apellido como nombre completo.`);
  }

  return {
    rowNumber,
    escuela,
    curso,
    turno,
    nombre,
    dni,
    tutor,
    materias,
    errors,
    warnings,
  };
}

function hasMinimumMapping(columnMap: Partial<Record<StudentMappingField, number>>) {
  const mapping = columnMapToMapping(1, columnMap);
  return validateStudentExcelMapping(mapping).length === 0;
}

export function parseStudentWorksheet(
  workbook: ExcelJS.Workbook,
  options: ParseStudentWorksheetOptions = {},
): ParsedStudentSheet | null {
  const preferredNames = options.preferredSheetNames || ['Alumnos', 'alumnos', 'Estudiantes', 'estudiantes'];
  const worksheet = pickStudentWorksheet(workbook, preferredNames);
  if (!worksheet) return null;

  const maxColumns = Math.max(worksheet.columnCount || 0, worksheet.actualColumnCount || 0, 12);
  const detection = detectHeaderRow(worksheet, 15);
  const headerRow = options.mapping?.headerRow || detection.headerRow;
  const detectedHeaders = readRowValues(worksheet, headerRow, maxColumns).map((value) => String(value ?? '').trim());
  const columnMap = options.mapping
    ? mappingToColumnMap(options.mapping)
    : detection.headerRow === headerRow
      ? detection.columnMap
      : buildColumnMapFromHeaders(detectedHeaders);

  const mapping = columnMapToMapping(headerRow, columnMap);
  const mappingErrors = validateStudentExcelMapping(mapping);
  const headerScore = scoreStudentHeaderRow(detectedHeaders);
  const requiresMapping = mappingErrors.length > 0 || headerScore < 40;

  if (!options.mapping && headerScore < 40) {
    return {
      sheetName: worksheet.name,
      headerRow,
      columnMap,
      detectedHeaders,
      rows: [],
      validRows: [],
      invalidRows: [],
      mappingErrors,
      requiresMapping: true,
    };
  }

  const rows: ParsedStudentRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= (worksheet.rowCount || 0); rowNumber += 1) {
    const values = readRowValues(worksheet, rowNumber, maxColumns);
    const parsed = parseStudentDataRow(rowNumber, values, columnMap, detectedHeaders);
    if (parsed) rows.push(parsed);
  }

  const validRows = rows.filter((row) => row.errors.length === 0 && row.turno);
  const invalidRows = rows.filter((row) => row.errors.length > 0 || !row.turno);

  return {
    sheetName: worksheet.name,
    headerRow,
    columnMap,
    detectedHeaders,
    rows,
    validRows,
    invalidRows,
    mappingErrors,
    requiresMapping: requiresMapping || (!hasMinimumMapping(columnMap) && validRows.length === 0),
  };
}

export function pickStudentWorksheet(workbook: ExcelJS.Workbook, preferredNames: string[] = ['Alumnos', 'alumnos', 'Estudiantes', 'estudiantes']) {
  for (const name of preferredNames) {
    const sheet = workbook.getWorksheet(name);
    if (sheet) return sheet;
  }

  let bestSheet = workbook.worksheets[0] || null;
  let bestScore = 0;
  for (const sheet of workbook.worksheets) {
    const detection = detectHeaderRow(sheet, 10);
    if (detection.score > bestScore) {
      bestScore = detection.score;
      bestSheet = sheet;
    }
  }
  return bestSheet;
}

export function buildStudentSheetError(parsed: ParsedStudentSheet | null) {
  if (!parsed) return 'El archivo no contiene hojas de cálculo.';
  if (parsed.mappingErrors.length && parsed.validRows.length === 0) {
    return `${parsed.mappingErrors[0]} Revisá el mapeo de columnas.`;
  }
  if (parsed.rows.length === 0 && scoreStudentHeaderRow(parsed.detectedHeaders) < 40) {
    return 'No se encontró una fila de encabezados válida. Ajustá la fila de encabezados y el mapeo manual.';
  }
  if (parsed.validRows.length === 0) {
    return 'Ninguna fila pudo interpretarse. Revisá el mapeo, los turnos (Mañana/Tarde/Noche) y las columnas obligatorias.';
  }
  return null;
}

// --- Asistencias ---

export interface ParsedAttendanceRow {
  rowNumber: number;
  fecha: string | null;
  escuela: string;
  curso: string;
  turno: string | null;
  materia: string;
  nombre: string;
  dni: string | null;
  estado: 'presente' | 'ausente' | null;
  errors: string[];
}

export interface ParsedAttendanceSheet {
  sheetName: string;
  headerRow: number;
  columnMap: Partial<Record<AttendanceMappingField, number>>;
  detectedHeaders: string[];
  rows: ParsedAttendanceRow[];
  validRows: ParsedAttendanceRow[];
  invalidRows: ParsedAttendanceRow[];
  mappingErrors: string[];
  requiresMapping: boolean;
}

export interface ParseAttendanceWorksheetOptions {
  preferredSheetNames?: string[];
  mapping?: AttendanceExcelMapping | null;
}

function detectAttendanceHeaderRow(worksheet: ExcelJS.Worksheet, maxScanRows = 15) {
  const maxColumns = Math.max(worksheet.columnCount || 0, worksheet.actualColumnCount || 0, 12);
  let bestRow = 1;
  let bestScore = 0;
  let bestHeaders: string[] = [];
  let bestMap: Partial<Record<AttendanceMappingField, number>> = {};

  for (let rowNumber = 1; rowNumber <= Math.min(maxScanRows, worksheet.rowCount || maxScanRows); rowNumber += 1) {
    const values = readRowValues(worksheet, rowNumber, maxColumns);
    const headers = values.map((value) => String(value ?? '').trim());
    const score = scoreAttendanceHeaderRow(headers);
    if (score <= bestScore) continue;

    let columnMap = buildAttendanceColumnMapFromHeaders(headers);
    const sampleRows: Array<Array<string | number | null>> = [];
    for (let offset = 1; offset <= 5; offset += 1) {
      const sample = readRowValues(worksheet, rowNumber + offset, maxColumns);
      if (sample.some((value) => value !== null && value !== '')) sampleRows.push(sample);
    }
    if (sampleRows.length) {
      columnMap = reinforceAttendanceMapWithSamples(headers, columnMap, sampleRows);
    }

    bestRow = rowNumber;
    bestScore = score;
    bestHeaders = headers;
    bestMap = columnMap;
  }

  return { headerRow: bestRow, columnMap: bestMap, detectedHeaders: bestHeaders, score: bestScore };
}

function getAttendanceMappedValue(
  values: ParsedCellValue[],
  columnMap: Partial<Record<AttendanceMappingField, number>>,
  field: AttendanceMappingField,
) {
  const index = columnMap[field];
  if (index == null) return null;
  return values[index] ?? null;
}

function attendanceColumnLabel(
  columnMap: Partial<Record<AttendanceMappingField, number>>,
  field: AttendanceMappingField,
  detectedHeaders: string[],
) {
  const index = columnMap[field];
  if (index == null) return null;
  return detectedHeaders[index] || `columna ${index + 1}`;
}

function parseAttendanceDataRow(
  rowNumber: number,
  values: ParsedCellValue[],
  columnMap: Partial<Record<AttendanceMappingField, number>>,
  detectedHeaders: string[],
): ParsedAttendanceRow | null {
  const hasValue = values.some((value) => value !== null && value !== '');
  if (!hasValue) return null;

  const fecha = parseSpreadsheetDate(getAttendanceMappedValue(values, columnMap, 'fecha'));
  const escuela = String(getAttendanceMappedValue(values, columnMap, 'escuela') ?? '').trim();
  const curso = String(getAttendanceMappedValue(values, columnMap, 'curso') ?? '').trim();
  const turnoRaw = getAttendanceMappedValue(values, columnMap, 'turno');
  const turno = normalizeTurnoValue(turnoRaw);
  const materia = String(getAttendanceMappedValue(values, columnMap, 'materia') ?? '').trim();
  const nombre = String(getAttendanceMappedValue(values, columnMap, 'nombre') ?? '').trim();
  const dni = normalizeDniValue(getAttendanceMappedValue(values, columnMap, 'dni'));
  const estadoRaw = getAttendanceMappedValue(values, columnMap, 'estado');
  const estado = normalizeAttendanceEstado(estadoRaw);
  const errors: string[] = [];

  const required: Array<[AttendanceMappingField, string | null]> = [
    ['fecha', fecha],
    ['escuela', escuela],
    ['curso', curso],
    ['turno', turno],
    ['materia', materia],
    ['nombre', nombre],
    ['estado', estado],
  ];

  for (const [field, value] of required) {
    if (value) continue;
    const mappedColumn = attendanceColumnLabel(columnMap, field, detectedHeaders);
    if (field === 'turno' && String(turnoRaw ?? '').trim()) {
      errors.push(`Turno no reconocido (fila ${rowNumber}): "${String(turnoRaw).trim()}". Usá Mañana, Tarde o Noche.`);
      continue;
    }
    if (field === 'estado' && String(estadoRaw ?? '').trim()) {
      errors.push(`Estado no reconocido (fila ${rowNumber}): "${String(estadoRaw).trim()}". Usá Presente o Ausente.`);
      continue;
    }
    errors.push(
      mappedColumn
        ? `Falta ${attendanceFieldLabel(field)} en columna "${mappedColumn}" (fila ${rowNumber}).`
        : `Falta ${attendanceFieldLabel(field)}: no hay columna asignada (fila ${rowNumber}).`,
    );
  }

  return { rowNumber, fecha, escuela, curso, turno, materia, nombre, dni, estado, errors };
}

function hasMinimumAttendanceMapping(columnMap: Partial<Record<AttendanceMappingField, number>>) {
  return validateAttendanceExcelMapping(attendanceColumnMapToMapping(1, columnMap)).length === 0;
}

export function pickAttendanceWorksheet(
  workbook: ExcelJS.Workbook,
  preferredNames: string[] = ['Asistencias', 'asistencias', 'Asistencia', 'Presentismo'],
) {
  for (const name of preferredNames) {
    const sheet = workbook.getWorksheet(name);
    if (sheet) return sheet;
  }

  let bestSheet = workbook.worksheets[0] || null;
  let bestScore = 0;
  for (const sheet of workbook.worksheets) {
    const detection = detectAttendanceHeaderRow(sheet, 10);
    if (detection.score > bestScore) {
      bestScore = detection.score;
      bestSheet = sheet;
    }
  }
  return bestSheet;
}

export function parseAttendanceWorksheet(
  workbook: ExcelJS.Workbook,
  options: ParseAttendanceWorksheetOptions = {},
): ParsedAttendanceSheet | null {
  const preferredNames = options.preferredSheetNames || ['Asistencias', 'asistencias', 'Asistencia', 'Presentismo'];
  const worksheet = pickAttendanceWorksheet(workbook, preferredNames);
  if (!worksheet) return null;

  const maxColumns = Math.max(worksheet.columnCount || 0, worksheet.actualColumnCount || 0, 12);
  const detection = detectAttendanceHeaderRow(worksheet, 15);
  const headerRow = options.mapping?.headerRow || detection.headerRow;
  const detectedHeaders = readRowValues(worksheet, headerRow, maxColumns).map((value) => String(value ?? '').trim());
  const columnMap = options.mapping
    ? attendanceMappingToColumnMap(options.mapping)
    : detection.headerRow === headerRow
      ? detection.columnMap
      : buildAttendanceColumnMapFromHeaders(detectedHeaders);

  const mapping = attendanceColumnMapToMapping(headerRow, columnMap);
  const mappingErrors = validateAttendanceExcelMapping(mapping);
  const headerScore = scoreAttendanceHeaderRow(detectedHeaders);
  const requiresMapping = mappingErrors.length > 0 || headerScore < 50;

  if (!options.mapping && headerScore < 50) {
    return {
      sheetName: worksheet.name,
      headerRow,
      columnMap,
      detectedHeaders,
      rows: [],
      validRows: [],
      invalidRows: [],
      mappingErrors,
      requiresMapping: true,
    };
  }

  const rows: ParsedAttendanceRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= (worksheet.rowCount || 0); rowNumber += 1) {
    const values = readRowValues(worksheet, rowNumber, maxColumns);
    const parsed = parseAttendanceDataRow(rowNumber, values, columnMap, detectedHeaders);
    if (parsed) rows.push(parsed);
  }

  const validRows = rows.filter((row) => row.errors.length === 0 && row.turno && row.estado && row.fecha);
  const invalidRows = rows.filter((row) => row.errors.length > 0 || !row.turno || !row.estado || !row.fecha);

  return {
    sheetName: worksheet.name,
    headerRow,
    columnMap,
    detectedHeaders,
    rows,
    validRows,
    invalidRows,
    mappingErrors,
    requiresMapping: requiresMapping || (!hasMinimumAttendanceMapping(columnMap) && validRows.length === 0),
  };
}

export function buildAttendanceSheetError(parsed: ParsedAttendanceSheet | null) {
  if (!parsed) return 'El archivo no contiene hojas de cálculo.';
  if (parsed.mappingErrors.length && parsed.validRows.length === 0) {
    return `${parsed.mappingErrors[0]} Revisá el mapeo de columnas.`;
  }
  if (parsed.rows.length === 0 && scoreAttendanceHeaderRow(parsed.detectedHeaders) < 50) {
    return 'No se encontró una fila de encabezados válida. Ajustá la fila de encabezados y el mapeo manual.';
  }
  if (parsed.validRows.length === 0) {
    return 'Ninguna fila pudo interpretarse. Revisá el mapeo, fechas, turnos y estados (Presente/Ausente).';
  }
  return null;
}

// --- Notas ---

export interface ParsedGradeRow {
  rowNumber: number;
  fecha: string | null;
  escuela: string;
  curso: string;
  turno: string | null;
  materia: string;
  nombre: string;
  dni: string | null;
  evaluacion: string;
  calificacion: string | number | null;
  importancia: string | number | null;
  entrega: string | null;
  motivo: string | null;
  tipo: string | null;
  periodo: string | null;
  errors: string[];
}

export interface ParsedGradeSheet {
  sheetName: string;
  headerRow: number;
  columnMap: Partial<Record<GradeMappingField, number>>;
  detectedHeaders: string[];
  rows: ParsedGradeRow[];
  validRows: ParsedGradeRow[];
  invalidRows: ParsedGradeRow[];
  mappingErrors: string[];
  requiresMapping: boolean;
}

export interface ParseGradeWorksheetOptions {
  preferredSheetNames?: string[];
  mapping?: GradeExcelMapping | null;
}

function detectGradeHeaderRow(worksheet: ExcelJS.Worksheet, maxScanRows = 15) {
  const maxColumns = Math.max(worksheet.columnCount || 0, worksheet.actualColumnCount || 0, 14);
  let bestRow = 1;
  let bestScore = 0;
  let bestHeaders: string[] = [];
  let bestMap: Partial<Record<GradeMappingField, number>> = {};

  for (let rowNumber = 1; rowNumber <= Math.min(maxScanRows, worksheet.rowCount || maxScanRows); rowNumber += 1) {
    const values = readRowValues(worksheet, rowNumber, maxColumns);
    const headers = values.map((value) => String(value ?? '').trim());
    const score = scoreGradeHeaderRow(headers);
    if (score <= bestScore) continue;

    let columnMap = buildGradeColumnMapFromHeaders(headers);
    const sampleRows: Array<Array<string | number | null>> = [];
    for (let offset = 1; offset <= 5; offset += 1) {
      const sample = readRowValues(worksheet, rowNumber + offset, maxColumns);
      if (sample.some((value) => value !== null && value !== '')) sampleRows.push(sample);
    }
    if (sampleRows.length) {
      columnMap = reinforceGradeMapWithSamples(headers, columnMap, sampleRows);
    }

    bestRow = rowNumber;
    bestScore = score;
    bestHeaders = headers;
    bestMap = columnMap;
  }

  return { headerRow: bestRow, columnMap: bestMap, detectedHeaders: bestHeaders, score: bestScore };
}

function getGradeMappedValue(
  values: ParsedCellValue[],
  columnMap: Partial<Record<GradeMappingField, number>>,
  field: GradeMappingField,
) {
  const index = columnMap[field];
  if (index == null) return null;
  return values[index] ?? null;
}

function gradeColumnLabel(
  columnMap: Partial<Record<GradeMappingField, number>>,
  field: GradeMappingField,
  detectedHeaders: string[],
) {
  const index = columnMap[field];
  if (index == null) return null;
  return detectedHeaders[index] || `columna ${index + 1}`;
}

function parseGradeDataRow(
  rowNumber: number,
  values: ParsedCellValue[],
  columnMap: Partial<Record<GradeMappingField, number>>,
  detectedHeaders: string[],
): ParsedGradeRow | null {
  const hasValue = values.some((value) => value !== null && value !== '');
  if (!hasValue) return null;

  const fecha = parseSpreadsheetDate(getGradeMappedValue(values, columnMap, 'fecha'));
  const escuela = String(getGradeMappedValue(values, columnMap, 'escuela') ?? '').trim();
  const curso = String(getGradeMappedValue(values, columnMap, 'curso') ?? '').trim();
  const turnoRaw = getGradeMappedValue(values, columnMap, 'turno');
  const turno = normalizeTurnoValue(turnoRaw);
  const materia = String(getGradeMappedValue(values, columnMap, 'materia') ?? '').trim();
  const nombre = String(getGradeMappedValue(values, columnMap, 'nombre') ?? '').trim();
  const dni = normalizeDniValue(getGradeMappedValue(values, columnMap, 'dni'));
  const evaluacion = String(getGradeMappedValue(values, columnMap, 'evaluacion') ?? '').trim();
  const calificacion = getGradeMappedValue(values, columnMap, 'calificacion');
  const importancia = getGradeMappedValue(values, columnMap, 'importancia');
  const entrega = parseSpreadsheetDate(getGradeMappedValue(values, columnMap, 'entrega'));
  const motivo = String(getGradeMappedValue(values, columnMap, 'motivo') ?? '').trim() || null;
  const tipo = String(getGradeMappedValue(values, columnMap, 'tipo') ?? '').trim() || null;
  const periodo = String(getGradeMappedValue(values, columnMap, 'periodo') ?? '').trim() || null;
  const errors: string[] = [];

  const required: Array<[GradeMappingField, string | number | null]> = [
    ['fecha', fecha],
    ['escuela', escuela],
    ['curso', curso],
    ['turno', turno],
    ['materia', materia],
    ['nombre', nombre],
    ['evaluacion', evaluacion],
    ['calificacion', calificacion],
  ];

  for (const [field, value] of required) {
    if (value !== null && value !== '') continue;
    const mappedColumn = gradeColumnLabel(columnMap, field, detectedHeaders);
    if (field === 'turno' && String(turnoRaw ?? '').trim()) {
      errors.push(`Turno no reconocido (fila ${rowNumber}): "${String(turnoRaw).trim()}". Usá Mañana, Tarde o Noche.`);
      continue;
    }
    errors.push(
      mappedColumn
        ? `Falta ${gradeFieldLabel(field)} en columna "${mappedColumn}" (fila ${rowNumber}).`
        : `Falta ${gradeFieldLabel(field)}: no hay columna asignada (fila ${rowNumber}).`,
    );
  }

  return {
    rowNumber,
    fecha,
    escuela,
    curso,
    turno,
    materia,
    nombre,
    dni,
    evaluacion,
    calificacion,
    importancia,
    entrega,
    motivo,
    tipo,
    periodo,
    errors,
  };
}

function hasMinimumGradeMapping(columnMap: Partial<Record<GradeMappingField, number>>) {
  return validateGradeExcelMapping(gradeColumnMapToMapping(1, columnMap)).length === 0;
}

export function pickGradeWorksheet(
  workbook: ExcelJS.Workbook,
  preferredNames: string[] = ['Notas', 'notas', 'Calificaciones', 'calificaciones'],
) {
  for (const name of preferredNames) {
    const sheet = workbook.getWorksheet(name);
    if (sheet) return sheet;
  }

  let bestSheet = workbook.worksheets[0] || null;
  let bestScore = 0;
  for (const sheet of workbook.worksheets) {
    const detection = detectGradeHeaderRow(sheet, 10);
    if (detection.score > bestScore) {
      bestScore = detection.score;
      bestSheet = sheet;
    }
  }
  return bestSheet;
}

export function parseGradeWorksheet(
  workbook: ExcelJS.Workbook,
  options: ParseGradeWorksheetOptions = {},
): ParsedGradeSheet | null {
  const preferredNames = options.preferredSheetNames || ['Notas', 'notas', 'Calificaciones', 'calificaciones'];
  const worksheet = pickGradeWorksheet(workbook, preferredNames);
  if (!worksheet) return null;

  const maxColumns = Math.max(worksheet.columnCount || 0, worksheet.actualColumnCount || 0, 14);
  const detection = detectGradeHeaderRow(worksheet, 15);
  const headerRow = options.mapping?.headerRow || detection.headerRow;
  const detectedHeaders = readRowValues(worksheet, headerRow, maxColumns).map((value) => String(value ?? '').trim());
  const columnMap = options.mapping
    ? gradeMappingToColumnMap(options.mapping)
    : detection.headerRow === headerRow
      ? detection.columnMap
      : buildGradeColumnMapFromHeaders(detectedHeaders);

  const mapping = gradeColumnMapToMapping(headerRow, columnMap);
  const mappingErrors = validateGradeExcelMapping(mapping);
  const headerScore = scoreGradeHeaderRow(detectedHeaders);
  const requiresMapping = mappingErrors.length > 0 || headerScore < 50;

  if (!options.mapping && headerScore < 50) {
    return {
      sheetName: worksheet.name,
      headerRow,
      columnMap,
      detectedHeaders,
      rows: [],
      validRows: [],
      invalidRows: [],
      mappingErrors,
      requiresMapping: true,
    };
  }

  const rows: ParsedGradeRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= (worksheet.rowCount || 0); rowNumber += 1) {
    const values = readRowValues(worksheet, rowNumber, maxColumns);
    const parsed = parseGradeDataRow(rowNumber, values, columnMap, detectedHeaders);
    if (parsed) rows.push(parsed);
  }

  const validRows = rows.filter((row) => row.errors.length === 0 && row.turno && row.fecha && row.calificacion != null && row.calificacion !== '');
  const invalidRows = rows.filter((row) => row.errors.length > 0 || !row.turno || !row.fecha || row.calificacion == null || row.calificacion === '');

  return {
    sheetName: worksheet.name,
    headerRow,
    columnMap,
    detectedHeaders,
    rows,
    validRows,
    invalidRows,
    mappingErrors,
    requiresMapping: requiresMapping || (!hasMinimumGradeMapping(columnMap) && validRows.length === 0),
  };
}

export function buildGradeSheetError(parsed: ParsedGradeSheet | null) {
  if (!parsed) return 'El archivo no contiene hojas de cálculo.';
  if (parsed.mappingErrors.length && parsed.validRows.length === 0) {
    return `${parsed.mappingErrors[0]} Revisá el mapeo de columnas.`;
  }
  if (parsed.rows.length === 0 && scoreGradeHeaderRow(parsed.detectedHeaders) < 50) {
    return 'No se encontró una fila de encabezados válida. Ajustá la fila de encabezados y el mapeo manual.';
  }
  if (parsed.validRows.length === 0) {
    return 'Ninguna fila pudo interpretarse. Revisá el mapeo, fechas, turnos y calificaciones.';
  }
  return null;
}
