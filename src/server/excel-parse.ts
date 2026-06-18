import type ExcelJS from 'exceljs';
import {
  buildColumnMapFromHeaders,
  matchStudentField,
  mergeStudentNombre,
  missingStudentFields,
  normalizeDniValue,
  normalizeTurnoValue,
  scoreStudentHeaderRow,
  splitMateriasValue,
  type StudentField,
  type StudentMappingField,
} from '../lib/excel-column-map';
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

    const columnMap = buildColumnMapFromHeaders(headers);

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
