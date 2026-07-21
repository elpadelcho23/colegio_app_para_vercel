import type { APIRoute } from 'astro';
import { GradeDeliveryError, gradeTrabajoEntrega } from '../../../server/grade-delivery';

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  let body: { entregaId?: string } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const entregaId = String(body.entregaId || '').trim();
  if (!entregaId) {
    return Response.json({ error: 'Falta entregaId.' }, { status: 400 });
  }

  try {
    const result = await gradeTrabajoEntrega(user, entregaId);
    return Response.json({
      ok: true,
      entregaId: result.entregaId,
      notaId: result.notaId,
      nota: result.nota,
      correccion: result.correccion,
      corregidoAt: result.corregidoAt,
    });
  } catch (error) {
    if (error instanceof GradeDeliveryError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('[trabajos/corregir]', error);
    const message = error instanceof Error ? error.message : 'No se pudo corregir la entrega.';
    const status = /GROQ_API_KEY/i.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
};
