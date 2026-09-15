import { db, type User } from './db';
import { resolveAuthContext } from './auth-context';

export interface CourseSeed {
  id: string;
  nombre?: string;
  escuela?: string;
  turno?: string;
  cicloLectivo?: number;
}

export interface SubjectSeed {
  id: string;
  nombre?: string;
  activo?: boolean;
}

async function courseOwnedByOtherTenant(courseId: string, tenantId: string) {
  const row = (await db.prepare('SELECT tenant_id FROM cursos WHERE id = ?').get(courseId)) as { tenant_id: string } | undefined;
  return Boolean(row && row.tenant_id !== tenantId);
}

async function subjectOwnedByOtherTenant(subjectId: string, tenantId: string) {
  const row = (await db.prepare('SELECT tenant_id FROM materias WHERE id = ?').get(subjectId)) as { tenant_id: string } | undefined;
  return Boolean(row && row.tenant_id !== tenantId);
}

export async function ensureDocenteCourseAccess(user: User, course: CourseSeed): Promise<string | null> {
  const ctx = await resolveAuthContext(user);
  if (!ctx) return 'No autorizado.';
  if (!course.id) return 'Curso inválido.';

  // Primero aislamiento de tenant (también para admin).
  if (await courseOwnedByOtherTenant(course.id, ctx.tenantId)) {
    return 'Este curso pertenece a otra cuenta.';
  }

  if (ctx.role === 'admin') return null;

  const linked = await db.prepare(`
    SELECT 1
    FROM docente_cursos
    WHERE tenant_id = ? AND docente_id = ? AND curso_id = ?
  `).get(ctx.tenantId, user.id, course.id);
  if (linked) return null;

  const existing = await db.prepare('SELECT id FROM cursos WHERE id = ? AND tenant_id = ?').get(course.id, ctx.tenantId);
  const updatedAt = new Date().toISOString();

  if (!existing) {
    const nombre = String(course.nombre || '').trim();
    const escuela = String(course.escuela || '').trim();
    const turno = String(course.turno || '').trim();
    if (!nombre || !escuela || !turno) {
      return 'El curso aún no está sincronizado con el servidor. Volvé a intentar en unos segundos o recargá la página.';
    }

    await db.prepare(`
      INSERT INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      course.id,
      ctx.tenantId,
      escuela,
      nombre,
      turno,
      course.cicloLectivo || new Date().getFullYear(),
      updatedAt,
    );
  }

  await db.prepare(`
    INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id)
    VALUES (?, ?, ?)
  `).run(ctx.tenantId, user.id, course.id);

  return null;
}

export async function ensureDocenteSubjectAccess(user: User, subject: SubjectSeed): Promise<string | null> {
  const ctx = await resolveAuthContext(user);
  if (!ctx) return 'No autorizado.';
  if (!subject.id) return 'Materia inválida.';

  if (await subjectOwnedByOtherTenant(subject.id, ctx.tenantId)) {
    return 'Esta materia pertenece a otra cuenta.';
  }

  if (ctx.role === 'admin') return null;

  const linked = await db.prepare(`
    SELECT 1
    FROM docente_materias
    WHERE tenant_id = ? AND docente_id = ? AND materia_id = ?
  `).get(ctx.tenantId, user.id, subject.id);
  if (linked) return null;

  const existing = await db.prepare('SELECT id FROM materias WHERE id = ? AND tenant_id = ?').get(subject.id, ctx.tenantId);
  const updatedAt = new Date().toISOString();

  if (!existing) {
    const nombre = String(subject.nombre || '').trim();
    if (!nombre) {
      return 'La materia aún no está sincronizada con el servidor. Volvé a intentar en unos segundos o recargá la página.';
    }

    await db.prepare(`
      INSERT INTO materias (id, tenant_id, nombre, activo, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(subject.id, ctx.tenantId, nombre, subject.activo === false ? 0 : 1, updatedAt);
  }

  await db.prepare(`
    INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id)
    VALUES (?, ?, ?)
  `).run(ctx.tenantId, user.id, subject.id);

  return null;
}
