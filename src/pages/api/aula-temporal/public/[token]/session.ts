import type { APIRoute } from 'astro';
import {
  INTENTO_COOKIE,
  getAulaByToken,
  resumeIntento,
} from '../../../../server/aula-temporal-service';
import { db } from '../../../../server/db';

export const GET: APIRoute = ({ params, cookies }) => {
  const token = String(params.token || '');
  const aula = getAulaByToken(token);
  if (!aula) return Response.json({ error: 'Link inválido.' }, { status: 404 });

  const intentoId = cookies.get(INTENTO_COOKIE)?.value;
  if (!intentoId) return Response.json({ session: null });

  const row = db.prepare('SELECT id, aula_id FROM aula_intentos WHERE id = ?').get(intentoId) as
    | { id: string; aula_id: string }
    | undefined;
  if (!row || row.aula_id !== aula.id) return Response.json({ session: null });

  try {
    return Response.json(resumeIntento(intentoId));
  } catch (error) {
    return Response.json({
      session: null,
      error: error instanceof Error ? error.message : 'Sesión inválida',
    });
  }
};
