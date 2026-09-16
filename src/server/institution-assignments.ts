import { db, type User } from './db';
import { resolveAuthContext, isInstitutionAdmin } from './auth-context';
import { getMembershipByUserAndTenant } from './memberships';
import {
  listSchoolsForInstitutionAdmin,
  listCoursesForInstitutionAdmin,
  listSubjectsForInstitutionAdmin,
  type SchoolRow,
  type CourseRow,
  type SubjectRow,
} from './institution-academic';
import { listTeachersForInstitutionAdmin, type TeacherRow } from './institution-teachers';

/**
 * Fase 5D Part 2 — Admin assignment of teachers to escuelas/cursos/materias.
 *
 * Reuses existing junctions:
 *   docente_escuelas | docente_cursos | docente_materias
 *
 * Relations are INDEPENDENT (no hierarchy school→course→subject).
 * Authority: AuthContext admin + auth.tenantId only.
 */

export type AssignmentType = 'school' | 'course' | 'subject';

export type AssignmentWriteCode =
  | 'forbidden'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'revoked'
  | 'wrong_role';

export type AssignmentWriteResult =
  | {
      ok: true;
      type: AssignmentType;
      teacherId: string;
      resourceId: string;
      created?: boolean;
      removed?: boolean;
    }
  | { ok: false; error: string; code: AssignmentWriteCode };

export type ResourceOption = {
  id: string;
  label: string;
  assigned: boolean;
  activo?: boolean;
  meta?: string;
};

export type TeacherAssignmentsView = {
  teacher: TeacherRow;
  schools: ResourceOption[];
  courses: ResourceOption[];
  subjects: ResourceOption[];
  schoolIds: string[];
  courseIds: string[];
  subjectIds: string[];
};

async function requireInstitutionAdmin(actor: User | null | undefined) {
  const ctx = await resolveAuthContext(actor);
  if (!ctx || !isInstitutionAdmin(ctx) || !actor) {
    return { ok: false as const, error: 'Requiere rol admin.', code: 'forbidden' as const, ctx: null };
  }
  return { ok: true as const, ctx, actor };
}

export function assignmentWriteStatus(code: AssignmentWriteCode): number {
  switch (code) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'revoked':
      return 409;
    case 'wrong_role':
      return 400;
    default:
      return 400;
  }
}

export function rejectForeignTenantId(
  authTenantId: string,
  body: Record<string, unknown>,
): AssignmentWriteCode | null {
  const requested = body.tenant_id ?? body.tenantId;
  if (requested != null && String(requested) !== '' && String(requested) !== authTenantId) {
    return 'forbidden';
  }
  return null;
}

function parseAssignmentType(raw: unknown): AssignmentType | null {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'school' || value === 'escuela') return 'school';
  if (value === 'course' || value === 'curso') return 'course';
  if (value === 'subject' || value === 'materia') return 'subject';
  return null;
}

/**
 * Active docente membership in auth.tenantId only.
 * Rejects revoked, admins-as-teachers, guests (no membership), foreign users.
 */
async function requireActiveTeacherInTenant(
  teacherId: string,
  tenantId: string,
): Promise<
  | { ok: true; teacherId: string }
  | { ok: false; error: string; code: AssignmentWriteCode }
> {
  const id = String(teacherId || '').trim();
  if (!id) {
    return { ok: false, error: 'teacher_id requerido.', code: 'validation' };
  }

  const userRow = (await db.prepare(`
    SELECT id, COALESCE(is_guest, 0) AS is_guest
    FROM usuarios
    WHERE id = ?
  `).get(id)) as { id: string; is_guest: number } | undefined;

  if (!userRow) {
    return { ok: false, error: 'Docente no encontrado.', code: 'not_found' };
  }
  if (Number(userRow.is_guest) === 1) {
    return { ok: false, error: 'Los invitados no son docentes administrables.', code: 'wrong_role' };
  }

  const membership = await getMembershipByUserAndTenant(id, tenantId);
  if (!membership || membership.role !== 'docente') {
    // Hide cross-tenant existence when possible.
    return { ok: false, error: 'Docente no encontrado en esta institución.', code: 'not_found' };
  }
  if (membership.status === 'revoked') {
    return {
      ok: false,
      error: 'Docente revocado: no se pueden gestionar asignaciones nuevas.',
      code: 'revoked',
    };
  }
  if (membership.status !== 'active') {
    return { ok: false, error: 'Docente no activo en esta institución.', code: 'forbidden' };
  }

  return { ok: true, teacherId: id };
}

async function assertResourceInTenant(
  type: AssignmentType,
  resourceId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; error: string; code: AssignmentWriteCode }> {
  const id = String(resourceId || '').trim();
  if (!id) {
    return { ok: false, error: 'resource_id requerido.', code: 'validation' };
  }

  if (type === 'school') {
    const row = (await db.prepare(
      'SELECT id FROM escuelas WHERE id = ? AND tenant_id = ?',
    ).get(id, tenantId)) as { id: string } | undefined;
    if (!row) return { ok: false, error: 'Escuela no encontrada en esta institución.', code: 'not_found' };
    return { ok: true };
  }

  if (type === 'course') {
    const row = (await db.prepare(
      'SELECT id FROM cursos WHERE id = ? AND tenant_id = ?',
    ).get(id, tenantId)) as { id: string } | undefined;
    if (!row) return { ok: false, error: 'Curso no encontrado en esta institución.', code: 'not_found' };
    return { ok: true };
  }

  const row = (await db.prepare(
    'SELECT id FROM materias WHERE id = ? AND tenant_id = ?',
  ).get(id, tenantId)) as { id: string } | undefined;
  if (!row) return { ok: false, error: 'Materia no encontrada en esta institución.', code: 'not_found' };
  return { ok: true };
}

async function listAssignedIds(
  type: AssignmentType,
  tenantId: string,
  teacherId: string,
): Promise<string[]> {
  if (type === 'school') {
    const rows = (await db.prepare(`
      SELECT escuela_id AS id FROM docente_escuelas
      WHERE tenant_id = ? AND docente_id = ?
    `).all(tenantId, teacherId)) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
  if (type === 'course') {
    const rows = (await db.prepare(`
      SELECT curso_id AS id FROM docente_cursos
      WHERE tenant_id = ? AND docente_id = ?
    `).all(tenantId, teacherId)) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
  const rows = (await db.prepare(`
    SELECT materia_id AS id FROM docente_materias
    WHERE tenant_id = ? AND docente_id = ?
  `).all(tenantId, teacherId)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

function mapSchoolOptions(schools: SchoolRow[], assigned: Set<string>): ResourceOption[] {
  return schools.map((s) => ({
    id: s.id,
    label: s.nombre,
    assigned: assigned.has(s.id),
    activo: s.activo,
  }));
}

function mapCourseOptions(courses: CourseRow[], assigned: Set<string>): ResourceOption[] {
  return courses.map((c) => ({
    id: c.id,
    label: c.nombre,
    assigned: assigned.has(c.id),
    meta: [c.escuela, c.turno, String(c.ciclo_lectivo)].filter(Boolean).join(' · '),
  }));
}

function mapSubjectOptions(subjects: SubjectRow[], assigned: Set<string>): ResourceOption[] {
  return subjects.map((s) => ({
    id: s.id,
    label: s.nombre,
    assigned: assigned.has(s.id),
    activo: s.activo,
  }));
}

/** Active docentes only (for assignment UI / selector). Guests never appear. */
export async function listAssignableTeachersForInstitutionAdmin(actor: User) {
  const listed = await listTeachersForInstitutionAdmin(actor);
  if (!listed.ok) {
    return { ok: false as const, error: listed.error, code: listed.code as AssignmentWriteCode, teachers: [] as TeacherRow[] };
  }
  return {
    ok: true as const,
    teachers: listed.teachers.filter((t) => t.status === 'active'),
  };
}

/**
 * Snapshot: catalog of tenant resources + assignment flags for one active teacher.
 */
export async function getTeacherAssignmentsForInstitutionAdmin(
  actor: User,
  teacherId: string,
): Promise<
  | { ok: true; view: TeacherAssignmentsView }
  | { ok: false; error: string; code: AssignmentWriteCode }
> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const teacherGate = await requireActiveTeacherInTenant(teacherId, gate.ctx.tenantId);
  if (!teacherGate.ok) return teacherGate;

  const teachers = await listTeachersForInstitutionAdmin(actor);
  if (!teachers.ok) return { ok: false, error: teachers.error, code: teachers.code as AssignmentWriteCode };
  const teacher = teachers.teachers.find((t) => t.userId === teacherGate.teacherId && t.status === 'active');
  if (!teacher) {
    return { ok: false, error: 'Docente no encontrado en esta institución.', code: 'not_found' };
  }

  const [schoolsRes, coursesRes, subjectsRes, schoolIds, courseIds, subjectIds] = await Promise.all([
    listSchoolsForInstitutionAdmin(actor, { includeInactive: true }),
    listCoursesForInstitutionAdmin(actor),
    listSubjectsForInstitutionAdmin(actor, { includeInactive: true }),
    listAssignedIds('school', gate.ctx.tenantId, teacher.userId),
    listAssignedIds('course', gate.ctx.tenantId, teacher.userId),
    listAssignedIds('subject', gate.ctx.tenantId, teacher.userId),
  ]);

  if (!schoolsRes.ok) return { ok: false, error: schoolsRes.error, code: schoolsRes.code as AssignmentWriteCode };
  if (!coursesRes.ok) return { ok: false, error: coursesRes.error, code: coursesRes.code as AssignmentWriteCode };
  if (!subjectsRes.ok) return { ok: false, error: subjectsRes.error, code: subjectsRes.code as AssignmentWriteCode };

  const schoolSet = new Set(schoolIds);
  const courseSet = new Set(courseIds);
  const subjectSet = new Set(subjectIds);

  return {
    ok: true,
    view: {
      teacher,
      schools: mapSchoolOptions(schoolsRes.schools, schoolSet),
      courses: mapCourseOptions(coursesRes.courses, courseSet),
      subjects: mapSubjectOptions(subjectsRes.subjects, subjectSet),
      schoolIds,
      courseIds,
      subjectIds,
    },
  };
}

export async function assignTeacherResourceForInstitutionAdmin(
  actor: User,
  input: { teacherId: string; type: unknown; resourceId: string },
): Promise<AssignmentWriteResult> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const type = parseAssignmentType(input.type);
  if (!type) {
    return { ok: false, error: 'type debe ser school|course|subject.', code: 'validation' };
  }

  const teacherGate = await requireActiveTeacherInTenant(input.teacherId, gate.ctx.tenantId);
  if (!teacherGate.ok) return teacherGate;

  const resourceGate = await assertResourceInTenant(type, input.resourceId, gate.ctx.tenantId);
  if (!resourceGate.ok) return resourceGate;

  const tenantId = gate.ctx.tenantId;
  const docenteId = teacherGate.teacherId;
  const resourceId = String(input.resourceId).trim();

  if (type === 'school') {
    const existing = (await db.prepare(`
      SELECT 1 AS ok FROM docente_escuelas
      WHERE tenant_id = ? AND docente_id = ? AND escuela_id = ?
    `).get(tenantId, docenteId, resourceId)) as { ok: number } | undefined;
    if (existing) {
      return { ok: false, error: 'La asignación ya existe.', code: 'conflict' };
    }
    await db.prepare(`
      INSERT INTO docente_escuelas (tenant_id, docente_id, escuela_id)
      VALUES (?, ?, ?)
    `).run(tenantId, docenteId, resourceId);
  } else if (type === 'course') {
    const existing = (await db.prepare(`
      SELECT 1 AS ok FROM docente_cursos
      WHERE tenant_id = ? AND docente_id = ? AND curso_id = ?
    `).get(tenantId, docenteId, resourceId)) as { ok: number } | undefined;
    if (existing) {
      return { ok: false, error: 'La asignación ya existe.', code: 'conflict' };
    }
    await db.prepare(`
      INSERT INTO docente_cursos (tenant_id, docente_id, curso_id)
      VALUES (?, ?, ?)
    `).run(tenantId, docenteId, resourceId);
  } else {
    const existing = (await db.prepare(`
      SELECT 1 AS ok FROM docente_materias
      WHERE tenant_id = ? AND docente_id = ? AND materia_id = ?
    `).get(tenantId, docenteId, resourceId)) as { ok: number } | undefined;
    if (existing) {
      return { ok: false, error: 'La asignación ya existe.', code: 'conflict' };
    }
    await db.prepare(`
      INSERT INTO docente_materias (tenant_id, docente_id, materia_id)
      VALUES (?, ?, ?)
    `).run(tenantId, docenteId, resourceId);
  }

  return {
    ok: true,
    type,
    teacherId: docenteId,
    resourceId,
    created: true,
  };
}

export async function unassignTeacherResourceForInstitutionAdmin(
  actor: User,
  input: { teacherId: string; type: unknown; resourceId: string },
): Promise<AssignmentWriteResult> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const type = parseAssignmentType(input.type);
  if (!type) {
    return { ok: false, error: 'type debe ser school|course|subject.', code: 'validation' };
  }

  const teacherGate = await requireActiveTeacherInTenant(input.teacherId, gate.ctx.tenantId);
  if (!teacherGate.ok) return teacherGate;

  const resourceGate = await assertResourceInTenant(type, input.resourceId, gate.ctx.tenantId);
  if (!resourceGate.ok) return resourceGate;

  const tenantId = gate.ctx.tenantId;
  const docenteId = teacherGate.teacherId;
  const resourceId = String(input.resourceId).trim();

  let changes = 0;
  if (type === 'school') {
    const result = await db.prepare(`
      DELETE FROM docente_escuelas
      WHERE tenant_id = ? AND docente_id = ? AND escuela_id = ?
    `).run(tenantId, docenteId, resourceId);
    changes = Number(result.changes || 0);
  } else if (type === 'course') {
    const result = await db.prepare(`
      DELETE FROM docente_cursos
      WHERE tenant_id = ? AND docente_id = ? AND curso_id = ?
    `).run(tenantId, docenteId, resourceId);
    changes = Number(result.changes || 0);
  } else {
    const result = await db.prepare(`
      DELETE FROM docente_materias
      WHERE tenant_id = ? AND docente_id = ? AND materia_id = ?
    `).run(tenantId, docenteId, resourceId);
    changes = Number(result.changes || 0);
  }

  if (!changes) {
    return { ok: false, error: 'Asignación no encontrada.', code: 'not_found' };
  }

  return {
    ok: true,
    type,
    teacherId: docenteId,
    resourceId,
    removed: true,
  };
}
