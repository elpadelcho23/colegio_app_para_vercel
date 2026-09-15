import { randomBytes } from 'node:crypto';
import { db, type User } from './db';

/**
 * Fase 3 — Institution Memberships
 *
 * Representación sincronizada del vínculo usuario↔institución.
 * Fuente de tenant en runtime: sigue siendo `usuarios.tenant_id` (Fase 2/actual).
 * Esta tabla prepara la futura migración de auth sin reemplazarla todavía.
 *
 * Decisiones de consistencia (relevantes para Fase 4+):
 * 1. UNIQUE(user_id, tenant_id): una fila por par; revoke = status/revoked_at.
 *    NO hay unique parcial "una sola active por user": eso bloquearía multi-institución.
 * 2. Guests (`usuarios.is_guest=1`) NO generan memberships: son efímeros y se purgan.
 * 3. Role membership = usuarios.rol al crear/sincronizar; no hay RBAC extendido aún.
 * 4. Helpers de escritura que reciben `actor` exigen admin del mismo tenant_id.
 *    La sync interna (`ensureActiveMembershipForUser`) es system-only, sin actor cliente.
 */

export const MEMBERSHIP_ROLES = ['admin', 'docente'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'revoked'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export interface InstitutionMembership {
  id: string;
  user_id: string;
  tenant_id: string;
  role: MembershipRole;
  status: MembershipStatus;
  created_at: string;
  revoked_at: string | null;
}

export type MembershipWriteResult =
  | { ok: true; membership: InstitutionMembership }
  | { ok: false; error: string; code: 'forbidden' | 'not_found' | 'validation' | 'conflict' };

const MEMBERSHIP_SELECT = `
  id, user_id, tenant_id, role, status, created_at, revoked_at
`;

function isMembershipRole(value: unknown): value is MembershipRole {
  return typeof value === 'string' && (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

function mapMembership(row: Record<string, unknown> | undefined | null): InstitutionMembership | null {
  if (!row) return null;
  const role = String(row.role || '');
  const status = String(row.status || '');
  if (!isMembershipRole(role) || !isMembershipStatus(status)) return null;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    tenant_id: String(row.tenant_id),
    role,
    status,
    created_at: String(row.created_at || ''),
    revoked_at: row.revoked_at == null || row.revoked_at === '' ? null : String(row.revoked_at),
  };
}

function newMembershipId() {
  return `mem-${randomBytes(10).toString('hex')}`;
}

export async function getMembershipByUserAndTenant(
  userId: string,
  tenantId: string,
): Promise<InstitutionMembership | null> {
  if (!userId || !tenantId) return null;
  const row = (await db.prepare(`
    SELECT ${MEMBERSHIP_SELECT}
    FROM institution_memberships
    WHERE user_id = ? AND tenant_id = ?
  `).get(userId, tenantId)) as Record<string, unknown> | undefined;
  return mapMembership(row);
}

export async function getActiveMembership(
  userId: string,
  tenantId: string,
): Promise<InstitutionMembership | null> {
  if (!userId || !tenantId) return null;
  const row = (await db.prepare(`
    SELECT ${MEMBERSHIP_SELECT}
    FROM institution_memberships
    WHERE user_id = ?
      AND tenant_id = ?
      AND status = 'active'
      AND (revoked_at IS NULL OR revoked_at = '')
  `).get(userId, tenantId)) as Record<string, unknown> | undefined;
  return mapMembership(row);
}

export async function getUserMemberships(
  userId: string,
  options: { includeRevoked?: boolean } = {},
): Promise<InstitutionMembership[]> {
  if (!userId) return [];
  const rows = options.includeRevoked
    ? ((await db.prepare(`
        SELECT ${MEMBERSHIP_SELECT}
        FROM institution_memberships
        WHERE user_id = ?
        ORDER BY created_at ASC
      `).all(userId)) as Array<Record<string, unknown>>)
    : ((await db.prepare(`
        SELECT ${MEMBERSHIP_SELECT}
        FROM institution_memberships
        WHERE user_id = ? AND status = 'active'
        ORDER BY created_at ASC
      `).all(userId)) as Array<Record<string, unknown>>);

  return rows.map((row) => mapMembership(row)).filter((m): m is InstitutionMembership => Boolean(m));
}

/**
 * Lista memberships de la institución del admin autenticado.
 * El tenant_id SIEMPRE sale del AuthContext (nunca del cliente).
 */
export async function listMembershipsForInstitutionAdmin(actor: User) {
  const { resolveAuthContext } = await import('./auth-context');
  const ctx = await resolveAuthContext(actor);
  if (!ctx || ctx.role !== 'admin') {
    return { ok: false as const, error: 'Requiere rol admin.', code: 'forbidden' as const, memberships: [] as InstitutionMembership[] };
  }

  const rows = (await db.prepare(`
    SELECT ${MEMBERSHIP_SELECT}
    FROM institution_memberships
    WHERE tenant_id = ?
    ORDER BY created_at DESC
  `).all(ctx.tenantId)) as Array<Record<string, unknown>>;

  return {
    ok: true as const,
    memberships: rows.map((row) => mapMembership(row)).filter((m): m is InstitutionMembership => Boolean(m)),
  };
}

export type CreateMembershipInput = {
  userId: string;
  tenantId: string;
  role: MembershipRole;
};

/**
 * Crea o reactiva membership.
 * Con `actor`: solo admin del mismo tenant.
 * Con `system: true`: sync interna (migración / createUser) — no usar desde input de cliente.
 */
export async function createMembership(
  input: CreateMembershipInput,
  options: { actor?: User; system?: boolean } = {},
): Promise<MembershipWriteResult> {
  const { userId, tenantId, role } = input;
  if (!userId || !tenantId || !isMembershipRole(role)) {
    return { ok: false, error: 'Datos de membership inválidos.', code: 'validation' };
  }

  if (!options.system) {
    const { resolveAuthContext } = await import('./auth-context');
    const ctx = await resolveAuthContext(options.actor);
    if (!ctx || ctx.role !== 'admin' || ctx.tenantId !== tenantId) {
      return { ok: false, error: 'No puede administrar memberships de otra institución.', code: 'forbidden' };
    }
  }

  const userRow = (await db.prepare(`
    SELECT id, COALESCE(is_guest, 0) AS is_guest
    FROM usuarios WHERE id = ?
  `).get(userId)) as { id: string; is_guest: number } | undefined;
  if (!userRow) return { ok: false, error: 'Usuario no encontrado.', code: 'not_found' };
  if (Number(userRow.is_guest) === 1) {
    return { ok: false, error: 'Los invitados no tienen memberships permanentes.', code: 'validation' };
  }

  const tenantRow = (await db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) as { id: string } | undefined;
  if (!tenantRow) return { ok: false, error: 'Institución no encontrada.', code: 'not_found' };

  const existing = await getMembershipByUserAndTenant(userId, tenantId);
  if (existing) {
    if (existing.status === 'active' && existing.role === role) {
      return { ok: true, membership: existing };
    }
    await db.prepare(`
      UPDATE institution_memberships
      SET role = ?, status = 'active', revoked_at = NULL
      WHERE id = ?
    `).run(role, existing.id);
    const refreshed = await getMembershipByUserAndTenant(userId, tenantId);
    if (!refreshed) return { ok: false, error: 'No se pudo reactivar membership.', code: 'not_found' };
    return { ok: true, membership: refreshed };
  }

  const id = newMembershipId();
  try {
    await db.prepare(`
      INSERT INTO institution_memberships (id, user_id, tenant_id, role, status, created_at, revoked_at)
      VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
    `).run(id, userId, tenantId, role);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/UNIQUE constraint failed/i.test(message)) {
      const again = await getMembershipByUserAndTenant(userId, tenantId);
      if (again) return { ok: true, membership: again };
      return { ok: false, error: 'Membership duplicada.', code: 'conflict' };
    }
    throw error;
  }

  const created = await getMembershipByUserAndTenant(userId, tenantId);
  if (!created) return { ok: false, error: 'Membership no persistida.', code: 'not_found' };
  return { ok: true, membership: created };
}

export async function revokeMembership(
  userId: string,
  tenantId: string,
  options: { actor?: User; system?: boolean } = {},
): Promise<MembershipWriteResult> {
  if (!options.system) {
    const { resolveAuthContext } = await import('./auth-context');
    const ctx = await resolveAuthContext(options.actor);
    if (!ctx || ctx.role !== 'admin' || ctx.tenantId !== tenantId) {
      return { ok: false, error: 'No puede administrar memberships de otra institución.', code: 'forbidden' };
    }
  }

  const existing = await getMembershipByUserAndTenant(userId, tenantId);
  if (!existing) return { ok: false, error: 'Membership no encontrada.', code: 'not_found' };
  if (existing.status === 'revoked') return { ok: true, membership: existing };

  await db.prepare(`
    UPDATE institution_memberships
    SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(existing.id);

  const refreshed = await getMembershipByUserAndTenant(userId, tenantId);
  if (!refreshed) return { ok: false, error: 'Membership no encontrada tras revoke.', code: 'not_found' };
  return { ok: true, membership: refreshed };
}

/**
 * Mantiene la membership activa alineada con usuarios.tenant_id + usuarios.rol.
 * Idempotente. No-op para guests. No modifica usuarios.tenant_id.
 */
export async function ensureActiveMembershipForUser(user: Pick<User, 'id' | 'tenant_id' | 'rol' | 'is_guest'>) {
  if (!user?.id || !user.tenant_id) return null;
  if (user.is_guest) return null;
  if (!isMembershipRole(user.rol)) return null;

  const result = await createMembership(
    { userId: user.id, tenantId: user.tenant_id, role: user.rol },
    { system: true },
  );
  return result.ok ? result.membership : null;
}
