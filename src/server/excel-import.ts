import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import type { ExcelImportType } from '../lib/excel-import-limits';
import {
  STUDENT_EXCEL_COLUMNS,
  STUDENT_EXCEL_EXAMPLE_ROWS,
  STUDENT_EXCEL_NOTES,
  STUDENT_EXCEL_SHEET,
} from '../lib/student-excel-reference';
import { normalizeTurnoValue, splitMateriasValue, normalizeComparableText, normalizeDniValue, matchGradeField, scoreGradeHeaderRow } from '../lib/excel-column-map';
import { EXCEL_IMPORT_LIMITS } from '../lib/excel-import-limits';
import {
  columnMapToMapping,
  parseStudentExcelMappingJson,
  serializeMappingForClient,
  STUDENT_MAPPABLE_FIELDS,
  validateStudentExcelMapping,
  type StudentExcelMapping,
} from '../lib/student-excel-mapping';
import {
  attendanceColumnMapToMapping,
  ATTENDANCE_MAPPABLE_FIELDS,
  parseAttendanceExcelMappingJson,
  serializeAttendanceMappingForClient,
  validateAttendanceExcelMapping,
  type AttendanceExcelMapping,
} from '../lib/attendance-excel-mapping';
import {
  gradeColumnMapToMapping,
  GRADE_MAPPABLE_FIELDS,
  parseGradeExcelMappingJson,
  serializeGradeMappingForClient,
  validateGradeExcelMapping,
  type GradeExcelMapping,
} from '../lib/grade-excel-mapping';
import {
  buildStudentSheetError,
  buildAttendanceSheetError,
  buildGradeSheetError,
  parseAttendanceWorksheet,
  parseGradeWorksheet,
  parseStudentWorksheet,
  type ParsedAttendanceRow,
  type ParsedGradeRow,
  type ParsedStudentRow,
} from './excel-parse';
import { canAccessStudent, canAccessSubject } from './auth';
import { db, type User } from './db';

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
  coursesCreated?: number;
  /** Ciclo lectivo usado al crear/asignar cursos en esta importación. */
  cicloLectivo?: number;
}

export type ImportExcelOptions = {
  cicloLectivo?: number;
};

function resolveImportCicloLectivo(value: unknown) {
  const year = Number(value);
  if (Number.isFinite(year) && year >= 2000 && year <= 2100) return Math.floor(year);
  return new Date().getFullYear();
}

type RowRecord = Record<string, string | number | null>;

const VALID_TURNOS = ['Mañana', 'Tarde', 'Noche'] as const;
const SHEET_BY_TYPE: Record<ExcelImportType, string[]> = {
  cursos: ['Cursos', 'cursos'],
  alumnos: ['Alumnos', 'alumnos'],
  asistencias: ['Asistencias', 'asistencias'],
  notas: ['Notas', 'notas'],
};

const HEADER_ALIASES: Record<string, string> = {
  escuela: 'escuela',
  colegio: 'escuela',
  curso: 'curso',
  turno: 'turno',
  'ciclo lectivo': 'cicloLectivo',
  ciclolectivo: 'cicloLectivo',
  nombre: 'nombre',
  alumno: 'nombre',
  dni: 'dni',
  tutor: 'tutor',
  materias: 'materias',
  materia: 'materia',
  fecha: 'fecha',
  estado: 'estado',
  evaluacion: 'evaluacion',
  evaluación: 'evaluacion',
  calificacion: 'calificacion',
  calificación: 'calificacion',
  importancia: 'importancia',
  entrega: 'entrega',
  motivo: 'motivo',
  tipo: 'tipo',
  periodo: 'periodo',
};

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim()
    .toLowerCase();
}

function cellText(value: ExcelJS.CellValue): string | number | null {
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

function parseDate(value: string | number | null): string | null {
  if (value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + Math.floor(value));
    return excelEpoch.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function normalizeTurno(value: string | number | null): string | null {
  return normalizeTurnoValue(value);
}

function normalizeEstado(value: string | number | null): 'presente' | 'ausente' | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'presente' || text === 'p') return 'presente';
  if (text === 'ausente' || text === 'a' || text === 'falta') return 'ausente';
  return null;
}

function parsePeso(value: string | number | null): number {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'alta' || text === '100') return 100;
  if (text === 'media' || text === '60') return 60;
  if (text === 'baja' || text === '40') return 40;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return 100;
}

function parseCalificacion(value: string | number | null): { valor: number | null; calificacionTexto: string | null } {
  if (value === null || value === '') return { valor: null, calificacionTexto: null };
  const numeric = Number(String(value).replace(',', '.'));
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 10) {
    return { valor: numeric, calificacionTexto: null };
  }
  const text = String(value).trim();
  return text ? { valor: null, calificacionTexto: text } : { valor: null, calificacionTexto: null };
}

function pickWorksheet(workbook: ExcelJS.Workbook, type: ExcelImportType) {
  const preferred = SHEET_BY_TYPE[type];
  for (const name of preferred) {
    const sheet = workbook.getWorksheet(name);
    if (sheet) return sheet;
  }
  return workbook.worksheets[0] || null;
}

function worksheetToRows(worksheet: ExcelJS.Worksheet): RowRecord[] {
  const maxColumns = Math.max(worksheet.columnCount || 0, worksheet.actualColumnCount || 0, 1);

  // Detectar fila de encabezados (1–12) con score de campos de notas, o fila 1 por defecto
  let headerRowNumber = 1;
  let bestScore = -1;
  const scanLimit = Math.min(12, worksheet.rowCount || 1);
  for (let rowNumber = 1; rowNumber <= scanLimit; rowNumber += 1) {
    const labels: string[] = [];
    for (let column = 1; column <= maxColumns; column += 1) {
      labels.push(String(cellText(worksheet.getRow(rowNumber).getCell(column).value) ?? ''));
    }
    const score = scoreGradeHeaderRow(labels);
    if (score > bestScore) {
      bestScore = score;
      headerRowNumber = rowNumber;
    }
  }

  const headers: string[] = [];
  for (let column = 1; column <= maxColumns; column += 1) {
    const raw = String(cellText(worksheet.getRow(headerRowNumber).getCell(column).value) ?? '');
    const normalized = normalizeHeader(raw);
    if (!normalized) continue;
    const aliased = HEADER_ALIASES[normalized];
    if (aliased) {
      headers[column - 1] = aliased;
      continue;
    }
    const smart = matchGradeField(raw);
    if (smart) {
      headers[column - 1] = smart === 'evaluacion' ? 'evaluacion'
        : smart === 'calificacion' ? 'calificacion'
        : smart;
      continue;
    }
    headers[column - 1] = normalized;
  }

  const rows: RowRecord[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;

    const record: RowRecord = {};
    let hasValue = false;

    for (let column = 0; column < headers.length; column += 1) {
      const header = headers[column];
      if (!header) continue;
      const value = cellText(row.getCell(column + 1).value);
      if (value !== null && value !== '') hasValue = true;
      record[header] = value;
    }

    if (hasValue) rows.push(record);
  });

  return rows;
}

async function ensureSchool(user: User, nombre: string, updatedAt: string) {
  const tenantId = user.tenant_id;
  const existing = (await db.prepare(`
    SELECT id FROM escuelas
    WHERE tenant_id = ? AND LOWER(nombre) = LOWER(?)
  `).get(tenantId, nombre)) as { id: string } | undefined;

  const schoolId = existing?.id || `esc-${randomUUID()}`;
  if (!existing) {
    await db.prepare(`
      INSERT INTO escuelas (id, tenant_id, nombre, activo, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(schoolId, tenantId, nombre, updatedAt);
  }

  if (user.rol !== 'admin') {
    await db.prepare(`
      INSERT OR IGNORE INTO docente_escuelas (tenant_id, docente_id, escuela_id)
      VALUES (?, ?, ?)
    `).run(tenantId, user.id, schoolId);
  }

  return schoolId;
}

async function ensureSubject(user: User, nombre: string, updatedAt: string) {
  const trimmed = String(nombre || '').trim();
  if (!trimmed) return '';
  const soft = await findSubject(user, trimmed);
  if (soft) {
    if (user.rol !== 'admin') {
      await db.prepare(`
        INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id)
        VALUES (?, ?, ?)
      `).run(user.tenant_id, user.id, soft.id);
    }
    return soft.id;
  }

  const tenantId = user.tenant_id;
  const subjectId = `mat-${randomUUID()}`;
  await db.prepare(`
    INSERT INTO materias (id, tenant_id, nombre, activo, updated_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(subjectId, tenantId, trimmed, updatedAt);

  if (user.rol !== 'admin') {
    await db.prepare(`
      INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id)
      VALUES (?, ?, ?)
    `).run(tenantId, user.id, subjectId);
  }

  return subjectId;
}

async function findCourse(user: User, escuela: string, nombre: string, turno: string, cicloLectivo = new Date().getFullYear()) {
  const year = Number.isFinite(cicloLectivo) ? cicloLectivo : new Date().getFullYear();
  const exact = (await db.prepare(`
    SELECT id FROM cursos
    WHERE tenant_id = ?
      AND LOWER(escuela) = LOWER(?)
      AND LOWER(nombre) = LOWER(?)
      AND LOWER(turno) = LOWER(?)
      AND ciclo_lectivo = ?
  `).get(user.tenant_id, escuela, nombre, turno, year)) as { id: string } | undefined;
  if (exact) return exact;

  const candidates = (await db.prepare(`
    SELECT id, escuela, nombre, turno FROM cursos
    WHERE tenant_id = ? AND ciclo_lectivo = ?
  `).all(user.tenant_id, year)) as Array<{ id: string; escuela: string; nombre: string; turno: string }>;

  const targetEscuela = normalizeComparableText(escuela);
  const targetNombre = normalizeComparableText(nombre);
  const targetTurno = normalizeComparableText(turno);
  return candidates.find((course) => (
    normalizeComparableText(course.escuela) === targetEscuela
    && normalizeComparableText(course.nombre) === targetNombre
    && normalizeComparableText(course.turno) === targetTurno
  ));
}

async function findStudent(user: User, courseId: string, nombre: string, dni: string | null) {
  const normalizedDni = dni ? normalizeDniValue(dni) : null;
  if (normalizedDni) {
    const byDni = (await db.prepare(`
      SELECT id FROM alumnos
      WHERE tenant_id = ? AND curso_id = ? AND dni = ?
    `).get(user.tenant_id, courseId, normalizedDni)) as { id: string } | undefined;
    if (byDni) return byDni;

    const byDniTenant = (await db.prepare(`
      SELECT id FROM alumnos
      WHERE tenant_id = ? AND dni = ?
    `).get(user.tenant_id, normalizedDni)) as { id: string } | undefined;
    if (byDniTenant) return byDniTenant;
  }

  const exact = (await db.prepare(`
    SELECT id FROM alumnos
    WHERE tenant_id = ? AND curso_id = ? AND LOWER(nombre) = LOWER(?)
  `).get(user.tenant_id, courseId, nombre)) as { id: string } | undefined;
  if (exact) return exact;

  const candidates = (await db.prepare(`
    SELECT id, nombre FROM alumnos
    WHERE tenant_id = ? AND curso_id = ? AND activo = 1
  `).all(user.tenant_id, courseId)) as Array<{ id: string; nombre: string }>;
  const target = normalizeComparableText(nombre);
  const soft = candidates.find((student) => normalizeComparableText(student.nombre) === target);
  if (soft) return soft;

  // Permite "Apellido Nombre" vs "Nombre Apellido"
  const targetTokens = new Set(target.split(' ').filter(Boolean));
  if (targetTokens.size >= 2) {
    return candidates.find((student) => {
      const tokens = new Set(normalizeComparableText(student.nombre).split(' ').filter(Boolean));
      if (tokens.size !== targetTokens.size) return false;
      for (const token of targetTokens) {
        if (!tokens.has(token)) return false;
      }
      return true;
    });
  }

  return undefined;
}

async function findSubject(user: User, nombre: string) {
  const exact = (await db.prepare(`
    SELECT id FROM materias
    WHERE tenant_id = ? AND LOWER(nombre) = LOWER(?)
  `).get(user.tenant_id, nombre)) as { id: string } | undefined;
  if (exact) return exact;

  const candidates = (await db.prepare(`
    SELECT id, nombre FROM materias
    WHERE tenant_id = ? AND activo = 1
  `).all(user.tenant_id)) as Array<{ id: string; nombre: string }>;
  const target = normalizeComparableText(nombre);
  return candidates.find((subject) => normalizeComparableText(subject.nombre) === target);
}

/** Busca materia con match suave; si no existe, la crea y la asigna al docente. */
async function resolveSubject(user: User, nombre: string, updatedAt: string) {
  const found = await findSubject(user, nombre);
  if (found) {
    if (user.rol !== 'admin') {
      await db.prepare(`
        INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id)
        VALUES (?, ?, ?)
      `).run(user.tenant_id, user.id, found.id);
    }
    return found.id;
  }
  return ensureSubject(user, nombre, updatedAt);
}

function splitMaterias(value: string | number | null) {
  return splitMateriasValue(value);
}

async function upsertStudentRow(
  user: User,
  row: ParsedStudentRow,
  updatedAt: string,
  errors: ImportRowError[],
  cicloLectivo = new Date().getFullYear(),
) {
  if (!row.turno) {
    errors.push({ row: row.rowNumber, message: 'Falta el turno (Mañana, Tarde o Noche).' });
    return { imported: 0, updated: 0, coursesCreated: 0 };
  }

  try {
    const { id: courseId, created: courseCreated } = await ensureCourse(
      user,
      row.escuela,
      row.curso,
      row.turno,
      updatedAt,
      cicloLectivo,
    );

    const existingByDni = row.dni
      ? (await db.prepare('SELECT id FROM alumnos WHERE tenant_id = ? AND dni = ?').get(user.tenant_id, row.dni)) as { id: string } | undefined
      : undefined;
    const existingByName = !existingByDni
      ? await findStudent(user, courseId, row.nombre, row.dni)
      : undefined;
    const existing = existingByDni || existingByName;
    const studentId = existing?.id || `al-${randomUUID()}`;

    if (row.dni) {
      await db.prepare(`
        INSERT INTO alumnos (id, tenant_id, curso_id, nombre, dni, tutor, activo, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(tenant_id, dni) DO UPDATE SET
          curso_id = excluded.curso_id,
          nombre = excluded.nombre,
          tutor = excluded.tutor,
          activo = 1,
          updated_at = excluded.updated_at
      `).run(studentId, user.tenant_id, courseId, row.nombre, row.dni, row.tutor, updatedAt);
    } else {
      await db.prepare(`
        INSERT INTO alumnos (id, tenant_id, curso_id, nombre, dni, tutor, activo, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(id) DO UPDATE SET
          curso_id = excluded.curso_id,
          nombre = excluded.nombre,
          dni = excluded.dni,
          tutor = excluded.tutor,
          activo = 1,
          updated_at = excluded.updated_at
      `).run(studentId, user.tenant_id, courseId, row.nombre, row.dni, row.tutor, updatedAt);
    }

    const savedStudent = row.dni
      ? (await db.prepare('SELECT id FROM alumnos WHERE tenant_id = ? AND dni = ?').get(user.tenant_id, row.dni)) as { id: string } | undefined
      : { id: studentId };

    if (row.materias.length && savedStudent?.id) {
      await db.prepare('DELETE FROM alumno_materias WHERE tenant_id = ? AND alumno_id = ?').run(user.tenant_id, savedStudent.id);
      const insert = db.prepare(`
        INSERT OR IGNORE INTO alumno_materias (tenant_id, alumno_id, materia_id)
        VALUES (?, ?, ?)
      `);
      for (const materiaNombre of row.materias) {
        const subjectId = await ensureSubject(user, materiaNombre, updatedAt);
        if (!subjectId) continue;
        await insert.run(user.tenant_id, savedStudent.id, subjectId);
      }
    }

    return {
      imported: existing ? 0 : 1,
      updated: existing ? 1 : 0,
      coursesCreated: courseCreated ? 1 : 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al guardar la fila.';
    if (/UNIQUE constraint failed: alumnos\.(dni|tenant_id)/i.test(message)) {
      errors.push({ row: row.rowNumber, message: `DNI duplicado (${row.dni}). Revisá que no esté repetido en el Excel.` });
    } else {
      errors.push({ row: row.rowNumber, message });
    }
    return { imported: 0, updated: 0, coursesCreated: 0 };
  }
}

async function importStudentRows(
  user: User,
  rows: ParsedStudentRow[],
  errors: ImportRowError[],
  cicloLectivo = new Date().getFullYear(),
) {
  let imported = 0;
  let updated = 0;
  let coursesCreated = 0;
  let skipped = 0;
  const updatedAt = new Date().toISOString();

  for (const row of rows) {
    if (row.errors.length) {
      row.errors.forEach((message) => errors.push({ row: row.rowNumber, message }));
      skipped += 1;
      continue;
    }

    const result = await upsertStudentRow(user, row, updatedAt, errors, cicloLectivo);
    imported += result.imported;
    updated += result.updated;
    coursesCreated += result.coursesCreated;
  }

  return { imported, updated, skipped, coursesCreated, cicloLectivo };
}

async function ensureCourse(
  user: User,
  escuela: string,
  nombre: string,
  turno: string,
  updatedAt: string,
  cicloLectivo = new Date().getFullYear(),
): Promise<{ id: string; created: boolean }> {
  await ensureSchool(user, escuela, updatedAt);
  const year = Number.isFinite(cicloLectivo) ? cicloLectivo : new Date().getFullYear();
  const existing = await findCourse(user, escuela, nombre, turno, year);
  const courseId = existing?.id || `curso-${randomUUID()}`;

  if (existing) {
    await db.prepare(`
      UPDATE cursos
      SET updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(updatedAt, courseId, user.tenant_id);
  } else {
    await db.prepare(`
      INSERT INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(courseId, user.tenant_id, escuela, nombre, turno, year, updatedAt);
  }

  if (user.rol !== 'admin') {
    await db.prepare(`
      INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id)
      VALUES (?, ?, ?)
    `).run(user.tenant_id, user.id, courseId);
  }

  return { id: courseId, created: !existing };
}

async function importCourses(user: User, rows: RowRecord[], errors: ImportRowError[]) {
  let imported = 0;
  let updated = 0;
  const updatedAt = new Date().toISOString();

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const escuela = String(row.escuela ?? '').trim();
    const nombre = String(row.curso ?? '').trim();
    const turno = normalizeTurno(row.turno ?? null);
    const cicloRaw = row.cicloLectivo;
    const cicloLectivo = cicloRaw ? Number(String(cicloRaw).trim()) : new Date().getFullYear();

    if (!escuela || !nombre || !turno) {
      errors.push({ row: rowNumber, message: 'Escuela, Curso y Turno son obligatorios (Turno: Mañana, Tarde o Noche).' });
      continue;
    }

    const { created } = await ensureCourse(user, escuela, nombre, turno, updatedAt, cicloLectivo);
    if (created) imported += 1;
    else updated += 1;
  }

  return { imported, updated, skipped: 0 };
}

async function importAttendanceFromParsed(user: User, rows: ParsedAttendanceRow[], errors: ImportRowError[]) {
  const records: RowRecord[] = rows.map((row) => ({
    fecha: row.fecha,
    escuela: row.escuela,
    curso: row.curso,
    turno: row.turno,
    materia: row.materia,
    nombre: row.nombre,
    dni: row.dni,
    estado: row.estado,
  }));
  return importAttendance(user, records, errors);
}

function appendInvalidRowErrors(
  invalidRows: Array<{ rowNumber: number; errors: string[] }>,
  errors: ImportRowError[],
) {
  for (const row of invalidRows) {
    if (row.errors.length) {
      for (const message of row.errors) {
        errors.push({ row: row.rowNumber, message });
      }
    } else {
      errors.push({ row: row.rowNumber, message: 'Fila inválida: faltan datos obligatorios o el formato no se reconoció.' });
    }
  }
}

async function importAttendance(user: User, rows: RowRecord[], errors: ImportRowError[]) {
  let imported = 0;
  let updated = 0;
  const updatedAt = new Date().toISOString();
  const docenteId = user.id;

  for (const [index, row] of rows.entries()) {
    const rowNumber = Number(row.rowNumber) || index + 2;
    const fecha = parseDate(row.fecha ?? null);
    const escuela = String(row.escuela ?? '').trim();
    const curso = String(row.curso ?? '').trim();
    const turno = normalizeTurno(row.turno ?? null);
    const materia = String(row.materia ?? '').trim();
    const alumno = String(row.nombre ?? '').trim();
    const dni = row.dni != null ? normalizeDniValue(row.dni) : null;
    const estado = normalizeEstado(row.estado ?? null);

    if (!fecha || !escuela || !curso || !turno || !materia || !alumno || !estado) {
      errors.push({
        row: rowNumber,
        message: 'Fecha, Colegio/Escuela, Curso, Turno, Materia, Alumno y Estado (Presente/Ausente) son obligatorios.',
      });
      continue;
    }

    const course = await findCourse(user, escuela, curso, turno);
    if (!course) {
      errors.push({ row: rowNumber, message: `Curso no encontrado: ${curso} (${escuela}, ${turno}).` });
      continue;
    }

    const subjectId = await resolveSubject(user, materia, updatedAt);

    const student = await findStudent(user, course.id, alumno, dni);
    if (!student) {
      errors.push({ row: rowNumber, message: `Alumno no encontrado: ${alumno} en ${curso}.` });
      continue;
    }

    if (!(await canAccessStudent(user, student.id)) || !(await canAccessSubject(user, subjectId))) {
      errors.push({ row: rowNumber, message: 'No tenés permiso sobre ese alumno o materia.' });
      continue;
    }

    const existing = (await db.prepare(`
      SELECT id FROM asistencias
      WHERE tenant_id = ? AND docente_id = ? AND alumno_id = ? AND materia_id = ? AND fecha = ?
    `).get(user.tenant_id, docenteId, student.id, subjectId, fecha)) as { id: string } | undefined;

    const attendanceId = existing?.id || `attendance:${docenteId}:${student.id}:${subjectId}:${fecha}`;

    await db.prepare(`
      INSERT INTO asistencias (id, tenant_id, docente_id, alumno_id, materia_id, fecha, estado, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (docente_id, alumno_id, materia_id, fecha)
      DO UPDATE SET estado = excluded.estado, updated_at = excluded.updated_at
    `).run(attendanceId, user.tenant_id, docenteId, student.id, subjectId, fecha, estado, updatedAt);

    if (existing) updated += 1;
    else imported += 1;
  }

  return { imported, updated, skipped: 0 };
}

async function importGradesFromParsed(user: User, rows: ParsedGradeRow[], errors: ImportRowError[]) {
  const records: RowRecord[] = rows.map((row) => ({
    rowNumber: row.rowNumber,
    fecha: row.fecha,
    escuela: row.escuela,
    curso: row.curso,
    turno: row.turno,
    materia: row.materia,
    nombre: row.nombre,
    dni: row.dni,
    evaluacion: row.evaluacion,
    calificacion: row.calificacion,
    importancia: row.importancia,
    entrega: row.entrega,
    motivo: row.motivo,
    tipo: row.tipo,
    periodo: row.periodo,
  }));
  return importGrades(user, records, errors);
}

async function importGrades(user: User, rows: RowRecord[], errors: ImportRowError[]) {
  let imported = 0;
  let updated = 0;
  const updatedAt = new Date().toISOString();
  const docenteId = user.id;

  for (const [index, row] of rows.entries()) {
    const rowNumber = Number(row.rowNumber) || index + 2;
    const fecha = parseDate(row.fecha ?? null);
    const escuela = String(row.escuela ?? '').trim();
    const curso = String(row.curso ?? '').trim();
    const turno = normalizeTurno(row.turno ?? null);
    const materia = String(row.materia ?? '').trim();
    const alumno = String(row.nombre ?? '').trim();
    const dni = row.dni != null ? normalizeDniValue(row.dni) : null;
    const titulo = String(row.evaluacion ?? '').trim();
    const { valor, calificacionTexto } = parseCalificacion(row.calificacion ?? null);
    const peso = parsePeso(row.importancia ?? null);
    const fechaEntrega = parseDate(row.entrega ?? null);
    const motivo = String(row.motivo ?? '').trim() || null;
    const tipoEvaluacion = String(row.tipo ?? '').trim() || null;
    const periodo = String(row.periodo ?? '').trim() || null;

    if (!fecha || !escuela || !curso || !turno || !materia || !alumno || !titulo) {
      errors.push({
        row: rowNumber,
        message: 'Fecha, Colegio/Escuela, Curso, Turno, Materia, Alumno y Evaluación son obligatorios.',
      });
      continue;
    }

    if (valor === null && !calificacionTexto) {
      errors.push({ row: rowNumber, message: 'Calificación obligatoria: número del 1 al 10 o texto (ej. S/C).' });
      continue;
    }

    const course = await findCourse(user, escuela, curso, turno);
    if (!course) {
      errors.push({ row: rowNumber, message: `Curso no encontrado: ${curso} (${escuela}, ${turno}).` });
      continue;
    }

    const subjectId = await resolveSubject(user, materia, updatedAt);

    const student = await findStudent(user, course.id, alumno, dni);
    if (!student) {
      errors.push({ row: rowNumber, message: `Alumno no encontrado: ${alumno} en ${curso}.` });
      continue;
    }

    if (!(await canAccessStudent(user, student.id)) || !(await canAccessSubject(user, subjectId))) {
      errors.push({ row: rowNumber, message: 'No tenés permiso sobre ese alumno o materia.' });
      continue;
    }

    const existing = (await db.prepare(`
      SELECT id FROM notas
      WHERE tenant_id = ? AND docente_id = ? AND alumno_id = ? AND materia_id = ? AND titulo = ? AND fecha = ?
    `).get(user.tenant_id, docenteId, student.id, subjectId, titulo, fecha)) as { id: string } | undefined;

    const gradeId = existing?.id || `nota-${randomUUID()}`;

    await db.prepare(`
      INSERT INTO notas (
        id, tenant_id, docente_id, alumno_id, materia_id, titulo, tipo_evaluacion,
        valor, calificacion_texto, peso, fecha, fecha_entrega, periodo, motivo, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        tipo_evaluacion = excluded.tipo_evaluacion,
        valor = excluded.valor,
        calificacion_texto = excluded.calificacion_texto,
        peso = excluded.peso,
        fecha_entrega = excluded.fecha_entrega,
        periodo = excluded.periodo,
        motivo = excluded.motivo,
        updated_at = excluded.updated_at
    `).run(
      gradeId,
      user.tenant_id,
      docenteId,
      student.id,
      subjectId,
      titulo,
      tipoEvaluacion,
      valor,
      calificacionTexto,
      peso,
      fecha,
      fechaEntrega,
      periodo,
      motivo,
      updatedAt,
    );

    if (existing) updated += 1;
    else imported += 1;
  }

  return { imported, updated, skipped: 0 };
}

export async function previewAttendanceExcelBuffer(user: User, buffer: ArrayBuffer, mappingInput?: AttendanceExcelMapping | null) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const parsed = parseAttendanceWorksheet(workbook, { mapping: mappingInput || null });
  const sheetError = buildAttendanceSheetError(parsed);
  const mapping = parsed ? attendanceColumnMapToMapping(parsed.headerRow, parsed.columnMap) : null;
  const mappingErrors = mapping ? validateAttendanceExcelMapping(mapping) : ['No se pudo leer la planilla.'];

  return {
    sheetName: parsed?.sheetName || null,
    headerRow: parsed?.headerRow || 0,
    detectedHeaders: parsed?.detectedHeaders || [],
    availableColumns: (parsed?.detectedHeaders || []).map((label, index) => ({ index, label: label || `Columna ${index + 1}` })),
    mapping: mapping ? serializeAttendanceMappingForClient(mapping) : null,
    mappableFields: ATTENDANCE_MAPPABLE_FIELDS,
    mappingErrors,
    requiresMapping: Boolean(parsed?.requiresMapping),
    columnMap: parsed?.columnMap || {},
    totalRows: parsed?.rows.length || 0,
    validRows: parsed?.validRows.length || 0,
    invalidRows: parsed?.invalidRows.length || 0,
    preview: (parsed?.validRows || []).slice(0, 5).map((row) => ({
      row: row.rowNumber,
      fecha: row.fecha,
      escuela: row.escuela,
      curso: row.curso,
      turno: row.turno,
      materia: row.materia,
      nombre: row.nombre,
      dni: row.dni,
      estado: row.estado,
    })),
    errors: [
      ...(sheetError ? [{ row: 0, message: sheetError }] : []),
      ...(parsed?.mappingErrors || []).map((message) => ({ row: 0, message })),
      ...(parsed?.invalidRows || []).flatMap((row) =>
        row.errors.map((message) => ({ row: row.rowNumber, message })),
      ),
    ].slice(0, 25),
    canImport: Boolean(parsed && parsed.validRows.length > 0 && mappingErrors.length === 0),
  };
}

export async function previewStudentExcelBuffer(user: User, buffer: ArrayBuffer, mappingInput?: StudentExcelMapping | null) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const parsed = parseStudentWorksheet(workbook, { mapping: mappingInput || null });
  const sheetError = buildStudentSheetError(parsed);
  const mapping = parsed ? columnMapToMapping(parsed.headerRow, parsed.columnMap) : null;
  const mappingErrors = mapping ? validateStudentExcelMapping(mapping) : ['No se pudo leer la planilla.'];

  return {
    sheetName: parsed?.sheetName || null,
    headerRow: parsed?.headerRow || 0,
    detectedHeaders: parsed?.detectedHeaders || [],
    availableColumns: (parsed?.detectedHeaders || []).map((label, index) => ({ index, label: label || `Columna ${index + 1}` })),
    mapping: mapping ? serializeMappingForClient(mapping) : null,
    mappableFields: STUDENT_MAPPABLE_FIELDS,
    mappingErrors,
    requiresMapping: Boolean(parsed?.requiresMapping),
    columnMap: parsed?.columnMap || {},
    totalRows: parsed?.rows.length || 0,
    validRows: parsed?.validRows.length || 0,
    invalidRows: parsed?.invalidRows.length || 0,
    preview: (parsed?.validRows || []).slice(0, 5).map((row) => ({
      row: row.rowNumber,
      escuela: row.escuela,
      curso: row.curso,
      turno: row.turno,
      nombre: row.nombre,
      dni: row.dni,
      materias: Array.isArray(row.materias) ? row.materias.join(', ') : (row.materias || ''),
    })),
    errors: [
      ...(sheetError ? [{ row: 0, message: sheetError }] : []),
      ...(parsed?.mappingErrors || []).map((message) => ({ row: 0, message })),
      ...(parsed?.invalidRows || []).flatMap((row) =>
        row.errors.map((message) => ({ row: row.rowNumber, message })),
      ),
    ].slice(0, 25),
    canImport: Boolean(parsed && parsed.validRows.length > 0 && mappingErrors.length === 0),
  };
}

export async function previewGradeExcelBuffer(user: User, buffer: ArrayBuffer, mappingInput?: GradeExcelMapping | null) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const parsed = parseGradeWorksheet(workbook, { mapping: mappingInput || null });
  const sheetError = buildGradeSheetError(parsed);
  const mapping = parsed ? gradeColumnMapToMapping(parsed.headerRow, parsed.columnMap) : null;
  const mappingErrors = mapping ? validateGradeExcelMapping(mapping) : ['No se pudo leer la planilla.'];

  return {
    sheetName: parsed?.sheetName || null,
    headerRow: parsed?.headerRow || 0,
    detectedHeaders: parsed?.detectedHeaders || [],
    availableColumns: (parsed?.detectedHeaders || []).map((label, index) => ({ index, label: label || `Columna ${index + 1}` })),
    mapping: mapping ? serializeGradeMappingForClient(mapping) : null,
    mappableFields: GRADE_MAPPABLE_FIELDS,
    mappingErrors,
    requiresMapping: Boolean(parsed?.requiresMapping),
    columnMap: parsed?.columnMap || {},
    totalRows: parsed?.rows.length || 0,
    validRows: parsed?.validRows.length || 0,
    invalidRows: parsed?.invalidRows.length || 0,
    preview: (parsed?.validRows || []).slice(0, 5).map((row) => ({
      row: row.rowNumber,
      fecha: row.fecha,
      escuela: row.escuela,
      curso: row.curso,
      turno: row.turno,
      materia: row.materia,
      nombre: row.nombre,
      dni: row.dni,
      evaluacion: row.evaluacion,
      calificacion: row.calificacion,
    })),
    errors: [
      ...(sheetError ? [{ row: 0, message: sheetError }] : []),
      ...(parsed?.mappingErrors || []).map((message) => ({ row: 0, message })),
      ...(parsed?.invalidRows || []).flatMap((row) =>
        row.errors.map((message) => ({ row: row.rowNumber, message })),
      ),
    ].slice(0, 25),
    canImport: Boolean(parsed && parsed.validRows.length > 0 && mappingErrors.length === 0),
  };
}

export function parseStudentImportMapping(raw: FormDataEntryValue | null) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return parseStudentExcelMappingJson(raw);
}

export function parseAttendanceImportMapping(raw: FormDataEntryValue | null) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return parseAttendanceExcelMappingJson(raw);
}

export function parseGradeImportMapping(raw: FormDataEntryValue | null) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return parseGradeExcelMappingJson(raw);
}

export async function previewExcelBuffer(
  user: User,
  type: ExcelImportType,
  buffer: ArrayBuffer,
  mappingInput?: StudentExcelMapping | AttendanceExcelMapping | GradeExcelMapping | null,
) {
  if (type === 'alumnos') {
    return previewStudentExcelBuffer(user, buffer, mappingInput as StudentExcelMapping | null);
  }
  if (type === 'asistencias') {
    return previewAttendanceExcelBuffer(user, buffer, mappingInput as AttendanceExcelMapping | null);
  }
  if (type === 'notas') {
    return previewGradeExcelBuffer(user, buffer, mappingInput as GradeExcelMapping | null);
  }
  throw new Error(`Vista previa no disponible para ${type}.`);
}

export async function importExcelBuffer(
  user: User,
  type: ExcelImportType,
  buffer: ArrayBuffer,
  mappingInput?: StudentExcelMapping | AttendanceExcelMapping | GradeExcelMapping | null,
  options: ImportExcelOptions = {},
): Promise<ImportResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const cicloLectivo = resolveImportCicloLectivo(options.cicloLectivo);

  if (type === 'alumnos') {
    const parsed = parseStudentWorksheet(workbook, { mapping: mappingInput || null });
    const sheetError = buildStudentSheetError(parsed);
    const mappingErrors = parsed ? validateStudentExcelMapping(columnMapToMapping(parsed.headerRow, parsed.columnMap)) : ['No se pudo leer la planilla.'];
    if (!parsed || sheetError) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        cicloLectivo,
        errors: [{ row: 0, message: sheetError || mappingErrors[0] || 'No se pudo leer la planilla de alumnos.' }],
      };
    }

    if (mappingErrors.length) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        cicloLectivo,
        errors: [{ row: 0, message: mappingErrors[0] }],
      };
    }

    if (parsed.rows.length > EXCEL_IMPORT_LIMITS.maxRows) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        cicloLectivo,
        errors: [{ row: 0, message: `El archivo supera el máximo de ${EXCEL_IMPORT_LIMITS.maxRows} filas.` }],
      };
    }

    const errors: ImportRowError[] = [];
    const counts = await importStudentRows(user, parsed.rows, errors, cicloLectivo);
    if (counts.imported + counts.updated === 0 && errors.length === 0) {
      errors.push({
        row: 0,
        message: 'No se importó ninguna fila. Revisá el mapeo de columnas y que haya datos debajo del encabezado.',
      });
    }
    return { ...counts, errors };
  }

  if (type === 'asistencias') {
    const parsed = parseAttendanceWorksheet(workbook, { mapping: mappingInput as AttendanceExcelMapping | null });
    const sheetError = buildAttendanceSheetError(parsed);
    const mappingErrors = parsed
      ? validateAttendanceExcelMapping(attendanceColumnMapToMapping(parsed.headerRow, parsed.columnMap))
      : ['No se pudo leer la planilla.'];
    if (!parsed || sheetError) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: 0, message: sheetError || mappingErrors[0] || 'No se pudo leer la planilla de asistencias.' }],
      };
    }

    if (mappingErrors.length) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: 0, message: mappingErrors[0] }],
      };
    }

    if (parsed.rows.length > EXCEL_IMPORT_LIMITS.maxRows) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: 0, message: `El archivo supera el máximo de ${EXCEL_IMPORT_LIMITS.maxRows} filas.` }],
      };
    }

    const errors: ImportRowError[] = [];
    appendInvalidRowErrors(parsed.invalidRows, errors);
    const counts = await importAttendanceFromParsed(user, parsed.validRows, errors);
    return {
      ...counts,
      skipped: counts.skipped + parsed.invalidRows.length,
      errors,
    };
  }

  if (type === 'notas') {
    const parsed = parseGradeWorksheet(workbook, { mapping: mappingInput as GradeExcelMapping | null });
    const sheetError = buildGradeSheetError(parsed);
    const mappingErrors = parsed
      ? validateGradeExcelMapping(gradeColumnMapToMapping(parsed.headerRow, parsed.columnMap))
      : ['No se pudo leer la planilla.'];
    if (!parsed || sheetError) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: 0, message: sheetError || mappingErrors[0] || 'No se pudo leer la planilla de notas.' }],
      };
    }

    if (mappingErrors.length) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: 0, message: mappingErrors[0] }],
      };
    }

    if (parsed.rows.length > EXCEL_IMPORT_LIMITS.maxRows) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: 0, message: `El archivo supera el máximo de ${EXCEL_IMPORT_LIMITS.maxRows} filas.` }],
      };
    }

    const errors: ImportRowError[] = [];
    appendInvalidRowErrors(parsed.invalidRows, errors);
    const counts = await importGradesFromParsed(user, parsed.validRows, errors);
    return {
      ...counts,
      skipped: counts.skipped + parsed.invalidRows.length,
      errors,
    };
  }

  const worksheet = pickWorksheet(workbook, type);
  if (!worksheet) {
    return { imported: 0, updated: 0, skipped: 0, errors: [{ row: 0, message: 'El archivo no contiene hojas de cálculo.' }] };
  }

  const rows = worksheetToRows(worksheet);
  if (!rows.length) {
    return { imported: 0, updated: 0, skipped: 0, errors: [{ row: 0, message: 'No hay filas de datos. La primera fila debe contener los encabezados.' }] };
  }

  if (rows.length > EXCEL_IMPORT_LIMITS.maxRows) {
    return {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: `El archivo supera el máximo de ${EXCEL_IMPORT_LIMITS.maxRows} filas.` }],
    };
  }

  const errors: ImportRowError[] = [];
  const run = db.transaction(async () => {
    if (type === 'cursos') return await importCourses(user, rows, errors);
    return await importGrades(user, rows, errors);
  });

  const counts = await run();
  return { ...counts, errors };
}

export const IMPORT_REQUIREMENTS: Record<ExcelImportType, { sheet: string; columns: string[]; notes: string[] }> = {
  cursos: {
    sheet: 'Cursos',
    columns: ['Escuela', 'Curso', 'Turno', 'Ciclo lectivo (opcional)'],
    notes: [
      'Formato: .xlsx con hoja "Cursos" (o la primera hoja).',
      'Turno debe ser: Mañana, Tarde o Noche.',
      'Si la escuela no existe, se crea automáticamente.',
      'Cursos repetidos (misma escuela, curso y turno) se actualizan.',
    ],
  },
  alumnos: {
    sheet: STUDENT_EXCEL_SHEET,
    columns: STUDENT_EXCEL_COLUMNS.map((column) => column.label),
    notes: [...STUDENT_EXCEL_NOTES],
  },
  asistencias: {
    sheet: 'Asistencias',
    columns: ['Fecha', 'Colegio', 'Curso', 'Turno', 'Materia', 'Alumno', 'Estado'],
    notes: [
      'Fecha en formato AAAA-MM-DD o fecha de Excel.',
      'Estado: Presente o Ausente.',
      'Curso, materia y alumno deben existir y coincidir exactamente con los nombres cargados.',
    ],
  },
  notas: {
    sheet: 'Notas',
    columns: [
      'Fecha',
      'Colegio',
      'Curso',
      'Turno',
      'Materia',
      'Alumno',
      'Evaluacion',
      'Calificacion',
      'Importancia (opcional)',
      'Entrega (opcional)',
      'Motivo (opcional)',
      'Tipo (opcional)',
      'Periodo (opcional)',
    ],
    notes: [
      'Calificación: número del 1 al 10 o texto (S/C, Ausente, etc.).',
      'Importancia: Alta (100), Media (60) o Baja (40).',
      'Periodo: 1c, 2c, anual, recuperatorio o previa.',
    ],
  },
};

export async function buildImportTemplate(type: ExcelImportType): Promise<ArrayBuffer> {
  const spec = IMPORT_REQUIREMENTS[type];
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(spec.sheet);

  worksheet.columns = spec.columns.map((header) => ({
    header,
    key: header,
    width: Math.max(16, header.length + 2),
  }));

  const examples: Record<ExcelImportType, Record<string, string | number>[]> = {
    cursos: [{ Escuela: 'Escuela Técnica 1', Curso: '6to 1ra', Turno: 'Mañana', 'Ciclo lectivo (opcional)': new Date().getFullYear() }],
    alumnos: STUDENT_EXCEL_EXAMPLE_ROWS.map((row) => ({ ...row })),
    asistencias: [{
      Fecha: '2026-06-16',
      Colegio: 'Escuela Técnica 1',
      Curso: '6to 1ra',
      Turno: 'Mañana',
      Materia: 'Programación',
      Alumno: 'Martina Ruiz',
      Estado: 'Presente',
    }],
    notas: [{
      Fecha: '2026-06-16',
      Colegio: 'Escuela Técnica 1',
      Curso: '6to 1ra',
      Turno: 'Mañana',
      Materia: 'Programación',
      Alumno: 'Martina Ruiz',
      Evaluacion: 'TP 1 - HTML',
      Calificacion: 8,
      'Importancia (opcional)': 'Media',
      'Entrega (opcional)': '2026-06-20',
      'Motivo (opcional)': '',
      'Tipo (opcional)': 'TP',
      'Periodo (opcional)': '1c',
    }],
  };

  worksheet.addRows(examples[type]);
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF226C5F' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  if (type === 'alumnos') {
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: examples.alumnos.length + 1, column: STUDENT_EXCEL_COLUMNS.length },
    };
  }

  const instrucciones = workbook.addWorksheet('Referencia');
  instrucciones.addRow(['Cómo cargar alumnos desde Excel']);
  instrucciones.addRow(['']);
  instrucciones.addRow(['Columnas']);
  instrucciones.addRow(STUDENT_EXCEL_COLUMNS.map((column) => column.label));
  STUDENT_EXCEL_EXAMPLE_ROWS.forEach((row) => {
    instrucciones.addRow(STUDENT_EXCEL_COLUMNS.map((column) => row[column.label as keyof typeof row] ?? ''));
  });
  instrucciones.addRow(['']);
  instrucciones.addRow(['Notas']);
  spec.notes.forEach((note) => instrucciones.addRow([note]));

  instrucciones.getRow(3).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF226C5F' } };
  });
  STUDENT_EXCEL_COLUMNS.forEach((column, index) => {
    const width = Math.max(14, column.label.length + column.hint.length / 2);
    instrucciones.getColumn(index + 1).width = width;
  });

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
