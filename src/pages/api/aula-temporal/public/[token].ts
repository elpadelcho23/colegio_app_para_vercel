import type { APIRoute } from 'astro';
import { publicAulaPayload } from '../../../../server/aula-temporal-service';

export const GET: APIRoute = async ({ params }) => {
  const payload = await publicAulaPayload(String(params.token || ''));
  if (!payload) return Response.json({ error: 'Link inválido.' }, { status: 404 });
  return Response.json({ aula: payload });
};
