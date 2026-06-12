import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { ensureDocenteCourseAccess, ensureDocenteSubjectAccess } from '../../server/docente-access';
import { db, type User } from '../../server/db';

function paramsFromUrl(url: URL, user: User) {
  return {
    tenant_id: user.tenant_id,
    docente_id: user.id,
    colegio: url.searchParams.get('colegio') || null,
    turno: url.searchParams.get('turno') || null,
    curso_id: url.searchParams.get('curso') || null,
    materia_id: url.searchParams.get('materia') || null,
  };
}

function docenteFilter(user: User) {
  return user.rol === 'admin' ? '' : 'AND actividades.tenant_id = @tenant_id AND actividades.docente_id = @docente_id';
}

function validateAccess(
  user: User,
  cursoId: string,
  materiaId: string,
  context: { colegio?: string; turno?: string; cursoNombre?: string; materiaNombre?: string },
) {
  const courseError = ensureDocenteCourseAccess(user, {
    id: cursoId,
    nombre: context.cursoNombre,
    escuela: context.colegio,
    turno: context.turno,
  });
  if (courseError) return courseError;

  const subjectError = ensureDocenteSubjectAccess(user, {
    id: materiaId,
    nombre: context.materiaNombre,
  });
  if (subjectError) return subjectError;

  return null;
}

export const GET: APIRoute = ({ locals, url }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const actividades = db.prepare(`
    SELECT
      actividades.id,
      actividades.colegio,
      actividades.turno,
      actividades.curso_id,
      cursos.nombre AS curso,
      actividades.materia_id,
      materias.nombre AS materia,
      actividades.tipo,
      actividades.titulo,
      actividades.estado,
      actividades.fecha_publicacion,
      actividades.fecha_vencimiento,
      actividades.contenido_json,
      actividades.created_at,
      actividades.updated_at
    FROM actividades
    JOIN cursos ON cursos.id = actividades.curso_id
    JOIN materias ON materias.id = actividades.materia_id
    WHERE (@colegio IS NULL OR actividades.colegio = @colegio)
      AND (@turno IS NULL OR actividades.turno = @turno)
      AND (@curso_id IS NULL OR actividades.curso_id = @curso_id)
      AND (@materia_id IS NULL OR actividades.materia_id = @materia_id)
      ${docenteFilter(user)}
    ORDER BY COALESCE(actividades.fecha_vencimiento, actividades.created_at) DESC
  `).all(paramsFromUrl(url, user)).map((actividad) => {
    const item = actividad as { contenido_json: string };
    return {
      ...actividad as Record<string, unknown>,
      contenido: JSON.parse(item.contenido_json || '{}'),
      contenido_json: undefined,
    };
  });

  return Response.json({ actividades });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const tipo = body?.tipo === 'tp' ? 'tp' : body?.tipo === 'evaluacion' ? 'evaluacion' : null;
  const colegio = String(body?.colegio || '').trim();
  const turno = String(body?.turno || '').trim();
  const cursoId = String(body?.cursoId || '').trim();
  const materiaId = String(body?.materiaId || '').trim();
  const titulo = String(body?.titulo || '').trim();
  const fechaPublicacion = String(body?.fechaPublicacion || '').trim() || null;
  const fechaVencimiento = String(body?.fechaVencimiento || '').trim() || null;

  if (!tipo || !colegio || !turno || !cursoId || !materiaId || !titulo) {
    return Response.json({ error: 'Faltan filtros obligatorios o titulo.' }, { status: 400 });
  }

  const accessError = validateAccess(user, cursoId, materiaId, {
    colegio,
    turno,
    cursoNombre: String(body?.cursoNombre || '').trim(),
    materiaNombre: String(body?.materiaNombre || '').trim(),
  });
  if (accessError) return Response.json({ error: accessError }, { status: 403 });

  const contenido = body?.contenido && typeof body.contenido === 'object'
    ? body.contenido
    : {
        template: tipo === 'evaluacion' ? 'evaluacion-v1' : 'tp-v1',
        bloques: tipo === 'evaluacion'
          ? [{ type: 'pregunta', texto: '', puntaje: 1 }]
          : [{ type: 'consigna', texto: '' }],
        seguimiento: { criterios: [] },
      };

  const id = `act-${randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO actividades (
      id,
      tenant_id,
      docente_id,
      colegio,
      turno,
      curso_id,
      materia_id,
      tipo,
      titulo,
      estado,
      fecha_publicacion,
      fecha_vencimiento,
      contenido_json,
      updated_at
    )
    VALUES (
      @id,
      @tenant_id,
      @docente_id,
      @colegio,
      @turno,
      @curso_id,
      @materia_id,
      @tipo,
      @titulo,
      @estado,
      @fecha_publicacion,
      @fecha_vencimiento,
      @contenido_json,
      @updated_at
    )
  `).run({
    id,
    tenant_id: user.tenant_id,
    docente_id: user.id,
    colegio,
    turno,
    curso_id: cursoId,
    materia_id: materiaId,
    tipo,
    titulo,
    estado: 'borrador',
    fecha_publicacion: fechaPublicacion,
    fecha_vencimiento: fechaVencimiento,
    contenido_json: JSON.stringify(contenido),
    updated_at: now,
  });

  if (fechaVencimiento || fechaPublicacion) {
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

  return Response.json({ ok: true, actividad: { id, tipo, titulo } }, { status: 201 });
};
