import type { APIRoute } from 'astro';
import { listUsersForInstitutionAdmin } from '../../../server/tenant';
import { isInstitutionAdmin } from '../../../server/auth-context';

/**
 * Lista usuarios SOLO del tenant del AuthContext del admin.
 * Nunca filtra únicamente por rol === 'admin'.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const requestedTenant = url.searchParams.get('tenant_id') || url.searchParams.get('tenantId');
  if (requestedTenant && requestedTenant !== auth!.tenantId) {
    return Response.json({ error: 'No puede listar usuarios de otra institución.' }, { status: 403 });
  }

  const result = await listUsersForInstitutionAdmin(user);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 403 });
  }

  return Response.json({ users: result.users });
};
