import type { APIRoute } from 'astro';
import { vincularIntento } from '../../../../../server/aula-temporal-service';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const alumnoId = String(body?.alumnoId || '').trim();
  if (!alumnoId) return Response.json({ error: 'Falta alumnoId.' }, { status: 400 });

  try {
    const aula = vincularIntento(user, String(params.id || ''), alumnoId);
    return Response.json({ aula });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo vincular.' },
      { status: 400 },
    );
  }
};
