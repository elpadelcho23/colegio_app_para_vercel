import { randomBytes } from 'node:crypto';
import { db, createUser, type User } from './db';
import { isStrongPassword } from './auth';
import { validateEmailFormat, issuePasswordReset, findUserByEmail } from './auth-email';
import { resolveAuthContext, isInstitutionAdmin } from './auth-context';
import {
  createMembership,
  getMembershipByUserAndTenant,
  revokeMembership,
  type InstitutionMembership,
  type MembershipWriteResult,
} from './memberships';

/**
 * Fase 5A — Gestión institucional de docentes.
 *
 * Autoridad: AuthContext (membership admin del tenant activo).
 * Nunca crea tenants. Nunca confía en tenant_id/rol del cliente.
 * Guests: no se gestionan aquí (no tienen memberships).
 */

export type TeacherRow = {
  userId: string;
  membershipId: string;
  nombre: string;
  email: string;
  status: 'active' | 'revoked';
  role: 'docente';
  created_at: string;
  revoked_at: string | null;
};

export type TeacherWriteCode =
  | 'forbidden'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'needs_reactivation'
  | 'wrong_role';

export type TeacherListResult =
  | { ok: true; teachers: TeacherRow[] }
  | { ok: false; error: string; code: TeacherWriteCode; teachers: TeacherRow[] };

export type TeacherWriteResult =
  | {
      ok: true;
      teacher: TeacherRow;
      createdUser: boolean;
      invitedByEmail: boolean;
      membership: InstitutionMembership;
    }
  | { ok: false; error: string; code: TeacherWriteCode };

export type AddTeacherInput = {
  nombre: string;
  email: string;
  /** Contraseña temporal opcional. Si falta, se genera y se envía reset. */
  password?: string | null;
  cursoIds?: string[];
  materiaIds?: string[];
  /** Origin para links de email (reset). */
  origin?: string;
};

async function requireInstitutionAdmin(actor: User | null | undefined) {
  const ctx = await resolveAuthContext(actor);
  if (!ctx || !isInstitutionAdmin(ctx) || !actor) {
    return { ok: false as const, error: 'Requiere rol admin.', code: 'forbidden' as const, ctx: null };
  }
  return { ok: true as const, ctx, actor };
}

function mapTeacherRow(row: Record<string, unknown>): TeacherRow | null {
  if (!row) return null;
  const status = String(row.status || '');
  if (status !== 'active' && status !== 'revoked') return null;
  return {
    userId: String(row.user_id),
    membershipId: String(row.membership_id || row.id),
    nombre: String(row.nombre || ''),
    email: String(row.email || ''),
    status,
    role: 'docente',
    created_at: String(row.created_at || ''),
    revoked_at: row.revoked_at == null || row.revoked_at === '' ? null : String(row.revoked_at),
  };
}

async function getTeacherRowForMembership(
  membershipId: string,
  tenantId: string,
): Promise<TeacherRow | null> {
  const row = (await db.prepare(`
    SELECT
      m.id AS membership_id,
      m.user_id,
      m.status,
      m.created_at,
      m.revoked_at,
      u.nombre,
      u.email
    FROM institution_memberships m
    INNER JOIN usuarios u ON u.id = m.user_id
    WHERE m.id = ?
      AND m.tenant_id = ?
      AND m.role = 'docente'
  `).get(membershipId, tenantId)) as Record<string, unknown> | undefined;
  return mapTeacherRow(row || null);
}

async function getTeacherRowForUser(
  userId: string,
  tenantId: string,
): Promise<TeacherRow | null> {
  const row = (await db.prepare(`
    SELECT
      m.id AS membership_id,
      m.user_id,
      m.status,
      m.created_at,
      m.revoked_at,
      u.nombre,
      u.email
    FROM institution_memberships m
    INNER JOIN usuarios u ON u.id = m.user_id
    WHERE m.user_id = ?
      AND m.tenant_id = ?
      AND m.role = 'docente'
  `).get(userId, tenantId)) as Record<string, unknown> | undefined;
  return mapTeacherRow(row || null);
}

/**
 * Lista SOLO docentes (role=docente) de auth.tenantId.
 * Incluye active y revoked (para reactivar desde UI).
 */
export async function listTeachersForInstitutionAdmin(actor: User): Promise<TeacherListResult> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) {
    return { ok: false, error: gate.error, code: gate.code, teachers: [] };
  }

  const rows = (await db.prepare(`
    SELECT
      m.id AS membership_id,
      m.user_id,
      m.status,
      m.created_at,
      m.revoked_at,
      u.nombre,
      u.email
    FROM institution_memberships m
    INNER JOIN usuarios u ON u.id = m.user_id
    WHERE m.tenant_id = ?
      AND m.role = 'docente'
    ORDER BY
      CASE WHEN m.status = 'active' THEN 0 ELSE 1 END,
      u.nombre COLLATE NOCASE ASC,
      m.created_at DESC
  `).all(gate.ctx.tenantId)) as Array<Record<string, unknown>>;

  return {
    ok: true,
    teachers: rows.map((row) => mapTeacherRow(row)).filter((t): t is TeacherRow => Boolean(t)),
  };
}

function generateTempPassword() {
  // Cumple isStrongPassword: letras + dígitos, >= 5.
  return `Tmp${randomBytes(9).toString('base64url')}9`;
}

async function assignPedagogy(
  tenantId: string,
  docenteId: string,
  cursoIds: string[] = [],
  materiaIds: string[] = [],
) {
  if (!cursoIds.length && !materiaIds.length) return;

  const allowedCourses = new Set(
    ((await db.prepare('SELECT id FROM cursos WHERE tenant_id = ?').all(tenantId)) as Array<{ id: string }>)
      .map((row) => row.id),
  );
  const allowedSubjects = new Set(
    ((await db.prepare('SELECT id FROM materias WHERE tenant_id = ?').all(tenantId)) as Array<{ id: string }>)
      .map((row) => row.id),
  );

  const safeCursoIds = cursoIds.filter((id) => allowedCourses.has(id));
  const safeMateriaIds = materiaIds.filter((id) => allowedSubjects.has(id));

  const assignCourse = db.prepare(
    'INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)',
  );
  for (const cursoId of safeCursoIds) await assignCourse.run(tenantId, docenteId, cursoId);

  const assignSubject = db.prepare(
    'INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id) VALUES (?, ?, ?)',
  );
  for (const materiaId of safeMateriaIds) await assignSubject.run(tenantId, docenteId, materiaId);
}

/**
 * Agrega o invita un docente a la institución del admin.
 * - Nunca crea tenant.
 * - Nunca duplica membership (user_id, tenant_id).
 * - Membership revoked existente → needs_reactivation (reactivación explícita).
 */
export async function addOrInviteTeacher(
  actor: User,
  input: AddTeacherInput,
): Promise<TeacherWriteResult> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const tenantId = gate.ctx.tenantId;
  const nombre = String(input.nombre || '').trim();
  const email = validateEmailFormat(String(input.email || ''));
  if (!nombre || !email) {
    return { ok: false, error: 'Nombre y email válidos son obligatorios.', code: 'validation' };
  }

  const passwordRaw = input.password == null ? '' : String(input.password);
  const hasPassword = Boolean(passwordRaw);
  if (hasPassword && !isStrongPassword(passwordRaw)) {
    return { ok: false, error: 'Contraseña débil.', code: 'validation' };
  }

  const existingUser = await findUserByEmail(email);
  if (existingUser?.is_guest) {
    return { ok: false, error: 'No se puede invitar una cuenta invitada.', code: 'validation' };
  }

  if (existingUser) {
    const existingMem = await getMembershipByUserAndTenant(existingUser.id, tenantId);
    if (existingMem) {
      if (existingMem.status === 'active') {
        return {
          ok: false,
          error: 'Este usuario ya pertenece activamente a esta institución.',
          code: 'conflict',
        };
      }
      // Revoked: no crear otra fila; exigir reactivación explícita.
      return {
        ok: false,
        error: 'Existe una membership revocada. Usá reactivar en lugar de crear otra.',
        code: 'needs_reactivation',
      };
    }

    // Sin membership en esta institución: crear membership docente (no tocar otras instituciones).
    const created = await createMembership(
      { userId: existingUser.id, tenantId, role: 'docente' },
      { actor: gate.actor },
    );
    if (!created.ok) {
      return { ok: false, error: created.error, code: created.code };
    }

    // Compat cache: solo si el usuario aún no tiene otro tenant home, o ya apunta a esta institución.
    // Single-context: no forzamos switch de tenant_id si ya tiene otro contexto.
    if (!existingUser.tenant_id || existingUser.tenant_id === tenantId) {
      await db.prepare(`
        UPDATE usuarios
        SET tenant_id = ?, rol = 'docente', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(tenantId, existingUser.id);
    }

    await assignPedagogy(tenantId, existingUser.id, input.cursoIds, input.materiaIds);

    const teacher = await getTeacherRowForUser(existingUser.id, tenantId);
    if (!teacher) return { ok: false, error: 'Docente no persistido.', code: 'not_found' };
    return {
      ok: true,
      teacher,
      createdUser: false,
      invitedByEmail: false,
      membership: created.membership,
    };
  }

  // Usuario nuevo: SIEMPRE pasar tenant_id del AuthContext (evita createTenant).
  const password = hasPassword ? passwordRaw : generateTempPassword();
  const createdUser = await createUser({
    nombre,
    email,
    password,
    rol: 'docente',
    tenant_id: tenantId,
    markEmailVerified: true,
  });
  if (!createdUser) {
    return { ok: false, error: 'No se pudo crear el usuario docente.', code: 'conflict' };
  }

  // createUser ya sincroniza membership active docente.
  const membership = await getMembershipByUserAndTenant(createdUser.id, tenantId);
  if (!membership || membership.status !== 'active' || membership.role !== 'docente') {
    // Defensa: asegurar membership sin crear tenant.
    const ensured = await createMembership(
      { userId: createdUser.id, tenantId, role: 'docente' },
      { actor: gate.actor },
    );
    if (!ensured.ok) {
      return { ok: false, error: ensured.error, code: ensured.code };
    }
  }

  await assignPedagogy(tenantId, createdUser.id, input.cursoIds, input.materiaIds);

  let invitedByEmail = false;
  if (!hasPassword) {
    // Infra existente Fase 1: reset para que el docente elija su contraseña.
    await issuePasswordReset(email, input.origin);
    invitedByEmail = true;
  }

  const finalMembership = await getMembershipByUserAndTenant(createdUser.id, tenantId);
  const teacher = await getTeacherRowForUser(createdUser.id, tenantId);
  if (!teacher || !finalMembership) {
    return { ok: false, error: 'Docente no persistido.', code: 'not_found' };
  }

  return {
    ok: true,
    teacher,
    createdUser: true,
    invitedByEmail,
    membership: finalMembership,
  };
}

async function resolveDocenteMembershipInTenant(
  tenantId: string,
  input: { userId?: string | null; membershipId?: string | null },
): Promise<
  | { ok: true; membership: InstitutionMembership }
  | { ok: false; error: string; code: TeacherWriteCode }
> {
  const membershipId = input.membershipId ? String(input.membershipId).trim() : '';
  const userId = input.userId ? String(input.userId).trim() : '';

  if (membershipId) {
    const row = (await db.prepare(`
      SELECT id, user_id, tenant_id, role, status, created_at, revoked_at
      FROM institution_memberships
      WHERE id = ? AND tenant_id = ?
    `).get(membershipId, tenantId)) as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: 'Membership no encontrada en esta institución.', code: 'not_found' };
    if (String(row.role) !== 'docente') {
      return { ok: false, error: 'Solo se gestionan memberships con rol docente.', code: 'wrong_role' };
    }
    return {
      ok: true,
      membership: {
        id: String(row.id),
        user_id: String(row.user_id),
        tenant_id: String(row.tenant_id),
        role: 'docente',
        status: String(row.status) === 'revoked' ? 'revoked' : 'active',
        created_at: String(row.created_at || ''),
        revoked_at: row.revoked_at == null || row.revoked_at === '' ? null : String(row.revoked_at),
      },
    };
  }

  if (userId) {
    const membership = await getMembershipByUserAndTenant(userId, tenantId);
    if (!membership) {
      return { ok: false, error: 'Membership no encontrada en esta institución.', code: 'not_found' };
    }
    if (membership.role !== 'docente') {
      return { ok: false, error: 'Solo se gestionan memberships con rol docente.', code: 'wrong_role' };
    }
    return { ok: true, membership };
  }

  return { ok: false, error: 'Indicar userId o membershipId.', code: 'validation' };
}

/**
 * Revoca membership docente en auth.tenantId.
 * No elimina el usuario. No toca otras instituciones.
 */
export async function revokeTeacher(
  actor: User,
  input: { userId?: string | null; membershipId?: string | null },
): Promise<TeacherWriteResult> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const resolved = await resolveDocenteMembershipInTenant(gate.ctx.tenantId, input);
  if (!resolved.ok) return resolved;

  const result = await revokeMembership(resolved.membership.user_id, gate.ctx.tenantId, {
    actor: gate.actor,
  });
  if (!result.ok) return { ok: false, error: result.error, code: result.code };

  const teacher = await getTeacherRowForUser(resolved.membership.user_id, gate.ctx.tenantId);
  if (!teacher) return { ok: false, error: 'Docente no encontrado tras revocar.', code: 'not_found' };

  return {
    ok: true,
    teacher,
    createdUser: false,
    invitedByEmail: false,
    membership: result.membership,
  };
}

/**
 * Reactiva membership docente existente (misma fila).
 * No crea otra membership.
 */
export async function reactivateTeacher(
  actor: User,
  input: { userId?: string | null; membershipId?: string | null },
): Promise<TeacherWriteResult> {
  const gate = await requireInstitutionAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const resolved = await resolveDocenteMembershipInTenant(gate.ctx.tenantId, input);
  if (!resolved.ok) return resolved;

  const { membership } = resolved;
  if (membership.status === 'active' && !membership.revoked_at) {
    const teacher = await getTeacherRowForUser(membership.user_id, gate.ctx.tenantId);
    if (!teacher) return { ok: false, error: 'Docente no encontrado.', code: 'not_found' };
    return {
      ok: true,
      teacher,
      createdUser: false,
      invitedByEmail: false,
      membership,
    };
  }

  await db.prepare(`
    UPDATE institution_memberships
    SET status = 'active', revoked_at = NULL, role = 'docente'
    WHERE id = ? AND tenant_id = ?
  `).run(membership.id, gate.ctx.tenantId);

  // Compat cache: si el home del usuario es esta institución, alinear rol.
  await db.prepare(`
    UPDATE usuarios
    SET rol = 'docente', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ?
  `).run(membership.user_id, gate.ctx.tenantId);

  const refreshed = await getMembershipByUserAndTenant(membership.user_id, gate.ctx.tenantId);
  const teacher = await getTeacherRowForUser(membership.user_id, gate.ctx.tenantId);
  if (!refreshed || !teacher) {
    return { ok: false, error: 'No se pudo reactivar la membership.', code: 'not_found' };
  }

  return {
    ok: true,
    teacher,
    createdUser: false,
    invitedByEmail: false,
    membership: refreshed,
  };
}

export function teacherWriteStatus(code: TeacherWriteCode | MembershipWriteResult['code']): number {
  switch (code) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
    case 'needs_reactivation':
      return 409;
    case 'wrong_role':
      return 400;
    default:
      return 400;
  }
}

/** Utilidad de tests: cuenta tenants (para assert no-create). */
export async function countTenants(): Promise<number> {
  const row = (await db.prepare('SELECT COUNT(*) AS c FROM tenants').get()) as { c: number };
  return Number(row?.c || 0);
}
