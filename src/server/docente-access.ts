import { db, type User } from './db';

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

function courseOwnedByOtherTenant(courseId: string, tenantId: string) {
  const row = db.prepare('SELECT tenant_id FROM cursos WHERE id = ?').get(courseId) as { tenant_id: string } | undefined;
  return Boolean(row && row.tenant_id !== tenantId);
}

function subjectOwnedByOtherTenant(subjectId: string, tenantId: string) {
  const row = db.prepare('SELECT tenant_id FROM materias WHERE id = ?').get(subjectId) as { tenant_id: string } | undefined;
  return Boolean(row && row.tenant_id !== tenantId);
}

export function ensureDocenteCourseAccess(user: User, course: CourseSeed): string | null {
  if (user.rol === 'admin') return null;
  if (!course.id) return 'Curso inválido.';

  if (courseOwnedByOtherTenant(course.id, user.tenant_id)) {
    return 'Este curso pertenece a otra cuenta.';
  }

  const linked = db.prepare(`
    SELECT 1
    FROM docente_cursos
    WHERE tenant_id = ? AND docente_id = ? AND curso_id = ?
  `).get(user.tenant_id, user.id, course.id);
  if (linked) return null;

  const existing = db.prepare('SELECT id FROM cursos WHERE id = ? AND tenant_id = ?').get(course.id, user.tenant_id);
  const updatedAt = new Date().toISOString();

  if (!existing) {
    const nombre = String(course.nombre || '').trim();
    const escuela = String(course.escuela || '').trim();
    const turno = String(course.turno || '').trim();
    if (!nombre || !escuela || !turno) {
      return 'El curso aún no está sincronizado con el servidor. Volvé a intentar en unos segundos o recargá la página.';
    }

    db.prepare(`
      INSERT INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      course.id,
      user.tenant_id,
      escuela,
      nombre,
      turno,
      course.cicloLectivo || new Date().getFullYear(),
      updatedAt,
    );
  }

  db.prepare(`
    INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id)
    VALUES (?, ?, ?)
  `).run(user.tenant_id, user.id, course.id);

  return null;
}

export function ensureDocenteSubjectAccess(user: User, subject: SubjectSeed): string | null {
  if (user.rol === 'admin') return null;
  if (!subject.id) return 'Materia inválida.';

  if (subjectOwnedByOtherTenant(subject.id, user.tenant_id)) {
    return 'Esta materia pertenece a otra cuenta.';
  }

  const linked = db.prepare(`
    SELECT 1
    FROM docente_materias
    WHERE tenant_id = ? AND docente_id = ? AND materia_id = ?
  `).get(user.tenant_id, user.id, subject.id);
  if (linked) return null;

  const existing = db.prepare('SELECT id FROM materias WHERE id = ? AND tenant_id = ?').get(subject.id, user.tenant_id);
  const updatedAt = new Date().toISOString();

  if (!existing) {
    const nombre = String(subject.nombre || '').trim();
    if (!nombre) {
      return 'La materia aún no está sincronizada con el servidor. Volvé a intentar en unos segundos o recargá la página.';
    }

    db.prepare(`
      INSERT INTO materias (id, tenant_id, nombre, activo, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(subject.id, user.tenant_id, nombre, subject.activo === false ? 0 : 1, updatedAt);
  }

  db.prepare(`
    INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id)
    VALUES (?, ?, ?)
  `).run(user.tenant_id, user.id, subject.id);

  return null;
}
