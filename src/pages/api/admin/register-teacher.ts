import type { APIRoute } from 'astro';
import { isInstitutionAdmin } from '../../../server/auth-context';
import { addOrInviteTeacher, teacherWriteStatus } from '../../../server/institution-teachers';

/**
 * Compat: formulario legacy de /admin/usuarios.
 * Migrado a addOrInviteTeacher (AuthContext + membership, sin createTenant).
 * Preferir POST /api/admin/teachers para clientes nuevos.
 */
export const POST: APIRoute = async ({ request, redirect, locals, url }) => {
  const admin = locals.user;
  const auth = locals.auth;
  if (!admin || !auth || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const form = await request.formData();
  const nombre = String(form.get('nombre') || '').trim();
  const email = String(form.get('email') || '');
  const password = String(form.get('password') || '');
  const cursoIds = form.getAll('cursoIds').map(String);
  const materiaIds = form.getAll('materiaIds').map(String);

  const result = await addOrInviteTeacher(admin, {
    nombre,
    email,
    password: password || null,
    cursoIds,
    materiaIds,
    origin: url.origin,
  });

  if (!result.ok) {
    const accept = request.headers.get('accept') || '';
    if (accept.includes('application/json')) {
      return Response.json(
        { error: result.error, code: result.code },
        { status: teacherWriteStatus(result.code) },
      );
    }
    return redirect(`/admin/usuarios?error=${encodeURIComponent(result.code)}`, 303);
  }

  return redirect('/admin/usuarios?ok=teacher', 303);
};
