import type { APIRoute } from 'astro';
import {
  applyDigitalQuizToClase,
  getAulaForTeacher,
  type AulaModo,
} from '../../../../server/aula-temporal-service';
import { db } from '../../../../server/db';
import {
  buildDigitalReferenceHtml,
  generateDigitalQuiz,
} from '../../../../server/groq-digital-quiz-generator';
import { prepareActivitySource } from '../../../../server/prepare-activity-source';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const aulaId = String(params.id || '');
  let aula;
  try {
    aula = getAulaForTeacher(user, aulaId);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Aula no encontrada.' },
      { status: 404 },
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });

  const promptDocente = String(form.get('prompt') || form.get('pedido') || '').trim();
  const actividadRefId = String(form.get('actividadId') || '').trim();
  const files = form.getAll('documentos').filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!actividadRefId && !files.length && !promptDocente) {
    return Response.json({
      error: 'Elegí una actividad de referencia, adjuntá un documento, o escribí qué querés que genere la IA.',
    }, { status: 400 });
  }

  try {
    const curso = db.prepare('SELECT nombre, escuela, turno FROM cursos WHERE id = ?')
      .get(aula.cursoId) as { nombre: string; escuela: string; turno: string } | undefined;
    const act = db.prepare('SELECT materia_id, colegio, turno FROM actividades WHERE id = ?')
      .get(aula.actividadId) as { materia_id: string; colegio: string; turno: string } | undefined;
    const materia = db.prepare('SELECT nombre FROM materias WHERE id = ?')
      .get(act?.materia_id) as { nombre: string } | undefined;

    let sourceText = '';

    if (actividadRefId) {
      const ref = db.prepare(`
        SELECT id, tenant_id, docente_id, titulo, contenido_json
        FROM actividades WHERE id = ?
      `).get(actividadRefId) as {
        id: string;
        tenant_id: string;
        docente_id: string;
        titulo: string;
        contenido_json: string;
      } | undefined;
      if (!ref || (user.rol !== 'admin' && (ref.tenant_id !== user.tenant_id || ref.docente_id !== user.id))) {
        return Response.json({ error: 'Actividad de referencia no encontrada.' }, { status: 404 });
      }
      sourceText += `\n[Actividad: ${ref.titulo}]\n${ref.contenido_json}\n`;
    }

    if (files.length) {
      const prepared = await prepareActivitySource(files, {
        curso: curso?.nombre || '',
        materia: materia?.nombre || '',
      });
      sourceText += `\n[Documento adjunto]\n${prepared.text}\n`;
    }

    if (!sourceText.trim()) {
      sourceText = `Pedido del docente sin archivo: ${promptDocente || aula.titulo}`;
    }

    const { quiz, meta } = await generateDigitalQuiz({
      modo: aula.modo as AulaModo,
      sourceText,
      promptDocente,
      context: {
        colegio: act?.colegio || curso?.escuela || '',
        turno: act?.turno || curso?.turno || '',
        curso: curso?.nombre || '',
        materia: materia?.nombre || '',
        tituloSugerido: aula.titulo,
      },
    });

    const referenciaHtml = buildDigitalReferenceHtml({
      titulo: quiz.titulo,
      colegio: act?.colegio || curso?.escuela || '',
      curso: curso?.nombre || '',
      materia: materia?.nombre || '',
      modo: aula.modo,
      quiz,
    });

    const updated = applyDigitalQuizToClase(user, aulaId, {
      titulo: quiz.titulo,
      preguntas: quiz.preguntas,
      hojaRespuestas: quiz.hojaRespuestas,
      documentoDocente: quiz.documentoDocente,
      referenciaHtml,
    });

    return Response.json({
      aula: updated,
      meta,
      generadas: quiz.preguntas.length,
      documentoDisponible: true,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo generar con IA.' },
      { status: 400 },
    );
  }
};
