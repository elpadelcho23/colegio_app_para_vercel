import type { APIRoute } from 'astro';
import { isInstitutionAdmin } from '../../../../server/auth-context';
import { reactivateTeacher, teacherWriteStatus } from '../../../../server/institution-teachers';

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !auth || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const body = await parseBody(request);
  const clientTenant = body.tenant_id || body.tenantId;
  if (clientTenant && String(clientTenant) !== auth.tenantId) {
    return Response.json({ error: 'No puede reactivar docentes de otra institución.', code: 'forbidden' }, { status: 403 });
  }

  const result = await reactivateTeacher(user, {
    userId: body.userId != null ? String(body.userId) : body.user_id != null ? String(body.user_id) : null,
    membershipId: body.membershipId != null
      ? String(body.membershipId)
      : body.membership_id != null
        ? String(body.membership_id)
        : null,
  });

  const wantsRedirect = (request.headers.get('accept') || '').includes('text/html')
    && !(request.headers.get('content-type') || '').includes('application/json');

  if (!result.ok) {
    if (wantsRedirect) {
      return redirect(`/admin/usuarios?error=${encodeURIComponent(result.code)}`, 303);
    }
    return Response.json(
      { error: result.error, code: result.code },
      { status: teacherWriteStatus(result.code) },
    );
  }

  if (wantsRedirect) {
    return redirect('/admin/usuarios?ok=reactivated', 303);
  }

  return Response.json({ ok: true, teacher: result.teacher, membership: result.membership });
};
