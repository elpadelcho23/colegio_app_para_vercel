import type { APIRoute } from 'astro';
import {
  getTenantById,
  getTenantStats,
  updateTenant,
  type TenantUpdateInput,
} from '../../../server/tenant';
import { isInstitutionAdmin } from '../../../server/auth-context';

/**
 * Fase 5B — Configuración institucional.
 *
 * GET/PATCH /api/admin/tenant
 * - Autoridad: locals.auth (role=admin, tenantId).
 * - Nunca usa tenant_id del cliente como autoridad.
 * - status NO es editable por este endpoint (deuda: suspended sin superadmin).
 */

function wantsHtmlRedirect(request: Request) {
  const accept = request.headers.get('accept') || '';
  const contentType = request.headers.get('content-type') || '';
  return accept.includes('text/html') && !contentType.includes('application/json');
}

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !auth || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  // Cualquier intento de seleccionar otro tenant se rechaza.
  const requestedId = url.searchParams.get('id')
    || url.searchParams.get('tenantId')
    || url.searchParams.get('tenant_id');
  if (requestedId && requestedId !== auth.tenantId) {
    return Response.json({ error: 'No puede consultar otra institución.', code: 'forbidden' }, { status: 403 });
  }

  const tenant = await getTenantById(auth.tenantId);
  if (!tenant) return Response.json({ error: 'Institución no encontrada.' }, { status: 404 });

  const stats = await getTenantStats(auth.tenantId);
  return Response.json({ tenant, stats });
};

async function handleUpdate({ request, locals, redirect }: {
  request: Request;
  locals: App.Locals;
  redirect: (path: string, status?: number) => Response;
}) {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !auth || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const form = await request.formData();
    body = Object.fromEntries(form.entries());
  }

  // tenant_id / id del cliente nunca son autoridad; solo se rechazan si apuntan a otro.
  const requestedId = body.id ?? body.tenantId ?? body.tenant_id;
  if (requestedId != null && String(requestedId) !== '' && String(requestedId) !== auth.tenantId) {
    if (wantsHtmlRedirect(request)) {
      return redirect('/admin/institucion?error=forbidden', 303);
    }
    return Response.json({ error: 'No puede modificar otra institución.', code: 'forbidden' }, { status: 403 });
  }

  // Fase 5B: status no editable por admin (sin bypass suspended / sin superadmin).
  if ('status' in body) {
    if (wantsHtmlRedirect(request)) {
      return redirect('/admin/institucion?error=status_forbidden', 303);
    }
    return Response.json(
      {
        error: 'El estado de la institución no se puede modificar desde este formulario.',
        code: 'status_forbidden',
      },
      { status: 400 },
    );
  }

  // rol enviado por el cliente se ignora deliberadamente.
  const input: TenantUpdateInput = {};
  if ('nombre' in body) input.nombre = String(body.nombre ?? '');
  if ('slug' in body) input.slug = body.slug == null || body.slug === '' ? null : String(body.slug);
  if ('email' in body) input.email = body.email == null || body.email === '' ? null : String(body.email);
  if ('telefono' in body) input.telefono = body.telefono == null || body.telefono === '' ? null : String(body.telefono);
  if ('direccion' in body) input.direccion = body.direccion == null || body.direccion === '' ? null : String(body.direccion);
  if ('logo_url' in body) input.logo_url = body.logo_url == null || body.logo_url === '' ? null : String(body.logo_url);

  // Siempre auth.tenantId.
  const result = await updateTenant(auth.tenantId, input, { actor: user });
  if (!result.ok) {
    if (wantsHtmlRedirect(request)) {
      return redirect(`/admin/institucion?error=${encodeURIComponent(result.code)}`, 303);
    }
    const status = result.code === 'forbidden' ? 403
      : result.code === 'not_found' ? 404
        : result.code === 'slug_taken' ? 409
          : 400;
    return Response.json({ error: result.error, code: result.code }, { status });
  }

  if (wantsHtmlRedirect(request)) {
    return redirect('/admin/institucion?ok=saved', 303);
  }

  return Response.json({ ok: true, tenant: result.tenant });
}

export const POST: APIRoute = async (ctx) => handleUpdate(ctx);
export const PATCH: APIRoute = async (ctx) => handleUpdate(ctx);
