import type { APIRoute } from 'astro';
import { getDocumentoReferenciaClase } from '../../../../server/aula-temporal-service';

export const GET: APIRoute = ({ locals, params }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const doc = getDocumentoReferenciaClase(user, String(params.id || ''));
    const filename = `${(doc.titulo || 'referencia').replace(/[^\w\-]+/g, '_').slice(0, 60)}_referencia.html`;
    return new Response(doc.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo generar el documento.' },
      { status: 400 },
    );
  }
};
