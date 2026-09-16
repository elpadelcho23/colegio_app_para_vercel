import { randomBytes } from 'node:crypto';
import { db, type User } from './db';
import { resolveAuthContext, isInstitutionAdmin } from './auth-context';
import { currentCalendarYear } from './ciclo-lectivo';

/**
 * Fase 5C Part 2 — Admin sobre estructura académica EXISTENTE.
 * Tablas: escuelas, cursos, materias (sin modelo paralelo).
 * Autoridad: AuthContext (admin + auth.tenantId).
 * cursos.escuela permanece TEXT (nombre), no FK.
 */

export type AcademicWriteCode =
  | 'forbidden'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'has_dependencies';

export type AcademicWriteResult<T> =
  | { ok: true; row: T }
  | { ok: false; error: string; code: AcademicWriteCode };

export type SchoolRow = {
  id: string;
  tenant_id: string;
  nombre: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export type CourseRow = {
  id: string;
  tenant_id: string;
  escuela: string;
  nombre: string;
  turno: string;
  ciclo_lectivo: number;
  created_at: string;
  updated_at: string;
  alumnos_count?: number;
};

export type SubjectRow = {
  id: string;
  tenant_id: string;
  nombre: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

async function requireInstitutionAdmin(actor: User | null | undefined) {
  const ctx = await resolveAuthContext(actor);
  if (!ctx || !isInstitutionAdmin(ctx) || !actor) {
    return { ok: false as const, error: 'Requiere rol admin.', code: 'forbidden' as const, ctx: null };
  }
  return { ok: true as const, ctx, actor };
}

function newId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

function mapSchool(row: Record<string, unknown> | undefined | null): SchoolRow | null {
  if (!row) return null;
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    nombre: String(row.nombre || ''),
    activo: Number(row.activo) === 1,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

function mapCourse(row: Record<string, unknown> | undefined | null): CourseRow | null {
  if (!row) return null;
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    escuela: String(row.escuela || ''),
    nombre: String(row.nombre || ''),
    turno: String(row.turno || ''),
    ciclo_lectivo: Number(row.ciclo_lectivo) || currentCalendarYear(),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
    alumnos_count: row.alumnos_count == null ? undefined : Number(row.alumnos_count),
  };
}

function mapSubject(row: Record<string, unknown> | undefined | null): SubjectRow | null {
  if (!row) return null;
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    nombre: String(row.nombre || ''),
    activo: Number(row.activo) === 1,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

export function academicWriteStatus(code: AcademicWriteCode): number {
  switch (code) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
    case 'has_dependencies':
      return 409;
    default:
      return 400;
  }
}

/** Reject client tenant_id that doesn't match auth. */
export function rejectForeignTenantId(
  authTenantId: string,
  body: Record<string, unknown>,
): AcademicWriteCode | null {
  const requested = body.tenant_id ?? body.tenantId;
  if (requested != null && String(requested) !== '' && String(requested) !== authTenantId) {
    return 'forbidden';
  }
  return null;
}

// --- Escuelas ---

export async function listSchoolsForInstitutionAdmin(
  actor: User,
  options: { includeInactive?: boolean } = {},
) {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false as const, error: gate.error, code: gate.code, schools: [] as SchoolRow[] };

  const rows = options.includeInactive
    ? ((await db.prepare(`
        SELECT id, tenant_id, nombre, activo, created_at, updated_at
        FROM escuelas
        WHERE tenant_id = ?
        ORDER BY activo DESC, nombre COLLATE NOCASE ASC
      `).all(gate.ctx.tenantId)) as Array<Record<string, unknown>>)
    : ((await db.prepare(`
        SELECT id, tenant_id, nombre, activo, created_at, updated_at
        FROM escuelas
        WHERE tenant_id = ? AND activo = 1
        ORDER BY nombre COLLATE NOCASE ASC
      `).all(gate.ctx.tenantId)) as Array<Record<string, unknown>>);

  return {
    ok: true as const,
    schools: rows.map((r) => mapSchool(r)).filter((s): s is SchoolRow => Boolean(s)),
  };
}

export async function getSchoolForInstitutionAdmin(actor: User, schoolId: string) {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false as const, error: gate.error, code: gate.code, school: null };

  const row = (await db.prepare(`
    SELECT id, tenant_id, nombre, activo, created_at, updated_at
    FROM escuelas
    WHERE id = ? AND tenant_id = ?
  `).get(schoolId, gate.ctx.tenantId)) as Record<string, unknown> | undefined;

  const school = mapSchool(row);
  if (!school) return { ok: false as const, error: 'Escuela no encontrada.', code: 'not_found' as const, school: null };
  return { ok: true as const, school };
}

export async function createSchoolForInstitutionAdmin(
  actor: User,
  input: { nombre: string },
): Promise<AcademicWriteResult<SchoolRow>> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const nombre = String(input.nombre || '').trim();
  if (!nombre || nombre.length > 200) {
    return { ok: false, error: 'Nombre de escuela inválido.', code: 'validation' };
  }

  const id = newId('escuela');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO escuelas (id, tenant_id, nombre, activo, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(id, gate.ctx.tenantId, nombre, now, now);

  const created = await getSchoolForInstitutionAdmin(actor, id);
  if (!created.ok || !created.school) return { ok: false, error: 'Escuela no persistida.', code: 'not_found' };
  return { ok: true, row: created.school };
}

export async function updateSchoolForInstitutionAdmin(
  actor: User,
  schoolId: string,
  input: { nombre?: string; activo?: boolean },
): Promise<AcademicWriteResult<SchoolRow>> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const existing = await getSchoolForInstitutionAdmin(actor, schoolId);
  if (!existing.ok || !existing.school) return { ok: false, error: 'Escuela no encontrada.', code: 'not_found' };

  const nextNombre = input.nombre !== undefined ? String(input.nombre).trim() : existing.school.nombre;
  if (!nextNombre || nextNombre.length > 200) {
    return { ok: false, error: 'Nombre de escuela inválido.', code: 'validation' };
  }
  const nextActivo = input.activo !== undefined ? Boolean(input.activo) : existing.school.activo;

  // Si renombramos, sincronizar cursos.escuela TEXT que matcheaban el nombre anterior (mismo tenant).
  // Limitación documentada: vínculo por nombre, no FK.
  const rename = nextNombre !== existing.school.nombre;
  const now = new Date().toISOString();

  const tx = db.transaction(async () => {
    await db.prepare(`
      UPDATE escuelas
      SET nombre = ?, activo = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(nextNombre, nextActivo ? 1 : 0, now, schoolId, gate.ctx.tenantId);

    if (rename) {
      await db.prepare(`
        UPDATE cursos
        SET escuela = ?, updated_at = ?
        WHERE tenant_id = ? AND escuela = ?
      `).run(nextNombre, now, gate.ctx.tenantId, existing.school.nombre);
    }
  });
  await tx();

  const refreshed = await getSchoolForInstitutionAdmin(actor, schoolId);
  if (!refreshed.ok || !refreshed.school) return { ok: false, error: 'Escuela no encontrada tras update.', code: 'not_found' };
  return { ok: true, row: refreshed.school };
}

/**
 * Soft-delete: activo=0.
 * No hard-delete (cursos referencian por nombre; histórico).
 */
export async function deactivateSchoolForInstitutionAdmin(
  actor: User,
  schoolId: string,
): Promise<AcademicWriteResult<SchoolRow>> {
  return updateSchoolForInstitutionAdmin(actor, schoolId, { activo: false });
}

export async function activateSchoolForInstitutionAdmin(
  actor: User,
  schoolId: string,
): Promise<AcademicWriteResult<SchoolRow>> {
  return updateSchoolForInstitutionAdmin(actor, schoolId, { activo: true });
}

// --- Cursos ---

export async function listCoursesForInstitutionAdmin(
  actor: User,
  options: { cicloLectivo?: number } = {},
) {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false as const, error: gate.error, code: gate.code, courses: [] as CourseRow[] };

  const rows = options.cicloLectivo
    ? ((await db.prepare(`
        SELECT c.id, c.tenant_id, c.escuela, c.nombre, c.turno, c.ciclo_lectivo, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM alumnos a WHERE a.tenant_id = c.tenant_id AND a.curso_id = c.id AND COALESCE(a.activo,1)=1) AS alumnos_count
        FROM cursos c
        WHERE c.tenant_id = ? AND c.ciclo_lectivo = ?
        ORDER BY c.escuela COLLATE NOCASE, c.nombre COLLATE NOCASE, c.turno COLLATE NOCASE
      `).all(gate.ctx.tenantId, options.cicloLectivo)) as Array<Record<string, unknown>>)
    : ((await db.prepare(`
        SELECT c.id, c.tenant_id, c.escuela, c.nombre, c.turno, c.ciclo_lectivo, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM alumnos a WHERE a.tenant_id = c.tenant_id AND a.curso_id = c.id AND COALESCE(a.activo,1)=1) AS alumnos_count
        FROM cursos c
        WHERE c.tenant_id = ?
        ORDER BY c.ciclo_lectivo DESC, c.escuela COLLATE NOCASE, c.nombre COLLATE NOCASE, c.turno COLLATE NOCASE
      `).all(gate.ctx.tenantId)) as Array<Record<string, unknown>>);

  return {
    ok: true as const,
    courses: rows.map((r) => mapCourse(r)).filter((c): c is CourseRow => Boolean(c)),
  };
}

export async function getCourseForInstitutionAdmin(actor: User, courseId: string) {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false as const, error: gate.error, code: gate.code, course: null };

  const row = (await db.prepare(`
    SELECT c.id, c.tenant_id, c.escuela, c.nombre, c.turno, c.ciclo_lectivo, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM alumnos a WHERE a.tenant_id = c.tenant_id AND a.curso_id = c.id) AS alumnos_count
    FROM cursos c
    WHERE c.id = ? AND c.tenant_id = ?
  `).get(courseId, gate.ctx.tenantId)) as Record<string, unknown> | undefined;

  const course = mapCourse(row);
  if (!course) return { ok: false as const, error: 'Curso no encontrado.', code: 'not_found' as const, course: null };
  return { ok: true as const, course };
}

export async function createCourseForInstitutionAdmin(
  actor: User,
  input: { escuela: string; nombre: string; turno: string; ciclo_lectivo?: number },
): Promise<AcademicWriteResult<CourseRow>> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const escuela = String(input.escuela || '').trim();
  const nombre = String(input.nombre || '').trim();
  const turno = String(input.turno || '').trim();
  const ciclo = Number(input.ciclo_lectivo) || currentCalendarYear();

  if (!escuela || escuela.length > 200) return { ok: false, error: 'Escuela inválida.', code: 'validation' };
  if (!nombre || nombre.length > 200) return { ok: false, error: 'Nombre de curso inválido.', code: 'validation' };
  if (!turno || turno.length > 80) return { ok: false, error: 'Turno inválido.', code: 'validation' };
  if (!Number.isFinite(ciclo) || ciclo < 2000 || ciclo > 2100) {
    return { ok: false, error: 'Ciclo lectivo inválido.', code: 'validation' };
  }

  // Compat: escuela TEXT — si hay escuela activa con ese nombre en el tenant, usamos ese nombre exacto.
  const schoolMatch = (await db.prepare(`
    SELECT nombre FROM escuelas
    WHERE tenant_id = ? AND lower(nombre) = lower(?) AND activo = 1
    LIMIT 1
  `).get(gate.ctx.tenantId, escuela)) as { nombre: string } | undefined;
  const escuelaNombre = schoolMatch?.nombre || escuela;

  const id = newId('curso');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, gate.ctx.tenantId, escuelaNombre, nombre, turno, ciclo, now, now);

  const created = await getCourseForInstitutionAdmin(actor, id);
  if (!created.ok || !created.course) return { ok: false, error: 'Curso no persistido.', code: 'not_found' };
  return { ok: true, row: created.course };
}

export async function updateCourseForInstitutionAdmin(
  actor: User,
  courseId: string,
  input: { escuela?: string; nombre?: string; turno?: string; ciclo_lectivo?: number },
): Promise<AcademicWriteResult<CourseRow>> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const existing = await getCourseForInstitutionAdmin(actor, courseId);
  if (!existing.ok || !existing.course) return { ok: false, error: 'Curso no encontrado.', code: 'not_found' };

  let escuela = input.escuela !== undefined ? String(input.escuela).trim() : existing.course.escuela;
  const nombre = input.nombre !== undefined ? String(input.nombre).trim() : existing.course.nombre;
  const turno = input.turno !== undefined ? String(input.turno).trim() : existing.course.turno;
  const ciclo = input.ciclo_lectivo !== undefined ? Number(input.ciclo_lectivo) : existing.course.ciclo_lectivo;

  if (!escuela || escuela.length > 200) return { ok: false, error: 'Escuela inválida.', code: 'validation' };
  if (!nombre || nombre.length > 200) return { ok: false, error: 'Nombre de curso inválido.', code: 'validation' };
  if (!turno || turno.length > 80) return { ok: false, error: 'Turno inválido.', code: 'validation' };
  if (!Number.isFinite(ciclo) || ciclo < 2000 || ciclo > 2100) {
    return { ok: false, error: 'Ciclo lectivo inválido.', code: 'validation' };
  }

  const schoolMatch = (await db.prepare(`
    SELECT nombre FROM escuelas
    WHERE tenant_id = ? AND lower(nombre) = lower(?) AND activo = 1
    LIMIT 1
  `).get(gate.ctx.tenantId, escuela)) as { nombre: string } | undefined;
  if (schoolMatch) escuela = schoolMatch.nombre;

  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE cursos
    SET escuela = ?, nombre = ?, turno = ?, ciclo_lectivo = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(escuela, nombre, turno, ciclo, now, courseId, gate.ctx.tenantId);

  const refreshed = await getCourseForInstitutionAdmin(actor, courseId);
  if (!refreshed.ok || !refreshed.course) return { ok: false, error: 'Curso no encontrado tras update.', code: 'not_found' };
  return { ok: true, row: refreshed.course };
}

/**
 * Cursos no tienen soft-delete. Hard-delete solo si no hay alumnos (como sync).
 */
export async function deleteCourseForInstitutionAdmin(
  actor: User,
  courseId: string,
): Promise<AcademicWriteResult<CourseRow> | { ok: true; deleted: true; row: CourseRow }> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const existing = await getCourseForInstitutionAdmin(actor, courseId);
  if (!existing.ok || !existing.course) return { ok: false, error: 'Curso no encontrado.', code: 'not_found' };

  const hasStudents = (await db.prepare(`
    SELECT 1 AS x FROM alumnos WHERE tenant_id = ? AND curso_id = ? LIMIT 1
  `).get(gate.ctx.tenantId, courseId)) as { x: number } | undefined;
  if (hasStudents) {
    return {
      ok: false,
      error: 'El curso tiene alumnos vinculados. No se puede eliminar.',
      code: 'has_dependencies',
    };
  }

  await db.prepare(`DELETE FROM docente_cursos WHERE tenant_id = ? AND curso_id = ?`).run(gate.ctx.tenantId, courseId);
  await db.prepare(`DELETE FROM cursos WHERE id = ? AND tenant_id = ?`).run(courseId, gate.ctx.tenantId);

  return { ok: true, deleted: true, row: existing.course };
}

// --- Materias ---

export async function listSubjectsForInstitutionAdmin(
  actor: User,
  options: { includeInactive?: boolean } = {},
) {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false as const, error: gate.error, code: gate.code, subjects: [] as SubjectRow[] };

  const rows = options.includeInactive
    ? ((await db.prepare(`
        SELECT id, tenant_id, nombre, activo, created_at, updated_at
        FROM materias
        WHERE tenant_id = ?
        ORDER BY activo DESC, nombre COLLATE NOCASE ASC
      `).all(gate.ctx.tenantId)) as Array<Record<string, unknown>>)
    : ((await db.prepare(`
        SELECT id, tenant_id, nombre, activo, created_at, updated_at
        FROM materias
        WHERE tenant_id = ? AND activo = 1
        ORDER BY nombre COLLATE NOCASE ASC
      `).all(gate.ctx.tenantId)) as Array<Record<string, unknown>>);

  return {
    ok: true as const,
    subjects: rows.map((r) => mapSubject(r)).filter((s): s is SubjectRow => Boolean(s)),
  };
}

export async function getSubjectForInstitutionAdmin(actor: User, subjectId: string) {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false as const, error: gate.error, code: gate.code, subject: null };

  const row = (await db.prepare(`
    SELECT id, tenant_id, nombre, activo, created_at, updated_at
    FROM materias
    WHERE id = ? AND tenant_id = ?
  `).get(subjectId, gate.ctx.tenantId)) as Record<string, unknown> | undefined;

  const subject = mapSubject(row);
  if (!subject) return { ok: false as const, error: 'Materia no encontrada.', code: 'not_found' as const, subject: null };
  return { ok: true as const, subject };
}

export async function createSubjectForInstitutionAdmin(
  actor: User,
  input: { nombre: string },
): Promise<AcademicWriteResult<SubjectRow>> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const nombre = String(input.nombre || '').trim();
  if (!nombre || nombre.length > 200) {
    return { ok: false, error: 'Nombre de materia inválido.', code: 'validation' };
  }

  const id = newId('materia');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO materias (id, tenant_id, nombre, activo, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(id, gate.ctx.tenantId, nombre, now, now);

  const created = await getSubjectForInstitutionAdmin(actor, id);
  if (!created.ok || !created.subject) return { ok: false, error: 'Materia no persistida.', code: 'not_found' };
  return { ok: true, row: created.subject };
}

export async function updateSubjectForInstitutionAdmin(
  actor: User,
  subjectId: string,
  input: { nombre?: string; activo?: boolean },
): Promise<AcademicWriteResult<SubjectRow>> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const existing = await getSubjectForInstitutionAdmin(actor, subjectId);
  if (!existing.ok || !existing.subject) return { ok: false, error: 'Materia no encontrada.', code: 'not_found' };

  const nombre = input.nombre !== undefined ? String(input.nombre).trim() : existing.subject.nombre;
  if (!nombre || nombre.length > 200) {
    return { ok: false, error: 'Nombre de materia inválido.', code: 'validation' };
  }
  const activo = input.activo !== undefined ? Boolean(input.activo) : existing.subject.activo;
  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE materias
    SET nombre = ?, activo = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(nombre, activo ? 1 : 0, now, subjectId, gate.ctx.tenantId);

  const refreshed = await getSubjectForInstitutionAdmin(actor, subjectId);
  if (!refreshed.ok || !refreshed.subject) return { ok: false, error: 'Materia no encontrada tras update.', code: 'not_found' };
  return { ok: true, row: refreshed.subject };
}

export async function deactivateSubjectForInstitutionAdmin(actor: User, subjectId: string) {
  return updateSubjectForInstitutionAdmin(actor, subjectId, { activo: false });
}

export async function activateSubjectForInstitutionAdmin(actor: User, subjectId: string) {
  return updateSubjectForInstitutionAdmin(actor, subjectId, { activo: true });
}
