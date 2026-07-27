import type { APIRoute } from 'astro';
import { replaceActividadPreguntas, preguntasForTeacher, type PreguntaInput } from '../../../server/aula-temporal-service';

export const GET: APIRoute = ({ locals, url }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });
  const actividadId = String(url.searchParams.get('actividadId') || '').trim();
  if (!actividadId) return Response.json({ error: 'Falta actividadId.' }, { status: 400 });
  return Response.json({ preguntas: preguntasForTeacher(actividadId) });
};

export const PUT: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const actividadId = String(body?.actividadId || '').trim();
  if (!actividadId) return Response.json({ error: 'Falta actividadId.' }, { status: 400 });
  if (!Array.isArray(body?.preguntas)) {
    return Response.json({ error: 'Faltan preguntas.' }, { status: 400 });
  }

  try {
    const preguntas = replaceActividadPreguntas(user, actividadId, body.preguntas as PreguntaInput[]);
    return Response.json({
      preguntas: preguntas.map((row) => ({
        id: row.id,
        tipo: row.tipo,
        enunciado: row.enunciado,
        opciones: row.opciones_json ? JSON.parse(row.opciones_json) : [],
        correctas: row.correctas_json ? JSON.parse(row.correctas_json) : [],
        puntaje: row.puntaje,
        explicacion: row.explicacion || '',
      })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudieron guardar las preguntas.' },
      { status: 400 },
    );
  }
};
