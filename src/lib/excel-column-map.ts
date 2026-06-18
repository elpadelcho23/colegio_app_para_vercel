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
