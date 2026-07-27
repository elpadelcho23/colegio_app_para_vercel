import type { APIRoute } from 'astro';
import {
  INTENTO_COOKIE,
  assertIntentoCookie,
  resumeIntento,
} from '../../../../../server/aula-temporal-service';

export const GET: APIRoute = async ({ params, cookies }) => {
  try {
    const intentoId = String(params.id || '');
    await assertIntentoCookie(intentoId, cookies.get(INTENTO_COOKIE)?.value);
    return Response.json(await resumeIntento(intentoId));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Sesión inválida.' },
      { status: 401 },
    );
  }
};
