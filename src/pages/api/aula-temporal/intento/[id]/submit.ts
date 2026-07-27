import type { APIRoute } from 'astro';
import {
  INTENTO_COOKIE,
  assertIntentoCookie,
  submitIntento,
  saveRespuestas,
} from '../../../../../server/aula-temporal-service';

export const POST: APIRoute = async ({ params, request, cookies }) => {
  try {
    const intentoId = String(params.id || '');
    await assertIntentoCookie(intentoId, cookies.get(INTENTO_COOKIE)?.value);
    const body = await request.json().catch(() => ({}));
    if (body?.respuestas && typeof body.respuestas === 'object') {
      await saveRespuestas(intentoId, body.respuestas as Record<string, unknown>);
    }
    const result = await submitIntento(intentoId, {
      forceTimeout: Boolean(body?.timeout),
      reason: body?.reason ? String(body.reason) : undefined,
    });
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo entregar.' },
      { status: 400 },
    );
  }
};
