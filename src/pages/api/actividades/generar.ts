import type { APIRoute } from 'astro';
import { ACTIVITY_AI_LIMITS } from '../../../lib/activity-ai-limits';
import { ensureDocenteCourseAccess, ensureDocenteSubjectAccess } from '../../../server/docente-access';
import { payloadToEditorContent, type ActivityGenerationKind } from '../../../server/activity-document-html';
import { generateActivityFromSources } from '../../../server/groq-activity-generator';
import { prepareActivitySource } from '../../../server/prepare-activity-source';
import { db } from '../../../server/db';

const KIND_MAP: Record<string, ActivityGenerationKind> = {
  tp: 'tp',
  'trabajo practico': 'tp',
  'trabajo práctico': 'tp',
  examen: 'examen',
  integrador: 'integrador',
  'trabajo integrador': 'integrador',
};

function normalizeKind(raw: string): ActivityGenerationKind | null {
  const key = raw.trim().toLowerCase();
  return KIND_MAP[key] ?? null;
}

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });

  const kind = normalizeKind(String(form.get('tipoGeneracion') || ''));
  const colegio = String(form.get('colegio') || '').trim();
  const turno = String(form.get('turno') || '').trim();
  const cursoId = String(form.get('cursoId') || '').trim();
  const materiaId = String(form.get('materiaId') || '').trim();
  const tituloSugerido = String(form.get('titulo') || '').trim();
  const nivelAcademico = String(form.get('nivelAcademico') || '').trim();
  const notasDocente = String(form.get('notasDocente') || '').trim();

  if (!kind || !colegio || !turno || !cursoId || !materiaId) {
    return Response.json({ error: 'Completá tipo de actividad, colegio, turno, curso y materia.' }, { status: 400 });
  }

  const courseAccessError = ensureDocenteCourseAccess(user, {
    id: cursoId,
    nombre: String(form.get('cursoNombre') || '').trim(),
    escuela: colegio,
    turno,
  });
  if (courseAccessError) {
    return Response.json({ error: courseAccessError }, { status: 403 });
  }

  const subjectAccessError = ensureDocenteSubjectAccess(user, {
    id: materiaId,
    nombre: String(form.get('materiaNombre') || '').trim(),
  });
  if (subjectAccessError) {
    return Response.json({ error: subjectAccessError }, { status: 403 });
  }

  const files = form.getAll('documentos').filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (!files.length) {
    return Response.json({ error: 'Adjuntá al menos un archivo PDF, DOCX o TXT.' }, { status: 400 });
  }

  try {
    const cursoRow = db.prepare('SELECT nombre FROM cursos WHERE id = ?').get(cursoId) as { nombre?: string } | undefined;
    const materiaRow = db.prepare('SELECT nombre FROM materias WHERE id = ?').get(materiaId) as { nombre?: string } | undefined;
    const cursoNombre = cursoRow?.nombre || cursoId;
    const materiaNombre = materiaRow?.nombre || materiaId;

    const prepared = await prepareActivitySource(files, {
      curso: cursoNombre,
      materia: materiaNombre,
    });

    const result = await generateActivityFromSources({
      kind,
      sourceText: prepared.text,
      context: {
        colegio,
        turno,
        curso: cursoNombre,
        materia: materiaNombre,
        tituloSugerido,
        nivelAcademico,
        notasDocente,
      },
    });

    const editor = payloadToEditorContent(result.payload, result.tipoDb);

    return Response.json({
      ok: true,
      titulo: result.payload.titulo,
      tipoGeneracion: kind,
      tipo: result.tipoDb,
      html: result.html,
      contenido: {
        template: kind === 'tp' ? 'tp-ia-v1' : 'evaluacion-ia-v1',
        generadoPor: 'groq',
        modelo: result.meta.model,
        bloques: result.payload.bloques,
        seguimiento: { criterios: result.payload.criteriosDocente || [] },
        hojaRespuestas: result.payload.hojaRespuestas,
        editor,
      },
      meta: {
        ...result.meta,
        source: prepared.meta,
        limits: ACTIVITY_AI_LIMITS,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo generar la actividad.';
    const status = message.includes('GROQ_API_KEY') ? 503 : message.includes('429') ? 429 : 500;
    return Response.json({ error: message }, { status });
  }
};
