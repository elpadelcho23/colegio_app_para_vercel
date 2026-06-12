import type { APIRoute } from 'astro';
import { getActividadForUser, insertActividad } from '../../../server/actividades-service';
import { ensureDocenteCourseAccess, ensureDocenteSubjectAccess } from '../../../server/docente-access';

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const actividadId = String(body?.actividadId || '').trim();
  const colegio = String(body?.colegio || '').trim();
  const turno = String(body?.turno || '').trim();
  const cursoId = String(body?.cursoId || '').trim();
  const materiaId = String(body?.materiaId || '').trim();
  const titulo = String(body?.titulo || '').trim();
  const fechaPublicacion = String(body?.fechaPublicacion || '').trim() || null;
  const fechaVencimiento = String(body?.fechaVencimiento || '').trim() || null;

  if (!actividadId || !colegio || !turno || !cursoId || !materiaId) {
    return Response.json({ error: 'Indicá la actividad y el curso destino (colegio, turno, curso y materia).' }, { status: 400 });
  }

  const source = getActividadForUser(user, actividadId);
  if (!source) {
    return Response.json({ error: 'La actividad no existe o no tenés permiso para enviarla.' }, { status: 404 });
  }

  const courseError = ensureDocenteCourseAccess(user, {
    id: cursoId,
    nombre: String(body?.cursoNombre || '').trim(),
    escuela: colegio,
    turno,
  });
  if (courseError) return Response.json({ error: courseError }, { status: 403 });

  const subjectError = ensureDocenteSubjectAccess(user, {
    id: materiaId,
    nombre: String(body?.materiaNombre || '').trim(),
  });
  if (subjectError) return Response.json({ error: subjectError }, { status: 403 });

  const tipo = source.tipo === 'tp' ? 'tp' : 'evaluacion';
  let contenido: unknown = {};
  try {
    contenido = JSON.parse(source.contenido_json || '{}');
  } catch {
    contenido = {};
  }

  const created = insertActividad({
    user,
    colegio,
    turno,
    cursoId,
    materiaId,
    tipo,
    titulo: titulo || source.titulo,
    contenido,
    fechaPublicacion: fechaPublicacion || source.fecha_publicacion || null,
    fechaVencimiento: fechaVencimiento || source.fecha_vencimiento || null,
    estado: 'publicado',
    origenActividadId: actividadId,
  });

  return Response.json({
    ok: true,
    actividad: {
      ...created,
      cursoId,
      materiaId,
      colegio,
      turno,
      origenActividadId: actividadId,
    },
  }, { status: 201 });
};
