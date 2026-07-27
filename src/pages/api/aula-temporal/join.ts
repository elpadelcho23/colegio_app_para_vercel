import type { APIRoute } from 'astro';
import { INTENTO_COOKIE, joinAula } from '../../../server/aula-temporal-service';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => null);
  const token = String(body?.token || '').trim();
  const nombre = String(body?.nombre || '').trim();
  const apellido = String(body?.apellido || '').trim();

  try {
    const session = joinAula(token, nombre, apellido);
    cookies.set(INTENTO_COOKIE, session.intentoId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
    });
    return Response.json({ session });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo unir al aula.' },
      { status: 400 },
    );
  }
};
