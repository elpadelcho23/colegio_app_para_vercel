import type { APIRoute } from 'astro';
import { isInstitutionAdmin } from '../../../../server/auth-context';
import {
  academicWriteStatus,
  activateSubjectForInstitutionAdmin,
  createSubjectForInstitutionAdmin,
  deactivateSubjectForInstitutionAdmin,
  listSubjectsForInstitutionAdmin,
  rejectForeignTenantId,
  updateSubjectForInstitutionAdmin,
} from '../../../../server/institution-academic';

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

function wantsHtml(request: Request) {
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
  const requested = url.searchParams.get('tenant_id') || url.searchParams.get('tenantId');
  if (requested && requested !== auth.tenantId) {
    return Response.json({ error: 'No puede listar materias de otra institución.', code: 'forbidden' }, { status: 403 });
  }
  const includeInactive = url.searchParams.get('includeInactive') === '1';
  const result = await listSubjectsForInstitutionAdmin(user, { includeInactive });
  if (!result.ok) return Response.json({ error: result.error, code: result.code }, { status: 403 });
  return Response.json({ subjects: result.subjects });
};

async function handleWrite({ request, locals, redirect }: {
  request: Request;
  locals: App.Locals;
  redirect: (path: string, status?: number) => Response;
}) {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !auth || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }
  const body = await parseBody(request);
  if (rejectForeignTenantId(auth.tenantId, body)) {
    if (wantsHtml(request)) return redirect('/admin/materias?error=forbidden', 303);
    return Response.json({ error: 'No puede administrar materias de otra institución.', code: 'forbidden' }, { status: 403 });
  }

  const action = String(body.action || '');
  const id = String(body.id || body.subjectId || '').trim();

  if (action === 'deactivate' || action === 'activate' || action === 'update') {
    if (!id) {
      if (wantsHtml(request)) return redirect('/admin/materias?error=validation', 303);
      return Response.json({ error: 'id requerido.', code: 'validation' }, { status: 400 });
    }
    const result = action === 'deactivate'
      ? await deactivateSubjectForInstitutionAdmin(user, id)
      : action === 'activate'
        ? await activateSubjectForInstitutionAdmin(user, id)
        : await updateSubjectForInstitutionAdmin(user, id, { nombre: String(body.nombre || '') });
    if (!result.ok) {
      if (wantsHtml(request)) return redirect(`/admin/materias?error=${encodeURIComponent(result.code)}`, 303);
      return Response.json({ error: result.error, code: result.code }, { status: academicWriteStatus(result.code) });
    }
    const ok = action === 'deactivate' ? 'deactivated' : action === 'activate' ? 'activated' : 'saved';
    if (wantsHtml(request)) return redirect(`/admin/materias?ok=${ok}`, 303);
    return Response.json({ ok: true, subject: result.row });
  }

  const result = await createSubjectForInstitutionAdmin(user, { nombre: String(body.nombre || '') });
  if (!result.ok) {
    if (wantsHtml(request)) return redirect(`/admin/materias?error=${encodeURIComponent(result.code)}`, 303);
    return Response.json({ error: result.error, code: result.code }, { status: academicWriteStatus(result.code) });
  }
  if (wantsHtml(request)) return redirect('/admin/materias?ok=created', 303);
  return Response.json({ ok: true, subject: result.row });
}

export const POST: APIRoute = async (ctx) => handleWrite(ctx);
export const PATCH: APIRoute = async (ctx) => handleWrite(ctx);
