import type { APIRoute } from 'astro';
import { pullClientData } from '../../../server/sync-pull';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  return Response.json(await pullClientData(user), {
    headers: { 'Cache-Control': 'no-store' },
  });
};
