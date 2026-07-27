import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db, ensureTeachingContextRows, type User } from './db';

export const INTENTO_COOKIE = 'aula_clara_intento';

export type AulaModo = 'multiple_choice' | 'actividad_preguntas' | 'examen';
export type PreguntaTipo = 'mc_single' | 'mc_multi' | 'corta' | 'abierta';

export type AntiTrampaConfig = {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  oneAtATime: boolean;
  lockNavigation: boolean;
  maxFocusLoss: number;
  actionOnFocusLimit: 'flag' | 'block' | 'autosubmit';
  blockClipboard: boolean;
  watermark: boolean;
  hideResultsUntilClose: boolean;
};

export type PreguntaInput = {
  id?: string;
  tipo: PreguntaTipo;
  enunciado: string;
  opciones?: Array<{ id?: string; texto: string }>;
  correctas?: string[];
  puntaje?: number;
  explicacion?: string;
};

export type PreguntaRow = {
  id: string;
  actividad_id: string;
  orden: number;
  tipo: PreguntaTipo;
  enunciado: string;
  opciones_json: string | null;
  correctas_json: string | null;
  puntaje: number;
  explicacion: string | null;
};

export type AulaRow = {
  id: string;
  tenant_id: string;
  docente_id: string;
  actividad_id: string;
  curso_id: string;
  join_token: string;
  modo: AulaModo;
  duracion_minutos: number;
  expires_at: string;
  estado: 'abierta' | 'cerrada';
  anti_trampa_json: string;
  mostrar_nota_al_alumno: number;
  titulo: string | null;
  publicada?: number;
};

export type IntentoRow = {
  id: string;
  tenant_id: string;
  aula_id: string;
  alumno_id: string | null;
  nombre: string;
  apellido: string;
  nombre_key: string;
  started_at: string;
  ends_at: string;
  submitted_at: string | null;
  respuestas_json: string;
  pregunta_order_json: string | null;
  opciones_order_json: string | null;
  puntaje: number | null;
  nota_10: number | null;
  nota_id: string | null;
  flags_json: string;
  estado: 'en_curso' | 'entregado' | 'vencido' | 'bloqueado';
};

export const DEFAULT_ANTI_TRAMPA: AntiTrampaConfig = {
  shuffleQuestions: true,
  shuffleOptions: true,
  oneAtATime: false,
  lockNavigation: false,
  maxFocusLoss: 5,
  actionOnFocusLimit: 'flag',
  blockClipboard: true,
  watermark: true,
  hideResultsUntilClose: false,
};

export const EXAMEN_ANTI_TRAMPA: AntiTrampaConfig = {
  shuffleQuestions: true,
  shuffleOptions: true,
  oneAtATime: true,
  lockNavigation: true,
  maxFocusLoss: 3,
  actionOnFocusLimit: 'flag',
  blockClipboard: true,
  watermark: true,
  hideResultsUntilClose: true,
};

export function normalizeNamePart(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nombreKey(nombre: string, apellido: string) {
  return `${normalizeNamePart(apellido)}|${normalizeNamePart(nombre)}`;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function parseAntiTrampa(raw: string | null | undefined, modo?: AulaModo): AntiTrampaConfig {
  const base = modo === 'examen' ? { ...EXAMEN_ANTI_TRAMPA } : { ...DEFAULT_ANTI_TRAMPA };
  const parsed = parseJson<Partial<AntiTrampaConfig>>(raw, {});
  return {
    ...base,
    ...parsed,
    maxFocusLoss: Number.isFinite(Number(parsed.maxFocusLoss))
      ? Math.max(0, Math.min(20, Number(parsed.maxFocusLoss)))
      : base.maxFocusLoss,
    actionOnFocusLimit: ['flag', 'block', 'autosubmit'].includes(String(parsed.actionOnFocusLimit || ''))
      ? (parsed.actionOnFocusLimit as AntiTrampaConfig['actionOnFocusLimit'])
      : base.actionOnFocusLimit,
  };
}

function shuffleInPlace<T>(items: T[], seed: string) {
  let h = createHash('sha256').update(seed).digest();
  for (let i = items.length - 1; i > 0; i -= 1) {
    const n = h.readUInt32BE(0) % (i + 1);
    h = createHash('sha256').update(h).digest();
    const tmp = items[i];
    items[i] = items[n];
    items[n] = tmp;
  }
  return items;
}

function optionIds(opciones: Array<{ id: string; texto: string }>) {
  return opciones.map((item) => item.id);
}

export function replaceActividadPreguntas(
  user: User,
  actividadId: string,
  preguntas: PreguntaInput[],
) {
  const actividad = db.prepare(`
    SELECT id, tenant_id, docente_id
    FROM actividades
    WHERE id = ?
  `).get(actividadId) as { id: string; tenant_id: string; docente_id: string } | undefined;

  if (!actividad) throw new Error('Actividad no encontrada.');
  if (user.rol !== 'admin' && (actividad.tenant_id !== user.tenant_id || actividad.docente_id !== user.id)) {
    throw new Error('Sin acceso a la actividad.');
  }

  const cleaned = preguntas
    .map((item, index) => {
      const tipo = item.tipo;
      if (!['mc_single', 'mc_multi', 'corta', 'abierta'].includes(tipo)) return null;
      const enunciado = String(item.enunciado || '').trim();
      if (!enunciado) return null;

      const opciones = Array.isArray(item.opciones)
        ? item.opciones
          .map((opt, optIndex) => ({
            id: String(opt.id || `opt-${index + 1}-${optIndex + 1}`),
            texto: String(opt.texto || '').trim(),
          }))
          .filter((opt) => opt.texto)
        : [];

      if ((tipo === 'mc_single' || tipo === 'mc_multi') && opciones.length < 2) {
        throw new Error('Las preguntas de opción múltiple necesitan al menos 2 opciones.');
      }

      const correctas = Array.isArray(item.correctas)
        ? item.correctas.map(String).filter((id) => opciones.some((opt) => opt.id === id))
        : [];

      if (tipo === 'mc_single' && correctas.length !== 1) {
        throw new Error('Marcá exactamente una opción correcta en cada pregunta de opción única.');
      }
      if (tipo === 'mc_multi' && correctas.length < 1) {
        throw new Error('Marcá al menos una opción correcta en preguntas de selección múltiple.');
      }

      return {
        id: String(item.id || randomUUID()),
        orden: index,
        tipo,
        enunciado,
        opciones_json: tipo.startsWith('mc_') ? JSON.stringify(opciones) : null,
        correctas_json: tipo.startsWith('mc_') ? JSON.stringify(correctas) : null,
        puntaje: Math.max(0.5, Number(item.puntaje) || 1),
        explicacion: String(item.explicacion || '').trim() || null,
      };
    })
    .filter(Boolean) as Array<{
      id: string;
      orden: number;
      tipo: PreguntaTipo;
      enunciado: string;
      opciones_json: string | null;
      correctas_json: string | null;
      puntaje: number;
      explicacion: string | null;
    }>;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM actividad_preguntas WHERE actividad_id = ? AND tenant_id = ?')
      .run(actividadId, actividad.tenant_id);

    const insert = db.prepare(`
      INSERT INTO actividad_preguntas (
        id, tenant_id, actividad_id, orden, tipo, enunciado, opciones_json, correctas_json, puntaje, explicacion
      ) VALUES (
        @id, @tenant_id, @actividad_id, @orden, @tipo, @enunciado, @opciones_json, @correctas_json, @puntaje, @explicacion
      )
    `);

    for (const pregunta of cleaned) {
      insert.run({
        ...pregunta,
        tenant_id: actividad.tenant_id,
        actividad_id: actividadId,
      });
    }
  });

  tx();
  return listPreguntas(actividadId);
}

export function listPreguntas(actividadId: string) {
  return db.prepare(`
    SELECT id, actividad_id, orden, tipo, enunciado, opciones_json, correctas_json, puntaje, explicacion
    FROM actividad_preguntas
    WHERE actividad_id = ?
    ORDER BY orden ASC, created_at ASC
  `).all(actividadId) as PreguntaRow[];
}

export function preguntasForTeacher(actividadId: string) {
  return listPreguntas(actividadId).map((row) => ({
    id: row.id,
    tipo: row.tipo,
    enunciado: row.enunciado,
    opciones: parseJson<Array<{ id: string; texto: string }>>(row.opciones_json, []),
    correctas: parseJson<string[]>(row.correctas_json, []),
    puntaje: row.puntaje,
    explicacion: row.explicacion || '',
  }));
}

function matchAlumnoId(tenantId: string, cursoId: string, nombre: string, apellido: string) {
  const key = nombreKey(nombre, apellido);
  const [apellidoKey, nombreKeyPart] = key.split('|');
  const candidates = db.prepare(`
    SELECT id, nombre
    FROM alumnos
    WHERE tenant_id = ? AND curso_id = ? AND activo = 1
  `).all(tenantId, cursoId) as Array<{ id: string; nombre: string }>;

  const matches = candidates.filter((alumno) => {
    const full = normalizeNamePart(alumno.nombre);
    const parts = full.split(' ').filter(Boolean);
    if (!parts.length) return false;

    const asComma = full.includes(',')
      ? full.split(',').map((p) => p.trim()).filter(Boolean)
      : null;

    if (asComma && asComma.length >= 2) {
      const a = normalizeNamePart(asComma[0]);
      const n = normalizeNamePart(asComma.slice(1).join(' '));
      return a === apellidoKey && n === nombreKeyPart;
    }

    if (parts.length === 1) {
      return parts[0] === apellidoKey || parts[0] === nombreKeyPart;
    }

    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(' ');
    const firstLast = `${parts[0]} ${parts.slice(1).join(' ')}`;
    const lastFirst = `${last} ${first}`;

    return (
      (last === apellidoKey && first === nombreKeyPart)
      || (parts[0] === apellidoKey && parts.slice(1).join(' ') === nombreKeyPart)
      || full === `${apellidoKey} ${nombreKeyPart}`
      || full === `${nombreKeyPart} ${apellidoKey}`
      || lastFirst === `${apellidoKey} ${nombreKeyPart}`
      || firstLast === `${nombreKeyPart} ${apellidoKey}`
    );
  });

  if (matches.length === 1) return { alumnoId: matches[0].id, match: 'exact' as const };
  if (matches.length > 1) return { alumnoId: null, match: 'ambiguous' as const };
  return { alumnoId: null, match: 'none' as const };
}

export function createAulaTemporal(input: {
  user: User;
  actividadId: string;
  modo: AulaModo;
  duracionMinutos: number;
  expiresInHours?: number;
  antiTrampa?: Partial<AntiTrampaConfig>;
  mostrarNotaAlAlumno?: boolean;
  titulo?: string;
  preguntas?: PreguntaInput[];
  allowEmpty?: boolean;
  publicada?: boolean;
}) {
  const actividad = db.prepare(`
    SELECT id, tenant_id, docente_id, curso_id, materia_id, titulo, colegio, turno
    FROM actividades
    WHERE id = ?
  `).get(input.actividadId) as {
    id: string;
    tenant_id: string;
    docente_id: string;
    curso_id: string;
    materia_id: string;
    titulo: string;
    colegio: string;
    turno: string;
  } | undefined;

  if (!actividad) throw new Error('Actividad no encontrada.');
  if (
    input.user.rol !== 'admin'
    && (actividad.tenant_id !== input.user.tenant_id || actividad.docente_id !== input.user.id)
  ) {
    throw new Error('Sin acceso a la actividad.');
  }

  if (input.preguntas?.length) {
    replaceActividadPreguntas(input.user, actividad.id, input.preguntas);
  }

  const preguntas = listPreguntas(actividad.id);
  const allowEmpty = Boolean(input.allowEmpty);
  if (!allowEmpty && !preguntas.length) throw new Error('La actividad no tiene preguntas tipadas.');

  if (preguntas.length && input.modo === 'multiple_choice') {
    const invalid = preguntas.some((p) => p.tipo !== 'mc_single' && p.tipo !== 'mc_multi');
    if (invalid) throw new Error('El modo opción múltiple solo admite preguntas MC.');
  }

  const modo = input.modo;
  const anti = parseAntiTrampa(
    JSON.stringify({
      ...(modo === 'examen' ? EXAMEN_ANTI_TRAMPA : DEFAULT_ANTI_TRAMPA),
      ...(input.antiTrampa || {}),
    }),
    modo,
  );

  const duracion = Math.max(5, Math.min(240, Number(input.duracionMinutos) || 40));
  const expiresHours = Math.max(1, Math.min(72, Number(input.expiresInHours) || 24));
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString();
  const id = randomUUID();
  const joinToken = randomBytes(18).toString('base64url');
  const publicada = input.publicada === true || (!allowEmpty && preguntas.length > 0) ? 1 : 0;

  db.prepare(`
    INSERT INTO aulas_temporales (
      id, tenant_id, docente_id, actividad_id, curso_id, join_token, modo,
      duracion_minutos, expires_at, estado, anti_trampa_json, mostrar_nota_al_alumno, titulo, publicada
    ) VALUES (
      @id, @tenant_id, @docente_id, @actividad_id, @curso_id, @join_token, @modo,
      @duracion_minutos, @expires_at, 'abierta', @anti_trampa_json, @mostrar_nota_al_alumno, @titulo, @publicada
    )
  `).run({
    id,
    tenant_id: actividad.tenant_id,
    docente_id: actividad.docente_id,
    actividad_id: actividad.id,
    curso_id: actividad.curso_id,
    join_token: joinToken,
    modo,
    duracion_minutos: duracion,
    expires_at: expiresAt,
    anti_trampa_json: JSON.stringify(anti),
    mostrar_nota_al_alumno: input.mostrarNotaAlAlumno === false ? 0 : 1,
    titulo: String(input.titulo || actividad.titulo).trim(),
    publicada,
  });

  return getAulaForTeacher(input.user, id);
}

export function createClaseVirtual(input: {
  user: User;
  colegio: string;
  turno: string;
  cursoId: string;
  materiaId: string;
  titulo: string;
  modo: AulaModo;
  duracionMinutos: number;
  expiresInHours?: number;
  antiTrampa?: Partial<AntiTrampaConfig>;
  mostrarNotaAlAlumno?: boolean;
}) {
  const colegio = String(input.colegio || '').trim();
  const turno = String(input.turno || '').trim();
  const cursoId = String(input.cursoId || '').trim();
  const materiaId = String(input.materiaId || '').trim();
  const titulo = String(input.titulo || '').trim();
  if (!colegio || !turno || !cursoId || !materiaId || !titulo) {
    throw new Error('Completá escuela, turno, curso, materia y título de la clase.');
  }

  ensureTeachingContextRows({
    user: input.user,
    cursoId,
    materiaId,
    colegio,
    turno,
  });

  const curso = db.prepare(`
    SELECT id, tenant_id FROM cursos WHERE id = ? AND tenant_id = ?
  `).get(cursoId, input.user.tenant_id) as { id: string; tenant_id: string } | undefined;
  if (!curso) throw new Error('Curso no encontrado. Elegí un curso en “Curso actual” o crealo en Cursos.');

  const materia = db.prepare(`
    SELECT id FROM materias WHERE id = ? AND tenant_id = ?
  `).get(materiaId, input.user.tenant_id) as { id: string } | undefined;
  if (!materia) throw new Error('Materia no encontrada. Elegí una materia en “Curso actual”.');

  const actividadId = `act-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO actividades (
      id, tenant_id, docente_id, colegio, turno, curso_id, materia_id,
      tipo, titulo, estado, contenido_json, updated_at
    ) VALUES (
      @id, @tenant_id, @docente_id, @colegio, @turno, @curso_id, @materia_id,
      'evaluacion', @titulo, 'borrador', @contenido_json, @updated_at
    )
  `).run({
    id: actividadId,
    tenant_id: input.user.tenant_id,
    docente_id: input.user.id,
    colegio,
    turno,
    curso_id: cursoId,
    materia_id: materiaId,
    titulo,
    contenido_json: JSON.stringify({
      template: `aula-online-${input.modo}`,
      modoOnline: input.modo,
      digitalOnly: true,
      bloques: [],
      seguimiento: { criterios: ['Respuestas digitales', 'Corrección automática'] },
    }),
    updated_at: now,
  });

  return createAulaTemporal({
    user: input.user,
    actividadId,
    modo: input.modo,
    duracionMinutos: input.duracionMinutos,
    expiresInHours: input.expiresInHours,
    antiTrampa: input.antiTrampa,
    mostrarNotaAlAlumno: input.mostrarNotaAlAlumno,
    titulo,
    allowEmpty: true,
    publicada: false,
  });
}

export function setActividadClase(
  user: User,
  aulaId: string,
  preguntas: PreguntaInput[],
  options: { publicar?: boolean } = {},
) {
  const aula = getAulaForTeacher(user, aulaId);
  if (!preguntas?.length) throw new Error('Agregá al menos una pregunta digital.');

  if (aula.modo === 'multiple_choice') {
    const invalid = preguntas.some((p) => p.tipo !== 'mc_single' && p.tipo !== 'mc_multi');
    if (invalid) throw new Error('En opción múltiple solo se permiten preguntas MC.');
  }

  replaceActividadPreguntas(user, aula.actividadId, preguntas);

  db.prepare(`
    UPDATE aulas_temporales
    SET publicada = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(aulaId);

  // Keep content update simple without json_set
  const row = db.prepare('SELECT contenido_json FROM actividades WHERE id = ?').get(aula.actividadId) as { contenido_json: string };
  const contenido = parseJson<Record<string, unknown>>(row?.contenido_json, {});
  contenido.digitalOnly = true;
  contenido.modoOnline = aula.modo;
  contenido.bloques = preguntas.map((q) => ({ type: 'pregunta', texto: q.enunciado, puntaje: q.puntaje || 1 }));
  db.prepare('UPDATE actividades SET contenido_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(contenido), aula.actividadId);

  if (options.publicar === false) {
    db.prepare(`UPDATE aulas_temporales SET publicada = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(aulaId);
  }

  return getAulaForTeacher(user, aulaId);
}

export function publicarClase(user: User, aulaId: string) {
  const aula = getAulaForTeacher(user, aulaId);
  if (!aula.preguntas?.length) throw new Error('Primero agregá la actividad digital con preguntas.');
  db.prepare(`
    UPDATE aulas_temporales
    SET publicada = 1, estado = 'abierta', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(aulaId);
  return getAulaForTeacher(user, aulaId);
}

export function getAulaByToken(token: string) {
  const aula = db.prepare(`
    SELECT a.*, act.titulo AS actividad_titulo, act.materia_id, c.nombre AS curso_nombre, c.escuela
    FROM aulas_temporales a
    JOIN actividades act ON act.id = a.actividad_id
    JOIN cursos c ON c.id = a.curso_id
    WHERE a.join_token = ?
  `).get(token) as (AulaRow & {
    actividad_titulo: string;
    materia_id: string;
    curso_nombre: string;
    escuela: string;
  }) | undefined;

  return aula || null;
}

export function getAulaForTeacher(user: User, aulaId: string) {
  const aula = db.prepare(`
    SELECT a.*, act.titulo AS actividad_titulo, act.materia_id, c.nombre AS curso_nombre, c.escuela
    FROM aulas_temporales a
    JOIN actividades act ON act.id = a.actividad_id
    JOIN cursos c ON c.id = a.curso_id
    WHERE a.id = ?
  `).get(aulaId) as (AulaRow & {
    actividad_titulo: string;
    materia_id: string;
    curso_nombre: string;
    escuela: string;
  }) | undefined;

  if (!aula) throw new Error('Aula no encontrada.');
  if (user.rol !== 'admin' && (aula.tenant_id !== user.tenant_id || aula.docente_id !== user.id)) {
    throw new Error('Sin acceso al aula.');
  }

  const intentos = db.prepare(`
    SELECT i.*, al.nombre AS alumno_nombre
    FROM aula_intentos i
    LEFT JOIN alumnos al ON al.id = i.alumno_id
    WHERE i.aula_id = ?
    ORDER BY i.submitted_at DESC, i.started_at DESC
  `).all(aulaId) as Array<IntentoRow & { alumno_nombre: string | null }>;

  return {
    id: aula.id,
    actividadId: aula.actividad_id,
    cursoId: aula.curso_id,
    modo: aula.modo,
    titulo: aula.titulo || aula.actividad_titulo,
    actividadTitulo: aula.actividad_titulo,
    cursoNombre: aula.curso_nombre,
    escuela: aula.escuela,
    duracionMinutos: aula.duracion_minutos,
    expiresAt: aula.expires_at,
    estado: aula.estado,
    publicada: Boolean(aula.publicada),
    antiTrampa: parseAntiTrampa(aula.anti_trampa_json, aula.modo),
    mostrarNotaAlAlumno: Boolean(aula.mostrar_nota_al_alumno),
    joinToken: aula.join_token,
    joinPath: `/s/${aula.join_token}`,
    preguntas: preguntasForTeacher(aula.actividad_id),
    intentos: intentos.map((item) => ({
      id: item.id,
      nombre: item.nombre,
      apellido: item.apellido,
      alumnoId: item.alumno_id,
      alumnoNombre: item.alumno_nombre,
      startedAt: item.started_at,
      endsAt: item.ends_at,
      submittedAt: item.submitted_at,
      estado: item.estado,
      puntaje: item.puntaje,
      nota10: item.nota_10,
      flags: parseJson<Array<Record<string, unknown>>>(item.flags_json, []),
      respuestas: parseJson<Record<string, unknown>>(item.respuestas_json, {}),
    })),
  };
}

export function listAulasForDocente(user: User, actividadId?: string) {
  const rows = db.prepare(`
    SELECT a.id, a.modo, a.estado, a.expires_at, a.duracion_minutos, a.join_token, a.titulo,
           a.actividad_id, act.titulo AS actividad_titulo, a.created_at,
           (SELECT COUNT(*) FROM aula_intentos i WHERE i.aula_id = a.id) AS intentos_count
    FROM aulas_temporales a
    JOIN actividades act ON act.id = a.actividad_id
    WHERE a.tenant_id = ?
      AND a.docente_id = ?
      AND (? IS NULL OR a.actividad_id = ?)
    ORDER BY a.created_at DESC
    LIMIT 50
  `).all(user.tenant_id, user.id, actividadId || null, actividadId || null) as Array<{
    id: string;
    modo: AulaModo;
    estado: string;
    expires_at: string;
    duracion_minutos: number;
    join_token: string;
    titulo: string | null;
    actividad_id: string;
    actividad_titulo: string;
    created_at: string;
    intentos_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    modo: row.modo,
    estado: row.estado,
    expiresAt: row.expires_at,
    duracionMinutos: row.duracion_minutos,
    joinPath: `/s/${row.join_token}`,
    titulo: row.titulo || row.actividad_titulo,
    actividadId: row.actividad_id,
    intentosCount: row.intentos_count,
    createdAt: row.created_at,
  }));
}

export async function closeAula(user: User, aulaId: string) {
  getAulaForTeacher(user, aulaId);

  const pendientes = db.prepare(`
    SELECT id FROM aula_intentos
    WHERE aula_id = ? AND estado = 'en_curso'
  `).all(aulaId) as Array<{ id: string }>;

  for (const row of pendientes) {
    try {
      submitIntento(row.id, { forceTimeout: true, reason: 'clase_cerrada' });
    } catch {
      // continue
    }
  }

  db.prepare(`
    UPDATE aulas_temporales
    SET estado = 'cerrada', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(aulaId);

  const porCorregir = db.prepare(`
    SELECT id FROM aula_intentos
    WHERE aula_id = ?
      AND estado IN ('entregado', 'vencido', 'bloqueado')
      AND nota_10 IS NULL
  `).all(aulaId) as Array<{ id: string }>;

  for (const row of porCorregir) {
    try {
      await corregirIntentoAlCierre(row.id);
    } catch {
      // keep going
    }
  }

  return getAulaForTeacher(user, aulaId);
}

export function listActividadesCargables(user: User, cursoId?: string) {
  const rows = db.prepare(`
    SELECT
      a.id,
      a.titulo,
      a.tipo,
      a.curso_id,
      cursos.nombre AS curso,
      a.materia_id,
      materias.nombre AS materia,
      a.updated_at,
      a.contenido_json,
      (SELECT COUNT(*) FROM actividad_preguntas p WHERE p.actividad_id = a.id) AS preguntas_count
    FROM actividades a
    JOIN cursos ON cursos.id = a.curso_id
    JOIN materias ON materias.id = a.materia_id
    WHERE a.tenant_id = ?
      AND a.docente_id = ?
      AND (? IS NULL OR ? = '' OR a.curso_id = ?)
    ORDER BY a.updated_at DESC
    LIMIT 100
  `).all(user.tenant_id, user.id, cursoId || null, cursoId || null, cursoId || null) as Array<{
    id: string;
    titulo: string;
    tipo: string;
    curso_id: string;
    curso: string;
    materia_id: string;
    materia: string;
    updated_at: string;
    contenido_json: string;
    preguntas_count: number;
  }>;

  return rows.map((row) => {
    const tipadas = row.preguntas_count > 0;
    const fromContent = tipadas ? 0 : extractPreguntasFromContenido(row.contenido_json).length;
    const importables = tipadas ? row.preguntas_count : fromContent;
    return {
      id: row.id,
      titulo: row.titulo,
      tipo: row.tipo,
      cursoId: row.curso_id,
      curso: row.curso,
      materiaId: row.materia_id,
      materia: row.materia,
      updatedAt: row.updated_at,
      preguntasCount: importables,
      tipadas,
      cargable: importables > 0,
    };
  }).filter((row) => row.cargable);
}

/** Convierte el contenido libre de Evaluación/TP/IA en preguntas digitales importables. */
export function extractPreguntasFromContenido(contenidoJson: string | null | undefined): PreguntaInput[] {
  const contenido = parseJson<Record<string, unknown>>(contenidoJson, {});
  const bloques = Array.isArray(contenido.bloques) ? contenido.bloques : [];
  const preguntas: PreguntaInput[] = [];

  for (const bloque of bloques) {
    const row = (bloque && typeof bloque === 'object' ? bloque : {}) as Record<string, unknown>;
    const type = String(row.type || row.tipo || '').toLowerCase();
    const texto = String(
      row.texto || row.enunciado || row.consigna || row.contenido || row.titulo || '',
    ).trim();
    if (!texto) continue;

    // IA a veces mete varias preguntas numeradas en un solo bloque.
    const lines = texto
      .split(/\n+/)
      .map((line) => line.replace(/^\s*\d+[\).\:\-]\s*/, '').trim())
      .filter((line) => line.length >= 3);

    if (type === 'pregunta' || type === 'consigna' || !type) {
      if (lines.length > 1 && (type === 'pregunta' || /evaluacion/i.test(String(contenido.template || '')))) {
        for (const line of lines) {
          preguntas.push({
            tipo: 'abierta',
            enunciado: line,
            opciones: [],
            correctas: [],
            puntaje: 1,
          });
        }
      } else {
        preguntas.push({
          tipo: type === 'consigna' ? 'abierta' : 'abierta',
          enunciado: texto.length > 800 ? `${texto.slice(0, 800)}…` : texto,
          opciones: [],
          correctas: [],
          puntaje: Number(row.puntaje) || 1,
        });
      }
      continue;
    }

    // Bloques IA { titulo, contenido }
    if (row.contenido || row.titulo) {
      const body = String(row.contenido || '').trim() || texto;
      const parts = body
        .split(/\n+/)
        .map((line) => line.replace(/^\s*\d+[\).\:\-]\s*/, '').trim())
        .filter((line) => line.length >= 8);
      if (parts.length) {
        for (const part of parts.slice(0, 20)) {
          preguntas.push({
            tipo: 'abierta',
            enunciado: part,
            opciones: [],
            correctas: [],
            puntaje: 1,
          });
        }
      } else {
        preguntas.push({
          tipo: 'abierta',
          enunciado: body.length > 800 ? `${body.slice(0, 800)}…` : body,
          opciones: [],
          correctas: [],
          puntaje: 1,
        });
      }
    }
  }

  // Editor IA a veces guarda questions en texto libre
  const editor = (contenido.editor && typeof contenido.editor === 'object'
    ? contenido.editor
    : {}) as Record<string, unknown>;
  const editorQuestions = String(editor.questions || editor.preguntas || '').trim();
  if (!preguntas.length && editorQuestions) {
    for (const line of editorQuestions.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 20)) {
      preguntas.push({
        tipo: 'abierta',
        enunciado: line.replace(/^\s*\d+[\).\:\-]\s*/, ''),
        opciones: [],
        correctas: [],
        puntaje: 1,
      });
    }
  }

  return preguntas.filter((p) => p.enunciado);
}

export function resolverPreguntasActividad(actividadId: string): PreguntaInput[] {
  const tipadas = preguntasForTeacher(actividadId);
  if (tipadas.length) {
    return tipadas.map((p) => ({
      tipo: p.tipo,
      enunciado: p.enunciado,
      opciones: p.opciones,
      correctas: p.correctas,
      puntaje: p.puntaje,
      explicacion: p.explicacion,
    }));
  }
  const row = db.prepare('SELECT contenido_json FROM actividades WHERE id = ?').get(actividadId) as
    | { contenido_json: string }
    | undefined;
  return extractPreguntasFromContenido(row?.contenido_json);
}

export function cargarActividadExistente(
  user: User,
  aulaId: string,
  actividadOrigenId: string,
  options: { publicar?: boolean } = {},
) {
  const aula = getAulaForTeacher(user, aulaId);
  const origen = db.prepare(`
    SELECT id, tenant_id, docente_id, titulo
    FROM actividades
    WHERE id = ?
  `).get(actividadOrigenId) as { id: string; tenant_id: string; docente_id: string; titulo: string } | undefined;

  if (!origen) throw new Error('Actividad no encontrada.');
  if (user.rol !== 'admin' && (origen.tenant_id !== user.tenant_id || origen.docente_id !== user.id)) {
    throw new Error('Sin acceso a esa actividad.');
  }

  let preguntas = resolverPreguntasActividad(origen.id);
  if (!preguntas.length) {
    throw new Error('Esa actividad no tiene texto/preguntas para importar.');
  }

  const fromPlainContent = preguntasForTeacher(origen.id).length === 0;
  // Si la clase es solo MC y vinieron abiertas desde Evaluación/TP, las convertimos a MC borrador (2 opciones vacías) para que el profe marque.
  if (aula.modo === 'multiple_choice') {
    preguntas = preguntas.map((p, index) => {
      if (p.tipo === 'mc_single' || p.tipo === 'mc_multi') return p;
      return {
        tipo: 'mc_single' as const,
        enunciado: p.enunciado,
        opciones: [
          { id: `opt-${index + 1}-1`, texto: '' },
          { id: `opt-${index + 1}-2`, texto: '' },
          { id: `opt-${index + 1}-3`, texto: '' },
          { id: `opt-${index + 1}-4`, texto: '' },
        ],
        correctas: [],
        puntaje: p.puntaje || 1,
      };
    });
  }

  const needsReview = fromPlainContent
    || (aula.modo === 'multiple_choice' && preguntas.some((p) => !p.correctas?.length || (p.opciones || []).filter((o) => o.texto).length < 2));

  // Si hace falta completar opciones/correctas, devolvemos preview para el editor (sin publicar).
  if (needsReview) {
    return {
      ...getAulaForTeacher(user, aulaId),
      needsReview: true,
      importedFrom: origen.titulo,
      preguntasPreview: preguntas,
    };
  }

  return {
    ...setActividadClase(user, aulaId, preguntas, { publicar: options.publicar !== false }),
    needsReview: false,
    importedFrom: origen.titulo,
  };
}

export function publicAulaPayload(token: string) {
  const aula = getAulaByToken(token);
  if (!aula) return null;

  const preguntasCount = listPreguntas(aula.actividad_id).length;
  const expired = new Date(aula.expires_at).getTime() <= Date.now();
  const ready = Boolean(aula.publicada) && preguntasCount > 0 && aula.estado === 'abierta' && !expired;

  return {
    token,
    titulo: aula.titulo || aula.actividad_titulo,
    modo: aula.modo,
    duracionMinutos: aula.duracion_minutos,
    expiresAt: aula.expires_at,
    estado: ready ? 'abierta' : (expired || aula.estado === 'cerrada' ? 'cerrada' : 'preparando'),
    digitalOnly: true,
    escuela: aula.escuela,
    cursoNombre: aula.curso_nombre,
    antiTrampa: parseAntiTrampa(aula.anti_trampa_json, aula.modo),
    mostrarNotaAlAlumno: Boolean(aula.mostrar_nota_al_alumno),
  };
}

function getIntento(intentoId: string) {
  return db.prepare('SELECT * FROM aula_intentos WHERE id = ?').get(intentoId) as IntentoRow | undefined;
}

function buildStudentQuestions(aula: AulaRow, intento: IntentoRow) {
  const anti = parseAntiTrampa(aula.anti_trampa_json, aula.modo);
  const preguntas = listPreguntas(aula.actividad_id);
  let order = parseJson<string[]>(intento.pregunta_order_json, []);
  let opcionesOrder = parseJson<Record<string, string[]>>(intento.opciones_order_json, {});

  if (!order.length) {
    order = preguntas.map((p) => p.id);
    if (anti.shuffleQuestions) shuffleInPlace(order, `${intento.id}:q`);
  }

  if (!Object.keys(opcionesOrder).length) {
    for (const pregunta of preguntas) {
      const opciones = parseJson<Array<{ id: string; texto: string }>>(pregunta.opciones_json, []);
      const ids = optionIds(opciones);
      if (anti.shuffleOptions && ids.length) shuffleInPlace(ids, `${intento.id}:o:${pregunta.id}`);
      opcionesOrder[pregunta.id] = ids;
    }
  }

  db.prepare(`
    UPDATE aula_intentos
    SET pregunta_order_json = ?, opciones_order_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(order), JSON.stringify(opcionesOrder), intento.id);

  const byId = new Map(preguntas.map((p) => [p.id, p]));
  return order.map((id, index) => {
    const pregunta = byId.get(id);
    if (!pregunta) return null;
    const opciones = parseJson<Array<{ id: string; texto: string }>>(pregunta.opciones_json, []);
    const orderedIds = opcionesOrder[pregunta.id] || optionIds(opciones);
    const optMap = new Map(opciones.map((o) => [o.id, o.texto]));
    return {
      id: pregunta.id,
      index: index + 1,
      tipo: pregunta.tipo,
      enunciado: pregunta.enunciado,
      puntaje: pregunta.puntaje,
      opciones: orderedIds.map((optId) => ({ id: optId, texto: optMap.get(optId) || '' })).filter((o) => o.texto),
    };
  }).filter(Boolean);
}

export function joinAula(token: string, nombreRaw: string, apellidoRaw: string) {
  const aula = getAulaByToken(token);
  if (!aula) throw new Error('Link inválido.');
  if (aula.estado !== 'abierta' || new Date(aula.expires_at).getTime() <= Date.now()) {
    throw new Error('El aula ya no está disponible.');
  }
  if (!aula.publicada) {
    throw new Error('La clase todavía no está lista. El docente está cargando la actividad.');
  }
  if (!listPreguntas(aula.actividad_id).length) {
    throw new Error('La clase aún no tiene actividad digital para responder.');
  }

  const nombre = String(nombreRaw || '').trim();
  const apellido = String(apellidoRaw || '').trim();
  if (!nombre || !apellido) throw new Error('Ingresá nombre y apellido.');

  const key = nombreKey(nombre, apellido);
  const existing = db.prepare(`
    SELECT * FROM aula_intentos WHERE aula_id = ? AND nombre_key = ?
  `).get(aula.id, key) as IntentoRow | undefined;

  if (existing && ['entregado', 'vencido', 'bloqueado'].includes(existing.estado)) {
    throw new Error('Ya registraste una entrega con ese nombre y apellido.');
  }

  if (existing && existing.estado === 'en_curso') {
    if (new Date(existing.ends_at).getTime() <= Date.now()) {
      submitIntento(existing.id, { forceTimeout: true });
      throw new Error('El tiempo de tu intento anterior ya venció.');
    }
    return buildJoinResponse(aula, existing);
  }

  const match = matchAlumnoId(aula.tenant_id, aula.curso_id, nombre, apellido);
  const now = new Date();
  const ends = new Date(now.getTime() + aula.duracion_minutos * 60 * 1000);
  const id = randomUUID();

  db.prepare(`
    INSERT INTO aula_intentos (
      id, tenant_id, aula_id, alumno_id, nombre, apellido, nombre_key,
      started_at, ends_at, respuestas_json, flags_json, estado
    ) VALUES (
      @id, @tenant_id, @aula_id, @alumno_id, @nombre, @apellido, @nombre_key,
      @started_at, @ends_at, '{}', @flags_json, 'en_curso'
    )
  `).run({
    id,
    tenant_id: aula.tenant_id,
    aula_id: aula.id,
    alumno_id: match.alumnoId,
    nombre,
    apellido,
    nombre_key: key,
    started_at: now.toISOString(),
    ends_at: ends.toISOString(),
    flags_json: JSON.stringify(match.match === 'exact' ? [] : [{
      type: 'match',
      at: now.toISOString(),
      detail: match.match,
    }]),
  });

  const intento = getIntento(id)!;
  return buildJoinResponse(aula, intento);
}

function buildJoinResponse(aula: AulaRow & { actividad_titulo?: string; curso_nombre?: string; escuela?: string }, intento: IntentoRow) {
  const anti = parseAntiTrampa(aula.anti_trampa_json, aula.modo);
  const preguntas = buildStudentQuestions(aula, intento);
  return {
    intentoId: intento.id,
    nombre: intento.nombre,
    apellido: intento.apellido,
    alumnoVinculado: Boolean(intento.alumno_id),
    startedAt: intento.started_at,
    endsAt: intento.ends_at,
    serverNow: new Date().toISOString(),
    estado: intento.estado,
    respuestas: parseJson<Record<string, unknown>>(intento.respuestas_json, {}),
    antiTrampa: anti,
    titulo: aula.titulo || aula.actividad_titulo || 'Aula temporal',
    modo: aula.modo,
    escuela: aula.escuela || '',
    cursoNombre: aula.curso_nombre || '',
    watermarkText: anti.watermark
      ? `${intento.apellido}, ${intento.nombre} · ${aula.curso_nombre || ''}`.trim()
      : '',
    preguntas,
  };
}

export function assertIntentoCookie(intentoId: string, cookieValue: string | undefined) {
  if (!cookieValue || cookieValue !== intentoId) {
    throw new Error('Sesión de intento inválida.');
  }
  const intento = getIntento(intentoId);
  if (!intento) throw new Error('Intento no encontrado.');
  return intento;
}

export function saveRespuestas(intentoId: string, respuestas: Record<string, unknown>) {
  const intento = getIntento(intentoId);
  if (!intento) throw new Error('Intento no encontrado.');
  if (intento.estado !== 'en_curso') throw new Error('El intento ya no admite cambios.');

  if (new Date(intento.ends_at).getTime() <= Date.now()) {
    return submitIntento(intentoId, { forceTimeout: true });
  }

  const current = parseJson<Record<string, unknown>>(intento.respuestas_json, {});
  const next = { ...current, ...respuestas };
  db.prepare(`
    UPDATE aula_intentos
    SET respuestas_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(next), intentoId);

  return { ok: true, respuestas: next };
}

export function appendIntentoEvent(intentoId: string, type: string, detail?: Record<string, unknown>) {
  const intento = getIntento(intentoId);
  if (!intento) throw new Error('Intento no encontrado.');
  if (intento.estado !== 'en_curso') return { ok: true, estado: intento.estado };

  const aula = db.prepare('SELECT * FROM aulas_temporales WHERE id = ?').get(intento.aula_id) as AulaRow;
  const anti = parseAntiTrampa(aula.anti_trampa_json, aula.modo);
  const flags = parseJson<Array<Record<string, unknown>>>(intento.flags_json, []);
  flags.push({ type, at: new Date().toISOString(), ...(detail || {}) });

  let estado: IntentoRow['estado'] = intento.estado;
  const focusLosses = flags.filter((f) => f.type === 'focus_loss').length;

  if (type === 'focus_loss' && anti.maxFocusLoss > 0 && focusLosses >= anti.maxFocusLoss) {
    flags.push({ type: 'focus_limit', at: new Date().toISOString(), count: focusLosses });
    if (anti.actionOnFocusLimit === 'block') {
      estado = 'bloqueado';
    } else if (anti.actionOnFocusLimit === 'autosubmit') {
      db.prepare(`
        UPDATE aula_intentos SET flags_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(JSON.stringify(flags), intentoId);
      return { ok: true, estado: 'entregado', result: submitIntento(intentoId, { forceTimeout: false, reason: 'focus_limit' }) };
    }
  }

  db.prepare(`
    UPDATE aula_intentos
    SET flags_json = ?, estado = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(flags), estado, intentoId);

  return { ok: true, estado, focusLosses, maxFocusLoss: anti.maxFocusLoss };
}

function scoreRespuestas(actividadId: string, respuestas: Record<string, unknown>) {
  const preguntas = listPreguntas(actividadId);
  let earned = 0;
  let max = 0;
  let pendingOpen = 0;
  const detail: Array<Record<string, unknown>> = [];

  for (const pregunta of preguntas) {
    max += pregunta.puntaje;
    const answer = respuestas[pregunta.id];
    if (pregunta.tipo === 'mc_single' || pregunta.tipo === 'mc_multi') {
      const correct = parseJson<string[]>(pregunta.correctas_json, []).slice().sort();
      const given = (Array.isArray(answer) ? answer.map(String) : answer != null ? [String(answer)] : [])
        .slice()
        .sort();
      const ok = correct.length === given.length && correct.every((id, i) => id === given[i]);
      if (ok) earned += pregunta.puntaje;
      detail.push({ preguntaId: pregunta.id, ok, puntaje: ok ? pregunta.puntaje : 0 });
    } else {
      pendingOpen += 1;
      detail.push({ preguntaId: pregunta.id, ok: null, pendiente: true, puntaje: 0 });
    }
  }

  const ratio = max > 0 ? earned / max : 0;
  const scaled = Math.round((1 + ratio * 9) * 10) / 10;

  return {
    puntaje: earned,
    puntajeMax: max,
    nota10: Math.min(10, Math.max(1, scaled || 1)),
    pendingOpen,
    detail,
  };
}

async function scoreRespuestasCompleto(actividadId: string, respuestas: Record<string, unknown>) {
  const base = scoreRespuestas(actividadId, respuestas);
  if (!base.pendingOpen) return base;

  const { scoreOpenAnswersWithAi } = await import('./grade-digital-open');
  const open = await scoreOpenAnswersWithAi({
    preguntas: listPreguntas(actividadId),
    respuestas,
  });

  const mcEarned = base.detail
    .filter((d) => d.ok === true || d.ok === false)
    .reduce((sum, d) => sum + Number(d.puntaje || 0), 0);
  const earned = mcEarned + open.earned;
  const max = base.puntajeMax;
  const ratio = max > 0 ? earned / max : 0;
  const scaled = Math.round((1 + ratio * 9) * 10) / 10;
  const stillPending = open.detail.some((d) => d.pendiente);

  return {
    puntaje: earned,
    puntajeMax: max,
    nota10: Math.min(10, Math.max(1, scaled || 1)),
    pendingOpen: stillPending ? open.detail.filter((d) => d.pendiente).length : 0,
    detail: [
      ...base.detail.filter((d) => !d.pendiente),
      ...open.detail,
    ],
  };
}

export function submitIntento(
  intentoId: string,
  options: { forceTimeout?: boolean; reason?: string } = {},
) {
  const intento = getIntento(intentoId);
  if (!intento) throw new Error('Intento no encontrado.');

  if (['entregado', 'vencido'].includes(intento.estado)) {
    return getSubmitResult(intento);
  }

  const aula = db.prepare(`
    SELECT a.*, act.titulo AS actividad_titulo, act.materia_id
    FROM aulas_temporales a
    JOIN actividades act ON act.id = a.actividad_id
    WHERE a.id = ?
  `).get(intento.aula_id) as AulaRow & { actividad_titulo: string; materia_id: string };

  const now = new Date();
  const timedOut = new Date(intento.ends_at).getTime() <= now.getTime();
  const flags = parseJson<Array<Record<string, unknown>>>(intento.flags_json, []);
  if (options.reason) flags.push({ type: options.reason, at: now.toISOString() });
  if (options.forceTimeout || timedOut) flags.push({ type: 'timeout', at: now.toISOString() });

  // Solo se registra la entrega. La auto-corrección corre al cerrar la clase.
  const estado = timedOut || options.forceTimeout ? 'vencido' : 'entregado';
  db.prepare(`
    UPDATE aula_intentos
    SET submitted_at = ?, flags_json = ?, estado = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    now.toISOString(),
    JSON.stringify(flags),
    estado,
    intentoId,
  );

  return getSubmitResult(getIntento(intentoId)!, aula);
}

async function corregirIntentoAlCierre(intentoId: string) {
  const intento = getIntento(intentoId);
  if (!intento) throw new Error('Intento no encontrado.');
  if (intento.nota_10 != null && intento.nota_id) return getSubmitResult(intento);

  const aula = db.prepare(`
    SELECT a.*, act.titulo AS actividad_titulo, act.materia_id
    FROM aulas_temporales a
    JOIN actividades act ON act.id = a.actividad_id
    WHERE a.id = ?
  `).get(intento.aula_id) as AulaRow & { actividad_titulo: string; materia_id: string };

  const respuestas = parseJson<Record<string, unknown>>(intento.respuestas_json, {});
  const score = await scoreRespuestasCompleto(aula.actividad_id, respuestas);
  const now = new Date();

  let notaId = intento.nota_id;
  if (intento.alumno_id && !notaId) {
    notaId = randomUUID();
    const tipo =
      aula.modo === 'examen' ? 'Examen'
        : aula.modo === 'multiple_choice' ? 'Multiple choice'
          : 'Actividad';
    db.prepare(`
      INSERT INTO notas (
        id, tenant_id, docente_id, alumno_id, materia_id, titulo, tipo_evaluacion,
        valor, calificacion_texto, peso, fecha, fecha_entrega, motivo, updated_at
      ) VALUES (
        @id, @tenant_id, @docente_id, @alumno_id, @materia_id, @titulo, @tipo_evaluacion,
        @valor, NULL, 100, @fecha, @fecha_entrega, @motivo, CURRENT_TIMESTAMP
      )
    `).run({
      id: notaId,
      tenant_id: aula.tenant_id,
      docente_id: aula.docente_id,
      alumno_id: intento.alumno_id,
      materia_id: aula.materia_id,
      titulo: aula.titulo || aula.actividad_titulo,
      tipo_evaluacion: tipo,
      valor: score.nota10,
      fecha: now.toISOString().slice(0, 10),
      fecha_entrega: (intento.submitted_at || now.toISOString()).slice(0, 10),
      motivo: score.pendingOpen
        ? `Auto al cierre: ${score.puntaje}/${score.puntajeMax} pts (quedan abiertas sin IA)`
        : `Auto al cierre: ${score.puntaje}/${score.puntajeMax} pts`,
    });
  } else if (notaId && score.nota10 != null) {
    db.prepare('UPDATE notas SET valor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(score.nota10, notaId);
  }

  const flags = parseJson<Array<Record<string, unknown>>>(intento.flags_json, []);
  flags.push({ type: 'auto_grade_on_close', at: now.toISOString(), detail: score.detail });

  db.prepare(`
    UPDATE aula_intentos
    SET puntaje = ?, nota_10 = ?, nota_id = ?, flags_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(score.puntaje, score.nota10, notaId, JSON.stringify(flags), intentoId);

  return getSubmitResult(getIntento(intentoId)!, aula);
}

export function applyDigitalQuizToClase(
  user: User,
  aulaId: string,
  quiz: {
    titulo?: string;
    preguntas: PreguntaInput[];
    hojaRespuestas?: string;
    documentoDocente?: string;
    referenciaHtml?: string;
  },
) {
  const aula = getAulaForTeacher(user, aulaId);
  if (!quiz.preguntas?.length) throw new Error('No hay preguntas para cargar.');

  setActividadClase(user, aulaId, quiz.preguntas, { publicar: true });

  const row = db.prepare('SELECT contenido_json, titulo FROM actividades WHERE id = ?')
    .get(aula.actividadId) as { contenido_json: string; titulo: string };
  const contenido = parseJson<Record<string, unknown>>(row.contenido_json, {});
  contenido.digitalOnly = true;
  contenido.modoOnline = aula.modo;
  contenido.generadoPor = 'groq-digital';
  contenido.hojaRespuestas = quiz.hojaRespuestas || quiz.documentoDocente || '';
  contenido.documentoDocente = quiz.documentoDocente || quiz.hojaRespuestas || '';
  if (quiz.referenciaHtml) contenido.referenciaHtml = quiz.referenciaHtml;
  if (quiz.titulo) {
    db.prepare('UPDATE actividades SET titulo = ?, contenido_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(String(quiz.titulo).trim(), JSON.stringify(contenido), aula.actividadId);
    db.prepare('UPDATE aulas_temporales SET titulo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(String(quiz.titulo).trim(), aulaId);
  } else {
    db.prepare('UPDATE actividades SET contenido_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(contenido), aula.actividadId);
  }

  return getAulaForTeacher(user, aulaId);
}

export function getDocumentoReferenciaClase(user: User, aulaId: string) {
  const aula = getAulaForTeacher(user, aulaId);
  const row = db.prepare('SELECT contenido_json, titulo FROM actividades WHERE id = ?')
    .get(aula.actividadId) as { contenido_json: string; titulo: string };
  const contenido = parseJson<Record<string, unknown>>(row.contenido_json, {});
  let html = String(contenido.referenciaHtml || '').trim();
  if (!html) {
    const preguntas = preguntasForTeacher(aula.actividadId);
    const hoja = String(contenido.hojaRespuestas || contenido.documentoDocente || '');
    html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>${aula.titulo}</title></head><body>
      <h1>${aula.titulo}</h1>
      <p>${aula.escuela} · ${aula.cursoNombre}</p>
      <ol>${preguntas.map((p) => `<li><strong>${p.enunciado}</strong><br/>Tipo: ${p.tipo}${p.correctas?.length ? ` · Correctas: ${p.correctas.join(', ')}` : ''}${p.explicacion ? ` · Modelo: ${p.explicacion}` : ''}</li>`).join('')}</ol>
      <h2>Hoja docente</h2><pre>${hoja}</pre>
    </body></html>`;
  }
  return { titulo: aula.titulo || row.titulo, html };
}

function getSubmitResult(intento: IntentoRow, aula?: AulaRow) {
  const aulaRow = aula || db.prepare('SELECT * FROM aulas_temporales WHERE id = ?').get(intento.aula_id) as AulaRow;
  const closed = aulaRow.estado === 'cerrada';
  const graded = intento.nota_10 != null;
  // La nota solo se muestra cuando la clase terminó y ya se auto-corrigió.
  const showNote = Boolean(aulaRow.mostrar_nota_al_alumno) && closed && graded;

  return {
    intentoId: intento.id,
    estado: intento.estado,
    submittedAt: intento.submitted_at,
    puntaje: showNote ? intento.puntaje : null,
    nota10: showNote ? intento.nota_10 : null,
    alumnoVinculado: Boolean(intento.alumno_id),
    mostrarNota: showNote,
    pendingGrade: !closed || !graded,
    pendingLink: !intento.alumno_id,
    message: !closed
      ? 'Entrega registrada. La auto-corrección y la nota se publican cuando el docente cierre la clase.'
      : undefined,
  };
}

export function resumeIntento(intentoId: string) {
  const intento = getIntento(intentoId);
  if (!intento) throw new Error('Intento no encontrado.');
  const aula = getAulaByToken(
    (db.prepare('SELECT join_token FROM aulas_temporales WHERE id = ?').get(intento.aula_id) as { join_token: string }).join_token,
  );
  if (!aula) throw new Error('Aula no encontrada.');

  if (intento.estado === 'en_curso' && new Date(intento.ends_at).getTime() <= Date.now()) {
    return { done: true, result: submitIntento(intento.id, { forceTimeout: true }) };
  }

  if (intento.estado !== 'en_curso') {
    return { done: true, result: getSubmitResult(intento, aula) };
  }

  return { done: false, session: buildJoinResponse(aula, intento) };
}

export function vincularIntento(user: User, intentoId: string, alumnoId: string) {
  const intento = getIntento(intentoId);
  if (!intento) throw new Error('Intento no encontrado.');
  const aula = db.prepare(`
    SELECT a.*, act.materia_id, act.titulo AS actividad_titulo
    FROM aulas_temporales a
    JOIN actividades act ON act.id = a.actividad_id
    WHERE a.id = ?
  `).get(intento.aula_id) as AulaRow & { materia_id: string; actividad_titulo: string };

  if (user.rol !== 'admin' && (aula.tenant_id !== user.tenant_id || aula.docente_id !== user.id)) {
    throw new Error('Sin acceso.');
  }

  const alumno = db.prepare(`
    SELECT id FROM alumnos WHERE id = ? AND tenant_id = ? AND curso_id = ?
  `).get(alumnoId, aula.tenant_id, aula.curso_id) as { id: string } | undefined;
  if (!alumno) throw new Error('Alumno no pertenece al curso del aula.');

  let notaId = intento.nota_id;
  if (!notaId && intento.nota_10 != null) {
    notaId = randomUUID();
    db.prepare(`
      INSERT INTO notas (
        id, tenant_id, docente_id, alumno_id, materia_id, titulo, tipo_evaluacion,
        valor, peso, fecha, fecha_entrega, motivo, updated_at
      ) VALUES (
        @id, @tenant_id, @docente_id, @alumno_id, @materia_id, @titulo, @tipo,
        @valor, 100, @fecha, @fecha, 'Vinculado desde aula temporal', CURRENT_TIMESTAMP
      )
    `).run({
      id: notaId,
      tenant_id: aula.tenant_id,
      docente_id: aula.docente_id,
      alumno_id: alumnoId,
      materia_id: aula.materia_id,
      titulo: aula.titulo || aula.actividad_titulo,
      tipo: aula.modo === 'examen' ? 'Examen' : 'Actividad',
      valor: intento.nota_10,
      fecha: (intento.submitted_at || new Date().toISOString()).slice(0, 10),
    });
  } else if (notaId) {
    db.prepare('UPDATE notas SET alumno_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(alumnoId, notaId);
  }

  db.prepare(`
    UPDATE aula_intentos
    SET alumno_id = ?, nota_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(alumnoId, notaId, intentoId);

  return getAulaForTeacher(user, aula.id);
}
