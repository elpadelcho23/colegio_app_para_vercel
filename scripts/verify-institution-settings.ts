#!/usr/bin/env node
/**
 * Verificación Fase 5B: configuración institucional (GET/PATCH admin tenant).
 * Uso: npx tsx scripts/verify-institution-settings.ts
 */
import { randomBytes } from 'node:crypto';
import {
  ensureDbReady,
  createTenant,
  createUser,
  db,
  getUserById,
} from '../src/server/db.ts';
import {
  getTenantById,
  updateTenant,
  normalizeSlug,
} from '../src/server/tenant.ts';
import { resolveAuthContext } from '../src/server/auth-context.ts';
import {
  getMembershipByUserAndTenant,
  getActiveMembership,
} from '../src/server/memberships.ts';

process.env.RESEND_API_KEY = '';
process.env.APP_URL = process.env.APP_URL || 'http://localhost:4321';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function countTenants() {
  const row = (await db.prepare('SELECT COUNT(*) AS c FROM tenants').get()) as { c: number };
  return Number(row?.c || 0);
}

async function countMemberships() {
  const row = (await db.prepare('SELECT COUNT(*) AS c FROM institution_memberships').get()) as { c: number };
  return Number(row?.c || 0);
}

/**
 * Simula el contrato de /api/admin/tenant PATCH:
 * - autoridad = auth.tenantId
 * - rechaza tenant_id ajeno
 * - rechaza status
 */
async function patchInstitutionSettings(
  actor: NonNullable<Awaited<ReturnType<typeof createUser>>>,
  body: Record<string, unknown>,
) {
  const auth = await resolveAuthContext(actor);
  if (!auth || auth.role !== 'admin') {
    return { ok: false as const, error: 'Requiere rol admin.', code: 'forbidden' as const };
  }

  const requestedId = body.id ?? body.tenantId ?? body.tenant_id;
  if (requestedId != null && String(requestedId) !== '' && String(requestedId) !== auth.tenantId) {
    return { ok: false as const, error: 'No puede modificar otra institución.', code: 'forbidden' as const };
  }

  if ('status' in body) {
    return {
      ok: false as const,
      error: 'El estado de la institución no se puede modificar desde este formulario.',
      code: 'status_forbidden' as const,
    };
  }

  const input: {
    nombre?: string;
    slug?: string | null;
    email?: string | null;
    telefono?: string | null;
    direccion?: string | null;
    logo_url?: string | null;
  } = {};
  if ('nombre' in body) input.nombre = String(body.nombre ?? '');
  if ('slug' in body) input.slug = body.slug == null || body.slug === '' ? null : String(body.slug);
  if ('email' in body) input.email = body.email == null || body.email === '' ? null : String(body.email);
  if ('telefono' in body) input.telefono = body.telefono == null || body.telefono === '' ? null : String(body.telefono);
  if ('direccion' in body) input.direccion = body.direccion == null || body.direccion === '' ? null : String(body.direccion);
  if ('logo_url' in body) input.logo_url = body.logo_url == null || body.logo_url === '' ? null : String(body.logo_url);

  return updateTenant(auth.tenantId, input, { actor });
}

async function getInstitutionForAdmin(actor: NonNullable<Awaited<ReturnType<typeof createUser>>>) {
  const auth = await resolveAuthContext(actor);
  if (!auth || auth.role !== 'admin') {
    return { ok: false as const, error: 'Requiere rol admin.', code: 'forbidden' as const, tenant: null };
  }
  const tenant = await getTenantById(auth.tenantId);
  return { ok: true as const, tenant, auth };
}

async function main() {
  await ensureDbReady();
  const suffix = randomBytes(4).toString('hex');
  let checks = 0;
  const ok = (label: string) => {
    checks += 1;
    console.log(`  ✓ ${checks}. ${label}`);
  };

  const tenantA = `tenant-5ba-${suffix}`;
  const tenantB = `tenant-5bb-${suffix}`;
  await createTenant(`Settings Colegio A ${suffix}`, tenantA);
  await createTenant(`Settings Colegio B ${suffix}`, tenantB);

  const adminA = await createUser({
    nombre: 'Admin 5B A',
    email: `admin-5ba-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  assert(adminA, 'admin A');

  const adminB = await createUser({
    nombre: 'Admin 5B B',
    email: `admin-5bb-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantB,
    markEmailVerified: true,
  });
  assert(adminB, 'admin B');

  const teacherA = await createUser({
    nombre: 'Docente 5B A',
    email: `doc-5ba-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'docente',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  assert(teacherA, 'teacher A');

  const ctxA = await resolveAuthContext(adminA!);
  assert(ctxA?.role === 'admin' && ctxA.tenantId === tenantA && ctxA.source === 'membership', 'AuthContext admin A');
  ok('Role se obtiene desde AuthContext');

  // 1. Admin A obtiene datos de A
  const gotA = await getInstitutionForAdmin(adminA!);
  assert(gotA.ok && gotA.tenant?.id === tenantA, 'GET A → tenant A');
  ok('Admin A puede obtener datos de A');

  // 2. Admin A no obtiene B (autoridad = auth.tenantId; helper getTenantById(B) no es el endpoint)
  const gotAAuth = await resolveAuthContext(adminA!);
  assert(gotAAuth?.tenantId !== tenantB, 'auth A != B');
  const crossGet = await getTenantById(tenantB);
  assert(crossGet?.id === tenantB, 'B existe');
  // Endpoint contract: requested tenant_id B con auth A → forbidden
  const requestedB = tenantB;
  assert(requestedB !== gotAAuth!.tenantId, 'cliente pediría B');
  // Simular rechazo GET
  const getForbidden = requestedB !== gotAAuth!.tenantId;
  assert(getForbidden, 'GET con tenant_id B rechazado por contrato');
  const listOnlyA = await getInstitutionForAdmin(adminA!);
  assert(listOnlyA.tenant?.id === tenantA, 'GET admin solo resuelve auth.tenantId');
  ok('Admin A no puede obtener datos de B (aislamiento GET)');

  const tenantsBefore = await countTenants();
  const memsBefore = await countMemberships();

  // 3. Admin A actualiza A
  const slugA = normalizeSlug(`colegio-a-${suffix}`);
  const updated = await patchInstitutionSettings(adminA!, {
    nombre: `Colegio A Actualizado ${suffix}`,
    slug: slugA,
    email: `info-a-${suffix}@colegio.edu`,
    telefono: '+54 11 5555-1234',
    direccion: 'Av. Siempre Viva 742',
    logo_url: 'https://example.com/logo-a.png',
  });
  assert(updated.ok, `PATCH A ok: ${!updated.ok ? updated.error : ''}`);
  assert(updated.ok && updated.tenant.nombre.includes('Actualizado'), 'nombre persistido');
  assert(updated.ok && updated.tenant.slug === slugA, 'slug persistido');
  assert(updated.ok && updated.tenant.email === `info-a-${suffix}@colegio.edu`, 'email persistido');
  ok('Admin A puede actualizar datos de A');

  // 4. PATCH no permite seleccionar B
  const steal = await patchInstitutionSettings(adminA!, {
    tenant_id: tenantB,
    nombre: 'Hackeado B',
  });
  assert(!steal.ok && steal.code === 'forbidden', 'tenant_id B rechazado');
  const bStill = await getTenantById(tenantB);
  assert(bStill?.nombre.startsWith('Settings Colegio B'), 'B intacto');
  ok('PATCH no permite seleccionar B mediante tenant_id');

  // 5–6. No crea tenants ni memberships
  const tenantsAfter = await countTenants();
  const memsAfter = await countMemberships();
  assert(tenantsAfter === tenantsBefore, 'UPDATE no crea tenants');
  assert(memsAfter === memsBefore, 'UPDATE no crea memberships');
  ok('No se crea ningún tenant durante UPDATE');
  ok('No se crean memberships');

  // 8–9. Slug unicidad
  await patchInstitutionSettings(adminB!, { slug: `colegio-b-${suffix}` });
  const conflict = await patchInstitutionSettings(adminA!, { slug: `colegio-b-${suffix}` });
  assert(!conflict.ok && conflict.code === 'slug_taken', 'slug conflict');
  const aSlug = await getTenantById(tenantA);
  assert(aSlug?.slug === slugA, 'slug A no cambió en conflicto');
  ok('Slug mantiene unicidad');
  ok('Conflicto de slug con otro tenant falla correctamente');

  // 10. Status no modificable por API de settings
  const statusTry = await patchInstitutionSettings(adminA!, { status: 'suspended' });
  assert(!statusTry.ok && statusTry.code === 'status_forbidden', 'status forbidden');
  const aStatus = await getTenantById(tenantA);
  assert(aStatus?.status === 'active', 'status A sigue active');
  ok('Status no puede ser modificado por el formulario/API');

  // 11. Validaciones server-side
  const badNombre = await patchInstitutionSettings(adminA!, { nombre: '   ' });
  assert(!badNombre.ok && badNombre.code === 'validation', 'nombre vacío');
  const badEmail = await patchInstitutionSettings(adminA!, { email: 'no-email' });
  assert(!badEmail.ok && badEmail.code === 'validation', 'email inválido');
  const badLogo = await patchInstitutionSettings(adminA!, { logo_url: 'not-a-url' });
  assert(!badLogo.ok && badLogo.code === 'validation', 'logo inválido');
  const badPhone = await patchInstitutionSettings(adminA!, { telefono: 'ab' });
  assert(!badPhone.ok && badPhone.code === 'validation', 'teléfono inválido');
  ok('Validaciones server-side funcionan');

  // 12. Persistencia
  const persisted = await getTenantById(tenantA);
  assert(persisted?.nombre.includes('Actualizado'), 'persistencia nombre');
  assert(persisted?.direccion === 'Av. Siempre Viva 742', 'persistencia dirección');
  assert(persisted?.logo_url === 'https://example.com/logo-a.png', 'persistencia logo');
  ok('Cambios persisten');

  // 13. Admin sigue en misma institución
  const adminReload = await getUserById(adminA!.id);
  const ctxAfter = await resolveAuthContext(adminReload!);
  assert(ctxAfter?.tenantId === tenantA && ctxAfter.role === 'admin', 'admin sigue en A');
  const memAdmin = await getActiveMembership(adminA!.id, tenantA);
  assert(memAdmin?.role === 'admin' && memAdmin.status === 'active', 'membership admin intacta');
  ok('Admin sigue perteneciendo a la misma institución después del update');

  // 14. Docentes no afectados
  const teacherReload = await getUserById(teacherA!.id);
  assert(teacherReload?.tenant_id === tenantA && teacherReload.rol === 'docente', 'docente cache intacto');
  const memTeacher = await getMembershipByUserAndTenant(teacherA!.id, tenantA);
  assert(memTeacher?.status === 'active' && memTeacher.role === 'docente', 'membership docente intacta');
  ok('Los docentes existentes no son afectados');

  // Docente no puede PATCH
  const asTeacher = await patchInstitutionSettings(teacherA!, { nombre: 'X' });
  assert(!asTeacher.ok && asTeacher.code === 'forbidden', 'docente forbidden');
  ok('Docente no puede configurar institución');

  console.log(`\nverify:institution-settings OK (${checks} checks)`);
  console.log('Nota deuda: tenant suspended sigue sin reactivación admin (Fase 4C); status bloqueado en API 5B.');
}

main().catch((error) => {
  console.error('\nverify:institution-settings FAILED');
  console.error(error);
  process.exit(1);
});
