import type { APIRoute } from 'astro';
import { isInstitutionAdmin } from '../../../../server/auth-context';
import {
  addOrInviteTeacher,
  listTeachersForInstitutionAdmin,
  teacherWriteStatus,
} from '../../../../server/institution-teachers';

/**
 * GET /api/admin/teachers — lista docentes de auth.tenantId (role=docente).
 * POST /api/admin/teachers — agrega/invita docente (nunca crea tenant).
 */

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !auth || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const requestedTenant = url.searchParams.get('tenant_id') || url.searchParams.get('tenantId');
  if (requestedTenant && requestedTenant !== auth.tenantId) {
    return Response.json({ error: 'No puede listar docentes de otra institución.' }, { status: 403 });
  }

  const result = await listTeachersForInstitutionAdmin(user);
  if (!result.ok) {
    return Response.json({ error: result.error, code: result.code }, { status: 403 });
  }

  return Response.json({ teachers: result.teachers });
};

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }
  const form = await request.formData();
  const body: Record<string, unknown> = Object.fromEntries(
    [...form.keys()].map((key) => {
      const all = form.getAll(key).map(String);
      return [key, all.length > 1 ? all : all[0]];
    }),
  );
  return body;
}

export const POST: APIRoute = async ({ request, locals, redirect, url }) => {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !auth || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const body = await parseBody(request);

  // Nunca confiar en tenant_id / rol del cliente.
  const clientTenant = body.tenant_id || body.tenantId;
  if (clientTenant && String(clientTenant) !== auth.tenantId) {
    return Response.json({ error: 'No puede crear docentes en otra institución.', code: 'forbidden' }, { status: 403 });
  }
  if (body.rol || body.role) {
    // Ignorado deliberadamente; el rol institucional es siempre docente.
  }

  const cursoIds = Array.isArray(body.cursoIds)
    ? body.cursoIds.map(String)
    : body.cursoIds
      ? [String(body.cursoIds)]
      : [];
  const materiaIds = Array.isArray(body.materiaIds)
    ? body.materiaIds.map(String)
    : body.materiaIds
      ? [String(body.materiaIds)]
      : [];

  const result = await addOrInviteTeacher(user, {
    nombre: String(body.nombre || ''),
    email: String(body.email || ''),
    password: body.password == null || body.password === '' ? null : String(body.password),
    cursoIds,
    materiaIds,
    origin: url.origin,
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
    return redirect('/admin/usuarios?ok=teacher', 303);
  }

  return Response.json({
    ok: true,
    teacher: result.teacher,
    createdUser: result.createdUser,
    invitedByEmail: result.invitedByEmail,
    membership: result.membership,
  });
};
