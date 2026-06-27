import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { isAllowedTrabajoFile, TRABAJO_UPLOAD_LIMITS } from '../../../lib/trabajo-upload-limits';
import { ensureDocenteCourseAccess, ensureDocenteSubjectAccess } from '../../../server/docente-access';
import { db } from '../../../server/db';
import { saveTrabajoFileAsync, copyTrabajoFile } from '../../../server/file-storage';
import { listTrabajoEntregas } from '../../../server/trabajo-entregas';

export const GET: APIRoute = ({ locals, url }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const entregas = listTrabajoEntregas(user, {
    cursoId: url.searchParams.get('curso') || url.searchParams.get('cursoId'),
    materiaId: url.searchParams.get('materia') || url.searchParams.get('materiaId'),
    actividadId: url.searchParams.get('actividad') || url.searchParams.get('actividadId'),
    estado: url.searchParams.get('estado'),
    desde: url.searchParams.get('desde'),
    hasta: url.searchParams.get('hasta'),
  });

  return Response.json({ entregas });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: 'Formulario inválido.' }, { status: 400 });

  const cursoId = String(form.get('cursoId') || '').trim();
  const materiaId = String(form.get('materiaId') || '').trim();
  const colegio = String(form.get('colegio') || '').trim();
  const turno = String(form.get('turno') || '').trim();
  const titulo = String(form.get('titulo') || '').trim();
  const actividadId = String(form.get('actividadId') || '').trim() || null;
  const alumnoId = String(form.get('alumnoId') || '').trim() || null;
  const observaciones = String(form.get('observaciones') || '').trim() || null;
  const reenviarDesdeId = String(form.get('reenviarDesdeId') || '').trim() || null;

  if (!cursoId || !materiaId || !colegio || !turno || !titulo) {
    return Response.json({ error: 'Completá curso, materia, colegio, turno y título.' }, { status: 400 });
  }

  const courseError = ensureDocenteCourseAccess(user, {
    id: cursoId,
    nombre: String(form.get('cursoNombre') || '').trim(),
    escuela: colegio,
    turno,
  });
  if (courseError) return Response.json({ error: courseError }, { status: 403 });

  const subjectError = ensureDocenteSubjectAccess(user, {
    id: materiaId,
    nombre: String(form.get('materiaNombre') || '').trim(),
  });
  if (subjectError) return Response.json({ error: subjectError }, { status: 403 });

  const files = form.getAll('archivos').filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (reenviarDesdeId) {
    const source = listTrabajoEntregas(user, {}).find((item) => item.id === reenviarDesdeId);
    if (!source) return Response.json({ error: 'El trabajo original no existe.' }, { status: 404 });
    if (!files.length && !(source.archivos as unknown[]).length) {
      return Response.json({ error: 'No hay archivos para reenviar.' }, { status: 400 });
    }
  } else if (!files.length) {
    return Response.json({ error: 'Adjuntá al menos un archivo.' }, { status: 400 });
  }

  if (files.length > TRABAJO_UPLOAD_LIMITS.maxFiles) {
    return Response.json({ error: `Máximo ${TRABAJO_UPLOAD_LIMITS.maxFiles} archivos por entrega.` }, { status: 400 });
  }

  for (const file of files) {
    const check = isAllowedTrabajoFile(file);
    if (!check.ok) return Response.json({ error: check.error }, { status: 400 });
  }

  const entregaId = `ent-${randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO trabajo_entregas (
      id, tenant_id, docente_id, actividad_id, alumno_id, curso_id, materia_id,
      colegio, turno, titulo, estado, observaciones, submitted_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enviado', ?, ?, ?)
  `).run(
    entregaId,
    user.tenant_id,
    user.id,
    actividadId,
    alumnoId,
    cursoId,
    materiaId,
    colegio,
    turno,
    titulo,
    observaciones,
    now,
    now,
  );

  const insertArchivo = db.prepare(`
    INSERT INTO trabajo_archivos (id, tenant_id, entrega_id, filename, mime_type, size_bytes, storage_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const savedArchivos: Array<Record<string, unknown>> = [];

  if (reenviarDesdeId && !files.length) {
    const sourceArchivos = db.prepare(`
      SELECT id, filename, mime_type, size_bytes, storage_path
      FROM trabajo_archivos
      WHERE entrega_id = ?
    `).all(reenviarDesdeId) as Array<{
      filename: string;
      mime_type: string;
      size_bytes: number;
      storage_path: string;
    }>;

    for (const archivo of sourceArchivos) {
      const copied = copyTrabajoFile(archivo.storage_path, user.tenant_id, entregaId);
      if (!copied) continue;
      insertArchivo.run(
        copied.id,
        user.tenant_id,
        entregaId,
        copied.filename,
        archivo.mime_type,
        archivo.size_bytes,
        copied.storagePath,
      );
      savedArchivos.push({
        id: copied.id,
        filename: copied.filename,
        mime_type: archivo.mime_type,
        size_bytes: archivo.size_bytes,
      });
    }
  } else {
    for (const file of files) {
      const saved = await saveTrabajoFileAsync({
        tenantId: user.tenant_id,
        entregaId,
        file,
      });
      insertArchivo.run(
        saved.id,
        user.tenant_id,
        entregaId,
        saved.filename,
        saved.mimeType,
        saved.sizeBytes,
        saved.storagePath,
      );
      savedArchivos.push({
        id: saved.id,
        filename: saved.filename,
        mime_type: saved.mimeType,
        size_bytes: saved.sizeBytes,
      });
    }
  }

  if (!savedArchivos.length) {
    db.prepare('DELETE FROM trabajo_entregas WHERE id = ?').run(entregaId);
    return Response.json({ error: 'No se pudieron guardar los archivos.' }, { status: 500 });
  }

  return Response.json({
    ok: true,
    entrega: {
      id: entregaId,
      titulo,
      cursoId,
      materiaId,
      actividadId,
      alumnoId,
      archivos: savedArchivos,
      submitted_at: now,
    },
  }, { status: 201 });
};
