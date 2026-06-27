import type { APIRoute } from 'astro';
import { pullClientData } from '../../../server/sync-pull';

export const GET: APIRoute = ({ locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  return Response.json(pullClientData(user), {
    headers: { 'Cache-Control': 'no-store' },
  });
};
