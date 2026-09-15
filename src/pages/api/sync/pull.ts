import type { APIRoute } from 'astro';
import { pullClientData } from '../../../server/sync-pull';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  const auth = locals.auth;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });
  if (!auth) return Response.json({ error: 'Sin acceso institucional' }, { status: 403 });

  try {
    return Response.json(await pullClientData(user), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error de sync';
    return Response.json({ error: message }, { status: 403 });
  }
};
