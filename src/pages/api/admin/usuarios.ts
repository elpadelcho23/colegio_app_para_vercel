import type { APIRoute } from 'astro';
import { listUsersForInstitutionAdmin } from '../../../server/tenant';

/**
 * Lista usuarios SOLO del tenant del admin autenticado.
 * Nunca filtra únicamente por rol === 'admin'.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user || user.rol !== 'admin') {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const requestedTenant = url.searchParams.get('tenant_id') || url.searchParams.get('tenantId');
  if (requestedTenant && requestedTenant !== user.tenant_id) {
    return Response.json({ error: 'No puede listar usuarios de otra institución.' }, { status: 403 });
  }

  const result = await listUsersForInstitutionAdmin(user);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 403 });
  }

  return Response.json({ users: result.users });
};
