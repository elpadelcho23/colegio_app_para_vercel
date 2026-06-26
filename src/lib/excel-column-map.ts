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
  escuela: ['escuela', 'colegio', 'institucion', 'institución', 'establecimiento', 'centro educativo'],
  curso: ['curso', 'division', 'división', 'ano', 'año', 'grado', 'seccion', 'sección', 'salon', 'salón'],
  turno: ['turno', 'jornada', 'horario'],
  nombre: [
    'nombre',
    'nombres',
    'alumno',
    'alumna',
    'estudiante',
    'nombre completo',
    'nombre y apellido',
    'apellido y nombre',
    'apellidos y nombres',
  ],
  apellido: ['apellido', 'apellidos', 'lastname', 'last name', 'surname'],
  dni: ['dni', 'documento', 'n documento', 'n° documento', 'legajo', 'nro documento', 'numero documento'],
  tutor: ['tutor', 'contacto', 'responsable', 'madre', 'padre', 'apoderado', 'telefono', 'teléfono'],
  materias: ['materias', 'materia', 'asignaturas', 'asignatura', 'catedras', 'cátedras'],
};

export function normalizeSpreadsheetHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[:#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function matchStudentField(header: string): StudentMappingField | null {
  const normalized = normalizeSpreadsheetHeader(header);
  if (!normalized) return null;

  const priority: StudentMappingField[] = ['escuela', 'curso', 'turno', 'nombre', 'apellido', 'dni', 'tutor', 'materias'];
  for (const field of priority) {
    const aliases = STUDENT_FIELD_ALIASES[field];
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      return field;
    }
  }

  return null;
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
  const required = ['escuela', 'curso', 'turno', 'nombre'] as const;
  const requiredHits = required.filter((field) => mapped.has(field)).length;
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
    materias: 'Materias',
  };
  return fields.map((field) => labels[field]).join(', ');
}

export function buildColumnMapFromHeaders(headers: string[]) {
  const columnMap: Partial<Record<StudentMappingField, number>> = {};
  headers.forEach((header, index) => {
    const field = matchStudentField(header);
    if (field && columnMap[field] == null) columnMap[field] = index;
  });
  return columnMap;
}

export type AttendanceMappingField =
  | 'fecha'
  | 'escuela'
  | 'curso'
  | 'turno'
  | 'materia'
  | 'nombre'
  | 'estado';

const ATTENDANCE_FIELD_ALIASES: Record<AttendanceMappingField, string[]> = {
  fecha: ['fecha', 'dia', 'día', 'date', 'fch'],
  escuela: ['escuela', 'colegio', 'institucion', 'institución', 'establecimiento'],
  curso: ['curso', 'division', 'división', 'grado', 'seccion', 'sección', 'salon', 'salón'],
  turno: ['turno', 'jornada', 'horario'],
  materia: ['materia', 'asignatura', 'catedra', 'cátedra', 'materia asignatura'],
  nombre: ['alumno', 'alumna', 'nombre', 'estudiante', 'nombre completo', 'apellido y nombre'],
  estado: ['estado', 'asistencia', 'presentismo', 'condicion', 'condición', 'presente ausente'],
};

export function matchAttendanceField(header: string): AttendanceMappingField | null {
  const normalized = normalizeSpreadsheetHeader(header);
  if (!normalized) return null;

  const priority: AttendanceMappingField[] = ['fecha', 'escuela', 'curso', 'turno', 'materia', 'nombre', 'estado'];
  for (const field of priority) {
    const aliases = ATTENDANCE_FIELD_ALIASES[field];
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      return field;
    }
  }
  return null;
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

export function buildAttendanceColumnMapFromHeaders(headers: string[]) {
  const columnMap: Partial<Record<AttendanceMappingField, number>> = {};
  headers.forEach((header, index) => {
    const field = matchAttendanceField(header);
    if (field && columnMap[field] == null) columnMap[field] = index;
  });
  return columnMap;
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
