import { db, type User } from './db';
import { validateEmailFormat } from './auth-email';

export const TENANT_STATUSES = ['active', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface Tenant {
  id: string;
  nombre: string;
  slug: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  logo_url: string | null;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

export interface TenantStats {
  tenant_id: string;
  usuarios: number;
  docentes: number;
  admins: number;
  cursos: number;
  materias: number;
  alumnos: number;
}

export type TenantUpdateInput = {
  nombre?: string;
  slug?: string | null;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  logo_url?: string | null;
  status?: TenantStatus;
};

export type TenantUpdateResult =
  | { ok: true; tenant: Tenant }
  | { ok: false; error: string; code: 'not_found' | 'forbidden' | 'validation' | 'slug_taken' };

const TENANT_SELECT = `
  id, nombre, slug, email, telefono, direccion, logo_url, status, created_at, updated_at
`;

function mapTenant(row: Record<string, unknown> | undefined | null): Tenant | null {
  if (!row) return null;
  const status = String(row.status || 'active');
  return {
    id: String(row.id),
    nombre: String(row.nombre),
    slug: row.slug == null || row.slug === '' ? null : String(row.slug),
    email: row.email == null || row.email === '' ? null : String(row.email),
    telefono: row.telefono == null || row.telefono === '' ? null : String(row.telefono),
    direccion: row.direccion == null || row.direccion === '' ? null : String(row.direccion),
    logo_url: row.logo_url == null || row.logo_url === '' ? null : String(row.logo_url),
    status: isTenantStatus(status) ? status : 'active',
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

export function isTenantStatus(value: unknown): value is TenantStatus {
  return typeof value === 'string' && (TENANT_STATUSES as readonly string[]).includes(value);
}

/** Normaliza slug institucional: minúsculas, ASCII-ish, guiones, sin espacios. */
export function normalizeSlug(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function validateTenantStatus(value: unknown): TenantStatus | null {
  if (value == null || value === '') return null;
  return isTenantStatus(value) ? value : null;
}

export function validateInstitutionEmail(email: unknown): string | null {
  if (email == null || email === '') return null;
  return validateEmailFormat(String(email));
}

export async function isSlugAvailable(slug: string, excludeTenantId?: string): Promise<boolean> {
  const normalized = normalizeSlug(slug);
  if (!normalized) return false;
  const row = (await db.prepare(`
    SELECT id FROM tenants
    WHERE lower(slug) = lower(?)
      AND (? IS NULL OR id != ?)
    LIMIT 1
  `).get(normalized, excludeTenantId ?? null, excludeTenantId ?? null)) as { id: string } | undefined;
  return !row;
}

export async function allocateUniqueSlug(seed: string, excludeTenantId?: string): Promise<string> {
  const base = normalizeSlug(seed) || `tenant-${Date.now().toString(36)}`;
  let candidate = base;
  let n = 2;
  while (!(await isSlugAvailable(candidate, excludeTenantId))) {
    candidate = `${base}-${n}`.slice(0, 80);
    n += 1;
    if (n > 500) {
      candidate = `${base}-${Math.random().toString(36).slice(2, 8)}`;
      break;
    }
  }
  return candidate;
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const row = (await db.prepare(`
    SELECT ${TENANT_SELECT}
    FROM tenants
    WHERE id = ?
  `).get(id)) as Record<string, unknown> | undefined;
  return mapTenant(row);
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  const row = (await db.prepare(`
    SELECT ${TENANT_SELECT}
    FROM tenants
    WHERE lower(slug) = lower(?)
  `).get(normalized)) as Record<string, unknown> | undefined;
  return mapTenant(row);
}

/**
 * Actualiza datos institucionales.
 * `actor` debe ser admin del mismo tenant; el id de destino nunca se toma del cliente sin verificar.
 */
export async function updateTenant(
  tenantId: string,
  input: TenantUpdateInput,
  options: { actor: User },
): Promise<TenantUpdateResult> {
  const actor = options.actor;
  if (!actor || actor.rol !== 'admin') {
    return { ok: false, error: 'Requiere rol admin.', code: 'forbidden' };
  }
  if (actor.tenant_id !== tenantId) {
    return { ok: false, error: 'No puede modificar otra institución.', code: 'forbidden' };
  }

  const current = await getTenantById(tenantId);
  if (!current) return { ok: false, error: 'Institución no encontrada.', code: 'not_found' };

  const next: TenantUpdateInput = {};

  if (input.nombre !== undefined) {
    const nombre = String(input.nombre || '').trim();
    if (!nombre || nombre.length > 200) {
      return { ok: false, error: 'Nombre institucional inválido.', code: 'validation' };
    }
    next.nombre = nombre;
  }

  if (input.slug !== undefined) {
    if (input.slug == null || input.slug === '') {
      next.slug = null;
    } else {
      const slug = normalizeSlug(String(input.slug));
      if (!slug || slug.length < 2) {
        return { ok: false, error: 'Slug inválido.', code: 'validation' };
      }
      if (!(await isSlugAvailable(slug, tenantId))) {
        return { ok: false, error: 'El slug ya pertenece a otra institución.', code: 'slug_taken' };
      }
      next.slug = slug;
    }
  }

  if (input.email !== undefined) {
    if (input.email == null || input.email === '') {
      next.email = null;
    } else {
      const email = validateInstitutionEmail(input.email);
      if (!email) return { ok: false, error: 'Email institucional inválido.', code: 'validation' };
      next.email = email;
    }
  }

  if (input.telefono !== undefined) {
    const telefono = input.telefono == null ? null : String(input.telefono).trim().slice(0, 60);
    next.telefono = telefono || null;
  }

  if (input.direccion !== undefined) {
    const direccion = input.direccion == null ? null : String(input.direccion).trim().slice(0, 500);
    next.direccion = direccion || null;
  }

  if (input.logo_url !== undefined) {
    if (input.logo_url == null || input.logo_url === '') {
      next.logo_url = null;
    } else {
      const logo = String(input.logo_url).trim().slice(0, 2000);
      if (!/^https?:\/\//i.test(logo) && !logo.startsWith('/')) {
        return { ok: false, error: 'logo_url inválido.', code: 'validation' };
      }
      next.logo_url = logo;
    }
  }

  if (input.status !== undefined) {
    const status = validateTenantStatus(input.status);
    if (!status) return { ok: false, error: 'Status inválido (active|suspended).', code: 'validation' };
    next.status = status;
  }

  const keys = Object.keys(next) as Array<keyof TenantUpdateInput>;
  if (keys.length === 0) {
    return { ok: true, tenant: current };
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of keys) {
    sets.push(`${key} = ?`);
    values.push(next[key] ?? null);
  }
  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(tenantId);

  await db.prepare(`
    UPDATE tenants
    SET ${sets.join(', ')}
    WHERE id = ?
  `).run(...values);

  const updated = await getTenantById(tenantId);
  if (!updated) return { ok: false, error: 'Institución no encontrada tras actualizar.', code: 'not_found' };
  return { ok: true, tenant: updated };
}

export async function getTenantStats(tenantId: string): Promise<TenantStats | null> {
  const exists = await getTenantById(tenantId);
  if (!exists) return null;

  const users = (await db.prepare(`
    SELECT
      COUNT(*) AS usuarios,
      SUM(CASE WHEN rol = 'docente' THEN 1 ELSE 0 END) AS docentes,
      SUM(CASE WHEN rol = 'admin' THEN 1 ELSE 0 END) AS admins
    FROM usuarios
    WHERE tenant_id = ?
  `).get(tenantId)) as { usuarios: number; docentes: number; admins: number };

  const cursos = (await db.prepare('SELECT COUNT(*) AS c FROM cursos WHERE tenant_id = ?').get(tenantId)) as { c: number };
  const materias = (await db.prepare('SELECT COUNT(*) AS c FROM materias WHERE tenant_id = ?').get(tenantId)) as { c: number };
  const alumnos = (await db.prepare('SELECT COUNT(*) AS c FROM alumnos WHERE tenant_id = ?').get(tenantId)) as { c: number };

  return {
    tenant_id: tenantId,
    usuarios: Number(users?.usuarios || 0),
    docentes: Number(users?.docentes || 0),
    admins: Number(users?.admins || 0),
    cursos: Number(cursos?.c || 0),
    materias: Number(materias?.c || 0),
    alumnos: Number(alumnos?.c || 0),
  };
}

/**
 * Lista usuarios del tenant del admin autenticado.
 * Nunca acepta un tenant_id externo: siempre usa actor.tenant_id.
 */
export async function listUsersForInstitutionAdmin(actor: User) {
  if (!actor || actor.rol !== 'admin') {
    return { ok: false as const, error: 'Requiere rol admin.', code: 'forbidden' as const, users: [] };
  }

  const users = (await db.prepare(`
    SELECT
      usuarios.id,
      usuarios.nombre,
      usuarios.email,
      usuarios.rol,
      usuarios.created_at,
      usuarios.tenant_id,
      tenants.nombre AS tenant
    FROM usuarios
    LEFT JOIN tenants ON tenants.id = usuarios.tenant_id
    WHERE usuarios.tenant_id = ?
    ORDER BY usuarios.created_at DESC
  `).all(actor.tenant_id)) as Array<{
    id: string;
    nombre: string;
    email: string;
    rol: string;
    created_at: string;
    tenant_id: string;
    tenant: string;
  }>;

  return { ok: true as const, users };
}
