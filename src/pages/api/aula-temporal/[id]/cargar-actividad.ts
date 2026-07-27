import type { APIRoute } from 'astro';
import { cargarActividadExistente } from '../../../../server/aula-temporal-service';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const actividadId = String(body?.actividadId || '').trim();
  if (!actividadId) return Response.json({ error: 'Elegí una actividad.' }, { status: 400 });

  try {
    const aula = cargarActividadExistente(user, String(params.id || ''), actividadId);
    return Response.json({ aula });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo cargar la actividad.' },
      { status: 400 },
    );
  }
};
