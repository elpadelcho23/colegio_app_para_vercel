import type { APIRoute } from 'astro';
import {
  INTENTO_COOKIE,
  assertIntentoCookie,
  appendIntentoEvent,
} from '../../../../../server/aula-temporal-service';

export const POST: APIRoute = async ({ params, request, cookies }) => {
  try {
    const intentoId = String(params.id || '');
    await assertIntentoCookie(intentoId, cookies.get(INTENTO_COOKIE)?.value);
    const body = await request.json().catch(() => ({}));
    const type = String(body?.type || '').trim() || 'unknown';
    const result = await appendIntentoEvent(intentoId, type, body?.detail || undefined);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Evento rechazado.' },
      { status: 400 },
    );
  }
};
