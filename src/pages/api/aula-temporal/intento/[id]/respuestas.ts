import type { APIRoute } from 'astro';
import {
  INTENTO_COOKIE,
  assertIntentoCookie,
  saveRespuestas,
} from '../../../../../server/aula-temporal-service';

export const PUT: APIRoute = async ({ params, request, cookies }) => {
  try {
    const intentoId = String(params.id || '');
    await assertIntentoCookie(intentoId, cookies.get(INTENTO_COOKIE)?.value);
    const body = await request.json().catch(() => null);
    const respuestas = body?.respuestas && typeof body.respuestas === 'object'
      ? body.respuestas as Record<string, unknown>
      : null;
    if (!respuestas) return Response.json({ error: 'Faltan respuestas.' }, { status: 400 });
    const result = await saveRespuestas(intentoId, respuestas);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo guardar.' },
      { status: 400 },
    );
  }
};
