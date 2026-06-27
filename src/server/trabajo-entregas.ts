import { db, type User } from './db';

export type TrabajoSeguimientoEstado = 'pendiente' | 'en_progreso' | 'completado';

export function docenteTrabajoFilter(user: User) {
  return user.rol === 'admin' ? '' : 'AND te.tenant_id = @tenant_id AND te.docente_id = @docente_id';
}

export function countStudentsForContext(cursoId: string, materiaId: string, tenantId: string) {
  const row = db.prepare(`
    SELECT COUNT(DISTINCT alumnos.id) AS total
    FROM alumnos
    LEFT JOIN alumno_materias am ON am.alumno_id = alumnos.id AND am.tenant_id = alumnos.tenant_id
    WHERE alumnos.tenant_id = ?
      AND alumnos.curso_id = ?
      AND alumnos.activo = 1
      AND (
        NOT EXISTS (SELECT 1 FROM alumno_materias WHERE alumno_id = alumnos.id AND tenant_id = alumnos.tenant_id)
        OR am.materia_id = ?
      )
  `).get(tenantId, cursoId, materiaId) as { total: number } | undefined;
  return row?.total || 0;
}

export function computeActividadSeguimiento(options: {
  fechaVencimiento?: string | null;
  entregasCount: number;
  alumnosCount: number;
}) {
  const { fechaVencimiento, entregasCount, alumnosCount } = options;
  const dueMs = fechaVencimiento ? new Date(`${fechaVencimiento}T23:59:59`).getTime() : null;
  const isPast = dueMs !== null && dueMs < Date.now();

  if (entregasCount <= 0) {
    return isPast ? 'completado' : 'pendiente' as TrabajoSeguimientoEstado;
  }
  if (alumnosCount > 0 && entregasCount >= alumnosCount) {
    return 'completado';
  }
  if (isPast && entregasCount > 0) {
    return 'completado';
  }
  return 'en_progreso';
}

export function listTrabajoEntregas(user: User, filters: {
  cursoId?: string | null;
  materiaId?: string | null;
  actividadId?: string | null;
  estado?: string | null;
  desde?: string | null;
  hasta?: string | null;
}) {
  const rows = db.prepare(`
    SELECT
      te.id,
      te.actividad_id,
      te.alumno_id,
      te.curso_id,
      te.materia_id,
      te.colegio,
      te.turno,
      te.titulo,
      te.estado,
      te.nota_id,
      te.observaciones,
      te.submitted_at,
      te.updated_at,
      te.created_at,
      cursos.nombre AS curso,
      materias.nombre AS materia,
      alumnos.nombre AS alumno,
      actividades.tipo AS actividad_tipo,
      actividades.fecha_vencimiento AS actividad_vencimiento
    FROM trabajo_entregas te
    JOIN cursos ON cursos.id = te.curso_id
    JOIN materias ON materias.id = te.materia_id
    LEFT JOIN alumnos ON alumnos.id = te.alumno_id
    LEFT JOIN actividades ON actividades.id = te.actividad_id
    WHERE te.tenant_id = @tenant_id
      ${user.rol === 'admin' ? '' : 'AND te.docente_id = @docente_id'}
      AND (@curso_id IS NULL OR te.curso_id = @curso_id)
      AND (@materia_id IS NULL OR te.materia_id = @materia_id)
      AND (@actividad_id IS NULL OR te.actividad_id = @actividad_id)
      AND (@estado IS NULL OR te.estado = @estado)
      AND (@desde IS NULL OR date(te.submitted_at) >= date(@desde))
      AND (@hasta IS NULL OR date(te.submitted_at) <= date(@hasta))
    ORDER BY te.submitted_at DESC
  `).all({
    tenant_id: user.tenant_id,
    docente_id: user.id,
    curso_id: filters.cursoId || null,
    materia_id: filters.materiaId || null,
    actividad_id: filters.actividadId || null,
    estado: filters.estado || null,
    desde: filters.desde || null,
    hasta: filters.hasta || null,
  }) as Array<Record<string, unknown>>;

  const archivosStmt = db.prepare(`
    SELECT id, entrega_id, filename, mime_type, size_bytes, created_at
    FROM trabajo_archivos
    WHERE entrega_id = ?
    ORDER BY created_at ASC
  `);

  return rows.map((row) => ({
    ...row,
    archivos: archivosStmt.all(row.id),
  }));
}

export function getTrabajoArchivo(user: User, archivoId: string) {
  return db.prepare(`
    SELECT ta.id, ta.entrega_id, ta.filename, ta.mime_type, ta.size_bytes, ta.storage_path, ta.created_at
    FROM trabajo_archivos ta
    JOIN trabajo_entregas te ON te.id = ta.entrega_id
    WHERE ta.id = ?
      AND ta.tenant_id = ?
      ${user.rol === 'admin' ? '' : 'AND te.docente_id = ?'}
  `).get(
    archivoId,
    user.tenant_id,
    ...(user.rol === 'admin' ? [] : [user.id]),
  ) as {
    id: string;
    entrega_id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    created_at: string;
  } | undefined;
}
