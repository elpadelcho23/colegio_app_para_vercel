import type { APIRoute } from 'astro';
import {
  getTenantById,
  getTenantStats,
  updateTenant,
  type TenantUpdateInput,
} from '../../../server/tenant';
import { isInstitutionAdmin } from '../../../server/auth-context';

/**
 * GET: datos + stats de la institución del admin autenticado.
 * El tenant se resuelve SIEMPRE desde AuthContext, no desde query.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const requestedId = url.searchParams.get('id') || url.searchParams.get('tenantId');
  if (requestedId && requestedId !== auth!.tenantId) {
    return Response.json({ error: 'No puede consultar otra institución.' }, { status: 403 });
  }

  const tenant = await getTenantById(auth!.tenantId);
  if (!tenant) return Response.json({ error: 'Institución no encontrada.' }, { status: 404 });

  const stats = await getTenantStats(auth!.tenantId);
  return Response.json({ tenant, stats });
};

async function handleUpdate({ request, locals }: { request: Request; locals: App.Locals }) {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !isInstitutionAdmin(auth)) {
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

  const requestedId = String(body.id || body.tenantId || body.tenant_id || auth!.tenantId);
  if (requestedId !== auth!.tenantId) {
    return Response.json({ error: 'No puede modificar otra institución.' }, { status: 403 });
  }

  const input: TenantUpdateInput = {};
  if ('nombre' in body) input.nombre = String(body.nombre ?? '');
  if ('slug' in body) input.slug = body.slug == null ? null : String(body.slug);
  if ('email' in body) input.email = body.email == null ? null : String(body.email);
  if ('telefono' in body) input.telefono = body.telefono == null ? null : String(body.telefono);
  if ('direccion' in body) input.direccion = body.direccion == null ? null : String(body.direccion);
  if ('logo_url' in body) input.logo_url = body.logo_url == null ? null : String(body.logo_url);
  if ('status' in body) input.status = body.status as TenantUpdateInput['status'];

  const result = await updateTenant(auth!.tenantId, input, { actor: user });
  if (!result.ok) {
    const status = result.code === 'forbidden' ? 403
      : result.code === 'not_found' ? 404
        : result.code === 'slug_taken' ? 409
          : 400;
    return Response.json({ error: result.error, code: result.code }, { status });
  }

  return Response.json({ ok: true, tenant: result.tenant });
}

export const POST: APIRoute = async (ctx) => handleUpdate(ctx);
export const PATCH: APIRoute = async (ctx) => handleUpdate(ctx);
