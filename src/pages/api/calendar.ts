import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { canAccessCourse, canAccessSubject } from '../../server/auth';
import { db, type User } from '../../server/db';

type CalendarEventType =
  | 'evaluacion'
  | 'tp'
  | 'cierre_tp'
  | 'asistencia'
  | 'nota'
  | 'evento'
  | 'ausencia'
  | 'lluvia'
  | 'salida_educativa'
  | 'acto'
  | 'jornada';

const CALENDAR_EVENT_TYPES = new Set<CalendarEventType>([
  'evaluacion',
  'tp',
  'cierre_tp',
  'asistencia',
  'nota',
  'evento',
  'ausencia',
  'lluvia',
  'salida_educativa',
  'acto',
  'jornada',
]);

const CALENDAR_EVENT_TITLES: Record<CalendarEventType, string> = {
  evaluacion: 'Evaluación',
  tp: 'Trabajo práctico',
  cierre_tp: 'Entrega de TP',
  asistencia: 'Asistencia',
  nota: 'Nota',
  evento: 'Evento',
  ausencia: 'Falta docente',
  lluvia: 'Día de lluvia',
  salida_educativa: 'Salida educativa',
  acto: 'Acto escolar',
  jornada: 'Jornada institucional',
};

function isCalendarEventType(value: unknown): value is CalendarEventType {
  return typeof value === 'string' && CALENDAR_EVENT_TYPES.has(value as CalendarEventType);
}

function scope(user: User) {
  if (user.rol === 'admin') {
    return {
      docente: '',
      coursePermission: '',
      params: { tenant_id: user.tenant_id, docente_id: user.id },
    };
  }

  return {
    docente: 'AND base.tenant_id = @tenant_id AND base.docente_id = @docente_id',
    coursePermission: `
      AND EXISTS (
        SELECT 1
        FROM docente_cursos dc
        WHERE dc.tenant_id = @tenant_id
          AND dc.docente_id = @docente_id
          AND dc.curso_id = cursos.id
      )
    `,
    params: { tenant_id: user.tenant_id, docente_id: user.id },
  };
}

function manualEventPermission(user: User) {
  if (user.rol === 'admin') return '';
  return `
    AND (
      base.curso_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM docente_cursos dc
        WHERE dc.tenant_id = @tenant_id
          AND dc.docente_id = @docente_id
          AND dc.curso_id = base.curso_id
      )
    )
  `;
}

function filters(url: URL, user: User) {
  return {
    ...scope(user).params,
    curso_id: url.searchParams.get('curso') || null,
    materia_id: url.searchParams.get('materia') || null,
    desde: url.searchParams.get('desde') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    hasta: url.searchParams.get('hasta') || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10),
  };
}

export const GET: APIRoute = ({ locals, url }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const currentScope = scope(user);
  const params = filters(url, user);

  const eventosManual = db.prepare(`
    SELECT
      base.id,
      base.tipo,
      base.titulo,
      base.descripcion,
      base.fecha_inicio AS fecha,
      base.fecha_fin,
      cursos.nombre AS curso,
      cursos.escuela AS colegio,
      materias.nombre AS materia,
      base.source_type,
      base.source_id
    FROM calendario_eventos base
    LEFT JOIN cursos ON cursos.id = base.curso_id
    LEFT JOIN materias ON materias.id = base.materia_id
    WHERE date(base.fecha_inicio) BETWEEN @desde AND @hasta
      AND (@curso_id IS NULL OR base.curso_id = @curso_id)
      AND (@materia_id IS NULL OR base.materia_id = @materia_id)
      ${manualEventPermission(user)}
      ${currentScope.docente}
  `).all(params);

  const asistencias = db.prepare(`
    SELECT
      'asistencia-' || base.fecha || '-' || base.materia_id || '-' || alumnos.curso_id AS id,
      'asistencia' AS tipo,
      'Asistencia tomada' AS titulo,
      CAST(SUM(CASE WHEN base.estado = 'presente' THEN 1 ELSE 0 END) AS TEXT) || ' presentes, ' ||
        CAST(SUM(CASE WHEN base.estado = 'ausente' THEN 1 ELSE 0 END) AS TEXT) || ' ausentes' AS descripcion,
      base.fecha AS fecha,
      NULL AS fecha_fin,
      cursos.nombre AS curso,
      cursos.escuela AS colegio,
      materias.nombre AS materia,
      'asistencias' AS source_type,
      base.fecha AS source_id
    FROM asistencias base
    JOIN alumnos ON alumnos.id = base.alumno_id
    JOIN cursos ON cursos.id = alumnos.curso_id
    JOIN materias ON materias.id = base.materia_id
    WHERE base.fecha BETWEEN @desde AND @hasta
      AND (@curso_id IS NULL OR cursos.id = @curso_id)
      AND (@materia_id IS NULL OR materias.id = @materia_id)
      ${currentScope.docente}
      ${currentScope.coursePermission}
    GROUP BY base.fecha, base.materia_id, alumnos.curso_id
  `).all(params);

  const notas = db.prepare(`
    SELECT
      base.id,
      'nota' AS tipo,
      CASE
        WHEN lower(COALESCE(base.tipo_evaluacion, '')) LIKE '%tp%' THEN 'Nota de TP: ' || base.titulo
        WHEN lower(COALESCE(base.tipo_evaluacion, '')) LIKE '%eval%' THEN 'Nota de evaluación: ' || base.titulo
        ELSE 'Nota: ' || base.titulo
      END AS titulo,
      alumnos.nombre || ' obtuvo ' || COALESCE(base.calificacion_texto, CAST(base.valor AS TEXT)) AS descripcion,
      base.fecha AS fecha,
      NULL AS fecha_fin,
      cursos.nombre AS curso,
      cursos.escuela AS colegio,
      materias.nombre AS materia,
      'notas' AS source_type,
      base.id AS source_id
    FROM notas base
    JOIN alumnos ON alumnos.id = base.alumno_id
    JOIN cursos ON cursos.id = alumnos.curso_id
    JOIN materias ON materias.id = base.materia_id
    WHERE base.fecha BETWEEN @desde AND @hasta
      AND (@curso_id IS NULL OR cursos.id = @curso_id)
      AND (@materia_id IS NULL OR materias.id = @materia_id)
      ${currentScope.docente}
      ${currentScope.coursePermission}
  `).all(params);

  const entregasNotas = db.prepare(`
    SELECT
      'entrega-nota-' || base.id AS id,
      'nota' AS tipo,
      'Entrega de notas: ' || base.titulo AS titulo,
      'Fecha prevista para devolver calificaciones' AS descripcion,
      base.fecha_entrega AS fecha,
      NULL AS fecha_fin,
      cursos.nombre AS curso,
      cursos.escuela AS colegio,
      materias.nombre AS materia,
      'notas' AS source_type,
      base.id AS source_id
    FROM notas base
    JOIN alumnos ON alumnos.id = base.alumno_id
    JOIN cursos ON cursos.id = alumnos.curso_id
    JOIN materias ON materias.id = base.materia_id
    WHERE base.fecha_entrega IS NOT NULL
      AND base.fecha_entrega BETWEEN @desde AND @hasta
      AND (@curso_id IS NULL OR cursos.id = @curso_id)
      AND (@materia_id IS NULL OR materias.id = @materia_id)
      ${currentScope.docente}
      ${currentScope.coursePermission}
  `).all(params);

  const actividades = db.prepare(`
    SELECT
      base.id || '-publicacion' AS id,
      CASE WHEN base.tipo = 'tp' THEN 'tp' ELSE 'evento' END AS tipo,
      CASE
        WHEN base.tipo = 'tp' THEN 'Publicación del TP: ' || base.titulo
        ELSE 'Aviso de evaluación: ' || base.titulo
      END AS titulo,
      CASE
        WHEN base.tipo = 'tp' THEN 'Publicación del trabajo práctico'
        ELSE 'Aviso de evaluación'
      END AS descripcion,
      base.fecha_publicacion AS fecha,
      NULL AS fecha_fin,
      cursos.nombre AS curso,
      cursos.escuela AS colegio,
      materias.nombre AS materia,
      'actividades' AS source_type,
      base.id AS source_id
    FROM actividades base
    JOIN cursos ON cursos.id = base.curso_id
    JOIN materias ON materias.id = base.materia_id
    WHERE base.fecha_publicacion IS NOT NULL
      AND date(base.fecha_publicacion) BETWEEN @desde AND @hasta
      AND (@curso_id IS NULL OR base.curso_id = @curso_id)
      AND (@materia_id IS NULL OR base.materia_id = @materia_id)
      ${currentScope.docente}
      ${currentScope.coursePermission}

    UNION ALL

    SELECT
      base.id || '-vencimiento' AS id,
      CASE WHEN base.tipo = 'tp' THEN 'cierre_tp' ELSE 'evaluacion' END AS tipo,
      CASE
        WHEN base.tipo = 'tp' THEN 'Entrega del TP: ' || base.titulo
        ELSE 'Evaluación: ' || base.titulo
      END AS titulo,
      CASE
        WHEN base.tipo = 'tp' THEN 'Fecha de entrega del trabajo práctico'
        ELSE 'Fecha de evaluación'
      END AS descripcion,
      base.fecha_vencimiento AS fecha,
      base.fecha_vencimiento AS fecha_fin,
      cursos.nombre AS curso,
      cursos.escuela AS colegio,
      materias.nombre AS materia,
      'actividades' AS source_type,
      base.id AS source_id
    FROM actividades base
    JOIN cursos ON cursos.id = base.curso_id
    JOIN materias ON materias.id = base.materia_id
    WHERE base.fecha_vencimiento IS NOT NULL
      AND date(base.fecha_vencimiento) BETWEEN @desde AND @hasta
      AND (@curso_id IS NULL OR base.curso_id = @curso_id)
      AND (@materia_id IS NULL OR base.materia_id = @materia_id)
      ${currentScope.docente}
      ${currentScope.coursePermission}
  `).all(params);

  const preferences = db.prepare(`
    SELECT calendar_alerts, lead_days
    FROM notification_preferences
    WHERE user_id = ?
  `).get(user.id) || { calendar_alerts: 0, lead_days: 3 };

  return Response.json({
    events: [...eventosManual, ...asistencias, ...notas, ...entregasNotas, ...actividades],
    preferences,
  });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);

  if (body?.calendarEvent && typeof body.calendarEvent === 'object') {
    const event = body.calendarEvent as Record<string, unknown>;
    const tipo = isCalendarEventType(event.tipo) ? event.tipo : null;
    const fecha = String(event.fecha_inicio || event.fecha || '').trim();
    const tituloInput = String(event.titulo || '').trim();
    const descripcion = String(event.descripcion || '').trim() || null;
    const cursoId = String(event.cursoId || event.curso_id || '').trim();
    const materiaId = String(event.materiaId || event.materia_id || '').trim();
    const fechaFin = String(event.fecha_fin || '').trim() || null;

    if (!tipo || !fecha) {
      return Response.json({ error: 'Faltan tipo o fecha para crear el evento.' }, { status: 400 });
    }

    if (cursoId && !canAccessCourse(user, cursoId)) {
      return Response.json({ error: 'El docente no tiene permiso sobre este curso.' }, { status: 403 });
    }

    if (materiaId && !canAccessSubject(user, materiaId)) {
      return Response.json({ error: 'El docente no tiene permiso sobre esta materia.' }, { status: 403 });
    }

    const id = `cal-${randomUUID()}`;
    const now = new Date().toISOString();
    const titulo = tituloInput || CALENDAR_EVENT_TITLES[tipo];

    db.prepare(`
      INSERT INTO calendario_eventos (
        id,
        tenant_id,
        docente_id,
        curso_id,
        materia_id,
        tipo,
        titulo,
        descripcion,
        fecha_inicio,
        fecha_fin,
        source_type,
        source_id,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user.tenant_id,
      user.id,
      cursoId || null,
      materiaId || null,
      tipo,
      titulo,
      descripcion,
      fecha,
      fechaFin,
      'manual',
      id,
      now,
    );

    return Response.json({
      ok: true,
      event: {
        id,
        tipo,
        titulo,
        fecha_inicio: fecha,
      },
    }, { status: 201 });
  }

  const enabled = Boolean(body?.calendarAlerts);
  const leadDays = Number.isFinite(Number(body?.leadDays)) ? Math.max(1, Math.min(30, Number(body.leadDays))) : 3;

  db.prepare(`
    INSERT INTO notification_preferences (user_id, tenant_id, calendar_alerts, lead_days, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      calendar_alerts = excluded.calendar_alerts,
      lead_days = excluded.lead_days,
      updated_at = excluded.updated_at
  `).run(user.id, user.tenant_id, enabled ? 1 : 0, leadDays, new Date().toISOString());

  return Response.json({ ok: true, calendarAlerts: enabled, leadDays });
};
