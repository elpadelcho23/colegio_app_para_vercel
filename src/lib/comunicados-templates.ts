/** Plantillas de comunicados escolares y reemplazo de variables. */

export type ComunicadoTemplateId =
  | 'riesgo-academico'
  | 'inasistencias'
  | 'pendientes'
  | 'conducta'
  | 'personalizada'
  | string;

export type ComunicadoTemplate = {
  id: ComunicadoTemplateId;
  label: string;
  body: string;
  builtin?: boolean;
};

export type ComunicadoVariables = {
  alumno: string;
  escuela: string;
  curso: string;
  turno: string;
  materia: string;
  promedio: string;
  asistencia: string;
  fecha?: string;
};

const STORAGE_KEY = 'aula_clara_comunicado_templates';

export const COMUNICADO_VARIABLES = [
  '{alumno}',
  '{escuela}',
  '{curso}',
  '{turno}',
  '{materia}',
  '{promedio}',
  '{asistencia}',
] as const;

export const BUILTIN_COMUNICADO_TEMPLATES: ComunicadoTemplate[] = [
  {
    id: 'riesgo-academico',
    label: 'Riesgo académico (bajo promedio)',
    builtin: true,
    body: `Estimada familia de {alumno}:

Me dirijo a ustedes desde {escuela} ({curso}, turno {turno}) para informarles sobre el desempeño de {alumno} en la materia {materia}.

Al día de la fecha, el promedio es de {promedio}. Consideramos importante reforzar el acompañamiento en el hogar y coordinar estrategias de recuperación para evitar un mayor riesgo académico.

Quedo a disposición para una entrevista o para ampliar esta información.

Atentamente,
Docente a cargo`,
  },
  {
    id: 'inasistencias',
    label: 'Inasistencias acumuladas',
    builtin: true,
    body: `Estimada familia de {alumno}:

Les escribo desde {escuela} ({curso}, turno {turno}) para comunicarles la situación de asistencia de {alumno} en {materia}.

El porcentaje de asistencia registrado es de {asistencia}. Les solicitamos justificar las inasistencias y acompañar la continuidad en clase, ya que la presencia regular es clave para el seguimiento de los contenidos.

Ante cualquier consulta, pueden contactarme.

Atentamente,
Docente a cargo`,
  },
  {
    id: 'pendientes',
    label: 'Trabajos / actividades pendientes',
    builtin: true,
    body: `Estimada familia de {alumno}:

Me comunico desde {escuela} ({curso}, turno {turno}) para informarles que {alumno} registra trabajos o actividades pendientes en la materia {materia}.

Les pedimos que acompañen la entrega de lo adeudado a la brevedad. El promedio actual en la materia es {promedio} y la asistencia es {asistencia}.

Quedo disponible para aclarar consignas o fechas de recuperación.

Atentamente,
Docente a cargo`,
  },
  {
    id: 'conducta',
    label: 'Observación de conducta / convivencia',
    builtin: true,
    body: `Estimada familia de {alumno}:

Me dirijo a ustedes desde {escuela} ({curso}, turno {turno}) para compartir una observación vinculada a la convivencia escolar de {alumno} en el espacio de {materia}.

Consideramos importante dialogar en casa sobre el respeto de las normas del aula y el cuidado del clima de trabajo. El seguimiento académico actual es: promedio {promedio}, asistencia {asistencia}.

Quedo a disposición para una reunión si lo consideran necesario.

Atentamente,
Docente a cargo`,
  },
  {
    id: 'personalizada',
    label: 'Personalizada (texto libre)',
    builtin: true,
    body: `Estimada familia de {alumno}:

Me comunico desde {escuela} ({curso}, turno {turno}) en relación con {alumno} y la materia {materia}.

Promedio: {promedio}
Asistencia: {asistencia}

[Escribí acá el mensaje]

Atentamente,
Docente a cargo`,
  },
];

export function formatComunicadoDate(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function applyComunicadoTemplate(
  template: string,
  vars: Partial<ComunicadoVariables>,
): string {
  const values: ComunicadoVariables = {
    alumno: vars.alumno || '—',
    escuela: vars.escuela || '—',
    curso: vars.curso || '—',
    turno: vars.turno || '—',
    materia: vars.materia || '—',
    promedio: vars.promedio || '—',
    asistencia: vars.asistencia || '—',
    fecha: vars.fecha || formatComunicadoDate(),
  };

  return String(template || '').replace(/\{([a-zA-ZáéíóúñÁÉÍÓÚÑ_]+)\}/g, (match, key) => {
    const normalized = String(key || '').toLowerCase();
    if (normalized in values) {
      return String(values[normalized as keyof ComunicadoVariables] ?? match);
    }
    return match;
  });
}

function storageKeyForUser(userId = '') {
  return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

export function readCustomComunicadoTemplates(userId = ''): ComunicadoTemplate[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKeyForUser(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object' && item.id && item.label && item.body)
      .map((item) => ({
        id: String(item.id),
        label: String(item.label),
        body: String(item.body),
        builtin: false,
      }));
  } catch {
    return [];
  }
}

export function writeCustomComunicadoTemplates(templates: ComunicadoTemplate[], userId = '') {
  if (typeof localStorage === 'undefined') return;
  const clean = templates
    .filter((item) => !item.builtin)
    .map((item) => ({
      id: String(item.id),
      label: String(item.label).trim(),
      body: String(item.body),
    }))
    .filter((item) => item.label && item.body);
  localStorage.setItem(storageKeyForUser(userId), JSON.stringify(clean));
}

export function listComunicadoTemplates(userId = ''): ComunicadoTemplate[] {
  return [...BUILTIN_COMUNICADO_TEMPLATES, ...readCustomComunicadoTemplates(userId)];
}

export function getComunicadoTemplate(id: string, userId = ''): ComunicadoTemplate | null {
  return listComunicadoTemplates(userId).find((item) => item.id === id) || null;
}

export function saveCustomComunicadoTemplate(
  input: { label: string; body: string; id?: string },
  userId = '',
): ComunicadoTemplate {
  const label = String(input.label || '').trim();
  const body = String(input.body || '').trim();
  if (!label || !body) {
    throw new Error('Completá un nombre y el texto de la plantilla.');
  }

  const customs = readCustomComunicadoTemplates(userId);
  const id = input.id || `custom-${Date.now().toString(16)}`;
  const next: ComunicadoTemplate = { id, label, body, builtin: false };
  const index = customs.findIndex((item) => item.id === id);
  if (index >= 0) customs[index] = next;
  else customs.push(next);
  writeCustomComunicadoTemplates(customs, userId);
  return next;
}

export function deleteCustomComunicadoTemplate(id: string, userId = '') {
  const next = readCustomComunicadoTemplates(userId).filter((item) => item.id !== id);
  writeCustomComunicadoTemplates(next, userId);
}
