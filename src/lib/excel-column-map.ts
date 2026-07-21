export type StudentField =
  | 'escuela'
  | 'curso'
  | 'turno'
  | 'nombre'
  | 'dni'
  | 'tutor'
  | 'materias';

export type StudentMappingField = StudentField | 'apellido';

const STUDENT_FIELD_ALIASES: Record<StudentMappingField, string[]> = {
  escuela: ['escuela', 'colegio', 'institucion', 'institución', 'establecimiento', 'centro educativo', 'nombre escuela'],
  curso: ['curso', 'division', 'división', 'ano', 'año', 'grado', 'seccion', 'sección', 'salon', 'salón', 'curso division'],
  turno: ['turno', 'jornada', 'horario', 'turno escolar'],
  nombre: [
    'nombre completo',
    'nombre y apellido',
    'apellido y nombre',
    'apellidos y nombres',
    'nombre del alumno',
    'nombre alumno',
    'alumno',
    'alumna',
    'estudiante',
    'nombres',
    'nombre',
  ],
  apellido: ['apellidos', 'apellido', 'lastname', 'last name', 'surname'],
  dni: ['n documento', 'n° documento', 'nro documento', 'numero documento', 'número documento', 'documento', 'dni', 'legajo', 'cuil'],
  tutor: [
    'nombre del tutor',
    'tutor o contacto',
    'telefono tutor',
    'teléfono tutor',
    'responsable',
    'apoderado',
    'madre',
    'padre',
    'tutor',
    'contacto',
    'telefono',
    'teléfono',
  ],
  materias: ['materias', 'materia', 'asignaturas', 'asignatura', 'catedras', 'cátedras'],
};

export type AttendanceMappingField =
  | 'fecha'
  | 'escuela'
  | 'curso'
  | 'turno'
  | 'materia'
  | 'nombre'
  | 'dni'
  | 'estado';

const ATTENDANCE_FIELD_ALIASES: Record<AttendanceMappingField, string[]> = {
  fecha: ['fecha asistencia', 'fecha', 'dia', 'día', 'date', 'fch'],
  escuela: ['escuela', 'colegio', 'institucion', 'institución', 'establecimiento'],
  curso: ['curso', 'division', 'división', 'grado', 'seccion', 'sección', 'salon', 'salón'],
  turno: ['turno', 'jornada', 'horario'],
  materia: ['materia asignatura', 'materia', 'asignatura', 'catedra', 'cátedra'],
  nombre: ['nombre completo', 'apellido y nombre', 'nombre alumno', 'alumno', 'alumna', 'estudiante', 'nombre'],
  dni: ['n documento', 'n° documento', 'nro documento', 'numero documento', 'número documento', 'documento', 'dni', 'legajo', 'cuil'],
  estado: ['presente ausente', 'asistencia', 'presentismo', 'condicion', 'condición', 'estado'],
};

export type GradeMappingField =
  | 'fecha'
  | 'escuela'
  | 'curso'
  | 'turno'
  | 'materia'
  | 'nombre'
  | 'dni'
  | 'evaluacion'
  | 'calificacion'
  | 'importancia'
  | 'entrega'
  | 'motivo'
  | 'tipo'
  | 'periodo';

const GRADE_FIELD_ALIASES: Record<GradeMappingField, string[]> = {
  fecha: ['fecha evaluacion', 'fecha evaluación', 'fecha', 'date'],
  escuela: ['escuela', 'colegio', 'institucion', 'institución', 'establecimiento'],
  curso: ['curso', 'division', 'división', 'grado', 'seccion', 'sección'],
  turno: ['turno', 'jornada'],
  materia: ['materia', 'asignatura', 'catedra', 'cátedra'],
  nombre: ['nombre completo', 'apellido y nombre', 'alumno', 'alumna', 'estudiante', 'nombre'],
  dni: ['n documento', 'n° documento', 'nro documento', 'numero documento', 'número documento', 'documento', 'dni', 'legajo', 'cuil'],
  evaluacion: ['titulo evaluacion', 'título evaluación', 'evaluacion', 'evaluación', 'trabajo practico', 'trabajo práctico', 'tp', 'actividad'],
  calificacion: ['calificacion', 'calificación', 'nota', 'puntaje', 'resultado'],
  importancia: ['importancia', 'peso', 'ponderacion', 'ponderación'],
  entrega: ['fecha entrega', 'entrega'],
  motivo: ['motivo', 'observacion', 'observación', 'comentario'],
  tipo: ['tipo evaluacion', 'tipo evaluación', 'tipo'],
  periodo: ['periodo', 'período', 'cuatrimestre', 'trimestre'],
};

/** Comparación sin acentos ni mayúsculas (match suave de nombres). */
export function normalizeComparableText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeSpreadsheetHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[:#._/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenize(value: string) {
  return normalizeSpreadsheetHeader(value).split(' ').filter(Boolean);
}

/**
 * Score de coincidencia header↔campo.
 * Exacto > tokens exactos > alias contenido con word-boundary (prioriza aliases largos).
 */
export function scoreHeaderAgainstAliases(header: string, aliases: string[]): number {
  const normalized = normalizeSpreadsheetHeader(header);
  if (!normalized) return 0;
  const headerTokens = new Set(tokenize(normalized));
  let best = 0;

  const sorted = [...aliases].sort((a, b) => b.length - a.length);
  for (const alias of sorted) {
    const aliasNorm = normalizeSpreadsheetHeader(alias);
    if (!aliasNorm) continue;

    if (normalized === aliasNorm) {
      best = Math.max(best, 100 + aliasNorm.length);
      continue;
    }

    const aliasTokens = tokenize(aliasNorm);
    if (aliasTokens.length && aliasTokens.every((token) => headerTokens.has(token))) {
      // Evita que "nombre" gane sobre "nombre del tutor"
      const coverage = aliasTokens.length / Math.max(headerTokens.size, 1);
      best = Math.max(best, 70 + aliasNorm.length + coverage * 10);
      continue;
    }

    // Contención solo si el alias es suficientemente específico (≥4 chars) y delimitable
    if (aliasNorm.length >= 4) {
      const re = new RegExp(`(?:^|\\s)${aliasNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
      if (re.test(normalized)) {
        best = Math.max(best, 40 + aliasNorm.length);
      }
    }
  }

  return best;
}

function bestFieldForHeader<T extends string>(
  header: string,
  aliasesByField: Record<T, string[]>,
  priority: T[],
): { field: T; score: number } | null {
  let winner: { field: T; score: number } | null = null;
  for (const field of priority) {
    const score = scoreHeaderAgainstAliases(header, aliasesByField[field]);
    if (score <= 0) continue;
    if (!winner || score > winner.score || (score === winner.score && priority.indexOf(field) < priority.indexOf(winner.field))) {
      winner = { field, score };
    }
  }
  return winner && winner.score >= 40 ? winner : null;
}

export function matchStudentField(header: string): StudentMappingField | null {
  // Tutor antes que nombre en la evaluación global: el scorer ya prioriza aliases más largos
  const priority: StudentMappingField[] = ['tutor', 'apellido', 'dni', 'escuela', 'curso', 'turno', 'materias', 'nombre'];
  return bestFieldForHeader(header, STUDENT_FIELD_ALIASES, priority)?.field || null;
}

export function matchAttendanceField(header: string): AttendanceMappingField | null {
  const priority: AttendanceMappingField[] = ['fecha', 'estado', 'dni', 'materia', 'escuela', 'curso', 'turno', 'nombre'];
  return bestFieldForHeader(header, ATTENDANCE_FIELD_ALIASES, priority)?.field || null;
}

export function matchGradeField(header: string): GradeMappingField | null {
  const priority: GradeMappingField[] = [
    'calificacion', 'evaluacion', 'fecha', 'entrega', 'periodo', 'tipo', 'importancia', 'motivo', 'dni',
    'materia', 'escuela', 'curso', 'turno', 'nombre',
  ];
  return bestFieldForHeader(header, GRADE_FIELD_ALIASES, priority)?.field || null;
}

/** Inferencia por contenido de muestra (refuerza DNI, fecha, estado, turno). */
export function inferFieldFromSamples(samples: Array<string | number | null>): {
  dni?: number;
  fecha?: number;
  estado?: number;
  turno?: number;
  calificacion?: number;
} {
  const texts = samples.map((value) => String(value ?? '').trim()).filter(Boolean);
  if (!texts.length) return {};

  let dniHits = 0;
  let fechaHits = 0;
  let estadoHits = 0;
  let turnoHits = 0;
  let notaHits = 0;

  for (const text of texts.slice(0, 12)) {
    const digits = text.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 11) dniHits += 1;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) fechaHits += 1;
    if (/^(p|a|presente|ausente|falta|si|sí|no)$/i.test(text)) estadoHits += 1;
    if (/^(manana|mañana|tarde|noche|m|t|n)$/i.test(normalizeSpreadsheetHeader(text))) turnoHits += 1;
    const numeric = Number(text.replace(',', '.'));
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 10) notaHits += 1;
  }

  const n = Math.min(texts.length, 12);
  return {
    dni: dniHits / n,
    fecha: fechaHits / n,
    estado: estadoHits / n,
    turno: turnoHits / n,
    calificacion: notaHits / n,
  };
}

export function mergeStudentNombre(apellidoRaw: string | number | null, nombreRaw: string | number | null) {
  const apellido = String(apellidoRaw ?? '').trim();
  const nombre = String(nombreRaw ?? '').trim();
  if (apellido && nombre) {
    const lowerNombre = nombre.toLowerCase();
    const lowerApellido = apellido.toLowerCase();
    if (lowerNombre.includes(lowerApellido)) return nombre;
    if (lowerApellido.includes(lowerNombre)) return apellido;
    return `${apellido} ${nombre}`.trim();
  }
  return apellido || nombre;
}

export function scoreStudentHeaderRow(cells: string[]) {
  const mapped = new Set<StudentMappingField>();
  for (const cell of cells) {
    const field = matchStudentField(cell);
    if (field) mapped.add(field);
  }
  const hasNombre = mapped.has('nombre') || mapped.has('apellido');
  const requiredCore = ['escuela', 'curso', 'turno'] as const;
  const requiredHits = requiredCore.filter((field) => mapped.has(field)).length + (hasNombre ? 1 : 0);
  return requiredHits * 10 + mapped.size;
}

export const STUDENT_REQUIRED_FIELDS: StudentField[] = ['escuela', 'curso', 'turno', 'nombre'];

export function normalizeTurnoValue(value: string | number | null): string | null {
  const text = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (!text) return null;

  const aliases: Record<string, 'Mañana' | 'Tarde' | 'Noche'> = {
    manana: 'Mañana',
    mañana: 'Mañana',
    m: 'Mañana',
    matutino: 'Mañana',
    matutina: 'Mañana',
    tm: 'Mañana',
    tarde: 'Tarde',
    t: 'Tarde',
    vespertino: 'Tarde',
    vespertina: 'Tarde',
    tt: 'Tarde',
    noche: 'Noche',
    n: 'Noche',
    nocturno: 'Noche',
    nocturna: 'Noche',
    tn: 'Noche',
  };

  if (aliases[text]) return aliases[text];
  if (text.includes('manana') || text.includes('matutin')) return 'Mañana';
  if (text.includes('tarde') || text.includes('vespert')) return 'Tarde';
  if (text.includes('noche') || text.includes('nocturn')) return 'Noche';

  return null;
}

export function normalizeDniValue(value: string | number | null): string | null {
  if (value === null || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  return digits || null;
}

export function splitMateriasValue(value: string | number | null) {
  return String(value ?? '')
    .split(/[,;|/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function missingStudentFields(record: Partial<Record<StudentField, string | null>>) {
  return STUDENT_REQUIRED_FIELDS.filter((field) => !String(record[field] ?? '').trim());
}

export function describeMissingStudentFields(fields: StudentField[]) {
  const labels: Record<StudentField, string> = {
    escuela: 'Escuela',
    curso: 'Curso',
    turno: 'Turno',
    nombre: 'Nombre',
    dni: 'DNI',
    tutor: 'Tutor',
    materias: 'Materia',
  };
  return fields.map((field) => labels[field]).join(', ');
}

export function buildColumnMapFromHeaders(headers: string[]) {
  return buildScoredColumnMap(headers, matchStudentField, STUDENT_FIELD_ALIASES);
}

export function buildAttendanceColumnMapFromHeaders(headers: string[]) {
  return buildScoredColumnMap(headers, matchAttendanceField, ATTENDANCE_FIELD_ALIASES);
}

export function buildGradeColumnMapFromHeaders(headers: string[]) {
  return buildScoredColumnMap(headers, matchGradeField, GRADE_FIELD_ALIASES);
}

function buildScoredColumnMap<T extends string>(
  headers: string[],
  matcher: (header: string) => T | null,
  aliasesByField: Record<T, string[]>,
) {
  type Cand = { field: T; index: number; score: number };
  const candidates: Cand[] = [];

  headers.forEach((header, index) => {
    const field = matcher(header);
    if (!field) return;
    const score = scoreHeaderAgainstAliases(header, aliasesByField[field] || []);
    candidates.push({ field, index, score: score || 1 });
  });

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const columnMap: Partial<Record<T, number>> = {};
  for (const candidate of candidates) {
    if (columnMap[candidate.field] == null) columnMap[candidate.field] = candidate.index;
  }
  return columnMap;
}

/**
 * Refuerza un mapa usando muestras de filas (p. ej. columna con DNIs → campo dni).
 */
export function reinforceStudentMapWithSamples(
  headers: string[],
  columnMap: Partial<Record<StudentMappingField, number>>,
  sampleRows: Array<Array<string | number | null>>,
) {
  const next = { ...columnMap };
  const used = new Set(Object.values(next).filter((value): value is number => typeof value === 'number'));

  headers.forEach((_header, index) => {
    if (used.has(index)) return;
    const samples = sampleRows.map((row) => row[index] ?? null);
    const inferred = inferFieldFromSamples(samples);
    if ((inferred.dni || 0) >= 0.6 && next.dni == null) {
      next.dni = index;
      used.add(index);
      return;
    }
    if ((inferred.turno || 0) >= 0.6 && next.turno == null) {
      next.turno = index;
      used.add(index);
    }
  });
  return next;
}

export function reinforceAttendanceMapWithSamples(
  headers: string[],
  columnMap: Partial<Record<AttendanceMappingField, number>>,
  sampleRows: Array<Array<string | number | null>>,
) {
  const next = { ...columnMap };
  const used = new Set(Object.values(next).filter((value): value is number => typeof value === 'number'));

  headers.forEach((_header, index) => {
    if (used.has(index)) return;
    const samples = sampleRows.map((row) => row[index] ?? null);
    const inferred = inferFieldFromSamples(samples);
    if ((inferred.fecha || 0) >= 0.6 && next.fecha == null) {
      next.fecha = index;
      used.add(index);
      return;
    }
    if ((inferred.estado || 0) >= 0.6 && next.estado == null) {
      next.estado = index;
      used.add(index);
      return;
    }
    if ((inferred.turno || 0) >= 0.6 && next.turno == null) {
      next.turno = index;
      used.add(index);
      return;
    }
    if ((inferred.dni || 0) >= 0.6 && next.dni == null) {
      next.dni = index;
      used.add(index);
    }
  });
  return next;
}

export function reinforceGradeMapWithSamples(
  headers: string[],
  columnMap: Partial<Record<GradeMappingField, number>>,
  sampleRows: Array<Array<string | number | null>>,
) {
  const next = { ...columnMap };
  const used = new Set(Object.values(next).filter((value): value is number => typeof value === 'number'));

  headers.forEach((_header, index) => {
    if (used.has(index)) return;
    const samples = sampleRows.map((row) => row[index] ?? null);
    const inferred = inferFieldFromSamples(samples);
    if ((inferred.fecha || 0) >= 0.6 && next.fecha == null) {
      next.fecha = index;
      used.add(index);
      return;
    }
    if ((inferred.calificacion || 0) >= 0.6 && next.calificacion == null) {
      next.calificacion = index;
      used.add(index);
      return;
    }
    if ((inferred.turno || 0) >= 0.6 && next.turno == null) {
      next.turno = index;
      used.add(index);
      return;
    }
    if ((inferred.dni || 0) >= 0.6 && next.dni == null) {
      next.dni = index;
      used.add(index);
    }
  });
  return next;
}

export function scoreAttendanceHeaderRow(cells: string[]) {
  const mapped = new Set<AttendanceMappingField>();
  for (const cell of cells) {
    const field = matchAttendanceField(cell);
    if (field) mapped.add(field);
  }
  const required = ['fecha', 'escuela', 'curso', 'turno', 'materia', 'nombre', 'estado'] as const;
  const requiredHits = required.filter((field) => mapped.has(field)).length;
  return requiredHits * 10 + mapped.size;
}

export function scoreGradeHeaderRow(cells: string[]) {
  const mapped = new Set<GradeMappingField>();
  for (const cell of cells) {
    const field = matchGradeField(cell);
    if (field) mapped.add(field);
  }
  const required = ['fecha', 'escuela', 'curso', 'turno', 'materia', 'nombre', 'evaluacion', 'calificacion'] as const;
  const requiredHits = required.filter((field) => mapped.has(field)).length;
  return requiredHits * 10 + mapped.size;
}

export function parseSpreadsheetDate(value: string | number | null): string | null {
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

export function normalizeAttendanceEstado(value: string | number | null): 'presente' | 'ausente' | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'presente' || text === 'p' || text === 'si' || text === 'sí') return 'presente';
  if (text === 'ausente' || text === 'a' || text === 'falta' || text === 'no') return 'ausente';
  return null;
}

export const STUDENT_FIELD_LIST = Object.keys(STUDENT_FIELD_ALIASES) as StudentMappingField[];
export const ATTENDANCE_FIELD_LIST = Object.keys(ATTENDANCE_FIELD_ALIASES) as AttendanceMappingField[];
export const GRADE_FIELD_LIST = Object.keys(GRADE_FIELD_ALIASES) as GradeMappingField[];
