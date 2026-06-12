import { randomUUID } from 'node:crypto';
import { db, type User } from './db';

export function getActividadForUser(user: User, actividadId: string) {
  const row = db.prepare(`
    SELECT
      actividades.id,
      actividades.tenant_id,
      actividades.docente_id,
      actividades.colegio,
      actividades.turno,
      actividades.curso_id,
      actividades.materia_id,
      actividades.tipo,
      actividades.titulo,
      actividades.estado,
      actividades.fecha_publicacion,
      actividades.fecha_vencimiento,
      actividades.contenido_json
    FROM actividades
    WHERE actividades.id = ?
      AND actividades.tenant_id = ?
      ${user.rol === 'admin' ? '' : 'AND actividades.docente_id = ?'}
  `).get(
    actividadId,
    user.tenant_id,
    ...(user.rol === 'admin' ? [] : [user.id]),
  ) as Record<string, string> | undefined;

  return row;
}

export function insertActividad(options: {
  user: User;
  colegio: string;
  turno: string;
  cursoId: string;
  materiaId: string;
  tipo: 'tp' | 'evaluacion';
  titulo: string;
  contenido: unknown;
  fechaPublicacion?: string | null;
  fechaVencimiento?: string | null;
  estado?: string;
  origenActividadId?: string | null;
}) {
  const {
    user,
    colegio,
    turno,
    cursoId,
    materiaId,
    tipo,
    titulo,
    contenido,
    fechaPublicacion = null,
    fechaVencimiento = null,
    estado = 'publicado',
    origenActividadId = null,
  } = options;

  const id = `act-${randomUUID()}`;
  const now = new Date().toISOString();
  const contenidoFinal = typeof contenido === 'object' && contenido !== null
    ? { ...contenido as Record<string, unknown>, origenActividadId: origenActividadId || undefined }
    : contenido;

  db.prepare(`
    INSERT INTO actividades (
      id, tenant_id, docente_id, colegio, turno, curso_id, materia_id,
      tipo, titulo, estado, fecha_publicacion, fecha_vencimiento, contenido_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    user.tenant_id,
    user.id,
    colegio,
    turno,
    cursoId,
    materiaId,
    tipo,
    titulo,
    estado,
    fechaPublicacion,
    fechaVencimiento,
    JSON.stringify(contenidoFinal),
    now,
  );

  if (fechaVencimiento || fechaPublicacion) {
    db.prepare(`
      INSERT INTO calendario_eventos (
        id, tenant_id, docente_id, curso_id, materia_id, tipo, titulo, descripcion,
        fecha_inicio, fecha_fin, source_type, source_id, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'actividades', ?, ?)
    `).run(
      `cal-${id}`,
      user.tenant_id,
      user.id,
      cursoId,
      materiaId,
      tipo === 'tp' ? 'cierre_tp' : 'evaluacion',
      titulo,
      tipo === 'tp' ? 'Fecha de entrega de TP' : 'Aviso de evaluacion',
      fechaVencimiento || fechaPublicacion,
      fechaVencimiento,
      id,
      now,
    );
  }

  return { id, tipo, titulo, now };
}
