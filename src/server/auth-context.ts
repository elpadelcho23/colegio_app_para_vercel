import { db, type User } from './db';
import { getActiveMembership, type MembershipRole } from './memberships';
import { getTenantById } from './tenant';

/**
 * Fase 4B — AuthContext (single-context).
 *
 * - No-guest: autoridad = membership active para (user.id, user.tenant_id).
 * - Guest: legacy usuarios.tenant_id / usuarios.rol.
 * - Sin fallback de seguridad ante membership faltante/revocada o drift.
 * - usuarios.tenant_id solo identifica el contexto institucional actual (compat).
 */

export type AuthContextSource = 'membership' | 'guest-legacy';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: MembershipRole;
  membershipId?: string;
  source: AuthContextSource;
}

export type AuthContextDenialReason =
  | 'no_user'
  | 'no_membership'
  | 'membership_revoked'
  | 'tenant_suspended'
  | 'tenant_missing'
  | 'role_invalid';

export type ResolveAuthContextResult =
  | { ok: true; context: AuthContext }
  | { ok: false; reason: AuthContextDenialReason };

/**
 * Resuelve el contexto de autorización desde DB (membership + tenant status).
 * No confía en Passport/cookie/user.rol como autoridad.
 */
export async function resolveAuthContext(user: User | null | undefined): Promise<AuthContext | null> {
  const result = await resolveAuthContextDetailed(user);
  return result.ok ? result.context : null;
}

export async function resolveAuthContextDetailed(
  user: User | null | undefined,
): Promise<ResolveAuthContextResult> {
  if (!user?.id) return { ok: false, reason: 'no_user' };

  if (user.is_guest) {
    const role = user.rol === 'admin' || user.rol === 'docente' ? user.rol : null;
    if (!role || !user.tenant_id) return { ok: false, reason: 'role_invalid' };
    return {
      ok: true,
      context: {
        userId: user.id,
        tenantId: user.tenant_id,
        role,
        source: 'guest-legacy',
      },
    };
  }

  if (!user.tenant_id) return { ok: false, reason: 'no_membership' };

  const membership = await getActiveMembership(user.id, user.tenant_id);
  if (!membership) {
    // Distinguir revoked vs missing para diagnóstico (ambos deniegan).
    const row = (await db.prepare(`
      SELECT status, revoked_at
      FROM institution_memberships
      WHERE user_id = ? AND tenant_id = ?
    `).get(user.id, user.tenant_id)) as { status: string; revoked_at: string | null } | undefined;

    if (row && (row.status === 'revoked' || row.revoked_at)) {
      return { ok: false, reason: 'membership_revoked' };
    }
    return { ok: false, reason: 'no_membership' };
  }

  if (membership.revoked_at) {
    return { ok: false, reason: 'membership_revoked' };
  }

  const tenant = await getTenantById(membership.tenant_id);
  if (!tenant) return { ok: false, reason: 'tenant_missing' };
  if (tenant.status === 'suspended') return { ok: false, reason: 'tenant_suspended' };

  return {
    ok: true,
    context: {
      userId: user.id,
      tenantId: membership.tenant_id,
      role: membership.role,
      membershipId: membership.id,
      source: 'membership',
    },
  };
}

/** Copia de User con tenant/role efectivos del AuthContext (para handlers legacy). */
export function applyAuthContextToUser(user: User, context: AuthContext): User {
  return {
    ...user,
    tenant_id: context.tenantId,
    rol: context.role,
  };
}

export function isInstitutionAdmin(context: AuthContext | null | undefined): boolean {
  return Boolean(context && context.role === 'admin');
}
