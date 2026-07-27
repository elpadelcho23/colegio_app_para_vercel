import type { APIRoute } from 'astro';
import { getAulaForTeacher } from '../../../server/aula-temporal-service';

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const aula = await getAulaForTeacher(user, String(params.id || ''));
    return Response.json({ aula });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo cargar el aula.' },
      { status: 404 },
    );
  }
};
