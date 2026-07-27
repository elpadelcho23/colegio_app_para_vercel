import type { APIRoute } from 'astro';
import { setActividadClase, type PreguntaInput } from '../../../../server/aula-temporal-service';

export const PUT: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.preguntas)) {
    return Response.json({ error: 'Faltan preguntas digitales.' }, { status: 400 });
  }

  try {
    const aula = setActividadClase(
      user,
      String(params.id || ''),
      body.preguntas as PreguntaInput[],
      { publicar: body?.publicar !== false },
    );
    return Response.json({ aula });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo guardar la actividad.' },
      { status: 400 },
    );
  }
};
