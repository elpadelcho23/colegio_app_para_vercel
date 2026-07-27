import type { APIRoute } from 'astro';
import { listActividadesCargables } from '../../../server/aula-temporal-service';

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });
  const cursoId = url.searchParams.get('cursoId') || undefined;
  return Response.json({ actividades: await listActividadesCargables(user, cursoId) });
};
