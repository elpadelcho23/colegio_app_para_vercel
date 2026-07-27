import type { APIRoute } from 'astro';
import { publicarClase } from '../../../../server/aula-temporal-service';

export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const aula = await publicarClase(user, String(params.id || ''));
    return Response.json({ aula });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo publicar la clase.' },
      { status: 400 },
    );
  }
};
