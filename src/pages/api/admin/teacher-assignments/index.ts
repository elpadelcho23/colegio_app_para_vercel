import type { APIRoute } from 'astro';
import { isInstitutionAdmin } from '../../../../server/auth-context';
import {
  assignTeacherResourceForInstitutionAdmin,
  assignmentWriteStatus,
  getTeacherAssignmentsForInstitutionAdmin,
  listAssignableTeachersForInstitutionAdmin,
  rejectForeignTenantId,
  unassignTeacherResourceForInstitutionAdmin,
} from '../../../../server/institution-assignments';

/**
 * GET  /api/admin/teacher-assignments?teacher_id=...
 * POST /api/admin/teacher-assignments  { teacher_id, type, resource_id } | action=assign|unassign
 * DELETE /api/admin/teacher-assignments { teacher_id, type, resource_id }
 *
 * type: school | course | subject
 * Authority: locals.auth (admin + tenantId). Never trusts client tenant_id.
 */

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

function redirectAssignments(
  redirect: (path: string, status?: number) => Response,
  teacherId: string,
  query: string,
) {
  const tid = encodeURIComponent(teacherId || '');
  const base = tid ? `/admin/asignaciones?teacher_id=${tid}&` : '/admin/asignaciones?';
  return redirect(`${base}${query}`, 303);
}

function readTeacherId(source: Record<string, unknown> | URLSearchParams): string {
  if (source instanceof URLSearchParams) {
    return String(source.get('teacher_id') || source.get('teacherId') || '').trim();
  }
  return String(source.teacher_id || source.teacherId || source.docente_id || source.docenteId || '').trim();
}

function readResourceId(body: Record<string, unknown>): string {
  return String(body.resource_id || body.resourceId || body.id || '').trim();
}

function readType(body: Record<string, unknown>): string {
  return String(body.type || body.assignment_type || '').trim();
}

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !auth || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const requestedTenant = url.searchParams.get('tenant_id') || url.searchParams.get('tenantId');
  if (requestedTenant && requestedTenant !== auth.tenantId) {
    return Response.json(
      { error: 'No puede listar asignaciones de otra institución.', code: 'forbidden' },
      { status: 403 },
    );
  }

  const teacherId = readTeacherId(url.searchParams);
  if (!teacherId) {
    const teachers = await listAssignableTeachersForInstitutionAdmin(user);
    if (!teachers.ok) {
      return Response.json(
        { error: teachers.error, code: teachers.code },
        { status: assignmentWriteStatus(teachers.code) },
      );
    }
    return Response.json({ teachers: teachers.teachers });
  }

  const result = await getTeacherAssignmentsForInstitutionAdmin(user, teacherId);
  if (!result.ok) {
    return Response.json(
      { error: result.error, code: result.code },
      { status: assignmentWriteStatus(result.code) },
    );
  }

  return Response.json({
    teacher: result.view.teacher,
    schools: result.view.schools,
    courses: result.view.courses,
    subjects: result.view.subjects,
    schoolIds: result.view.schoolIds,
    courseIds: result.view.courseIds,
    subjectIds: result.view.subjectIds,
  });
};

async function handleMutation({
  request,
  locals,
  redirect,
  forceUnassign = false,
}: {
  request: Request;
  locals: App.Locals;
  redirect: (path: string, status?: number) => Response;
  forceUnassign?: boolean;
}) {
  const user = locals.user;
  const auth = locals.auth;
  if (!user || !auth || !isInstitutionAdmin(auth)) {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const body = await parseBody(request);
  if (rejectForeignTenantId(auth.tenantId, body)) {
    if (wantsHtml(request)) return redirectAssignments(redirect, readTeacherId(body), 'error=forbidden');
    return Response.json(
      { error: 'No puede administrar asignaciones de otra institución.', code: 'forbidden' },
      { status: 403 },
    );
  }

  const teacherId = readTeacherId(body);
  const type = readType(body);
  const resourceId = readResourceId(body);
  const action = String(body.action || '').trim().toLowerCase();
  const isUnassign = forceUnassign || action === 'unassign' || action === 'remove' || action === 'delete';

  if (!teacherId || !type || !resourceId) {
    if (wantsHtml(request)) return redirectAssignments(redirect, teacherId, 'error=validation');
    return Response.json(
      { error: 'teacher_id, type y resource_id son obligatorios.', code: 'validation' },
      { status: 400 },
    );
  }

  const result = isUnassign
    ? await unassignTeacherResourceForInstitutionAdmin(user, { teacherId, type, resourceId })
    : await assignTeacherResourceForInstitutionAdmin(user, { teacherId, type, resourceId });

  if (!result.ok) {
    if (wantsHtml(request)) {
      return redirectAssignments(redirect, teacherId, `error=${encodeURIComponent(result.code)}`);
    }
    return Response.json(
      { error: result.error, code: result.code },
      { status: assignmentWriteStatus(result.code) },
    );
  }

  if (wantsHtml(request)) {
    return redirectAssignments(redirect, teacherId, isUnassign ? 'ok=removed' : 'ok=assigned');
  }

  return Response.json({ ok: true, assignment: result });
}

export const POST: APIRoute = async (ctx) => handleMutation(ctx);
export const DELETE: APIRoute = async (ctx) => handleMutation({ ...ctx, forceUnassign: true });
