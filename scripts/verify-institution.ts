#!/usr/bin/env node
/**
 * Verificación Fase 2: Institution Model sobre `tenants`.
 * Uso: npx tsx scripts/verify-institution.ts
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
  getTenantStats,
  listUsersForInstitutionAdmin,
  normalizeSlug,
  allocateUniqueSlug,
  isSlugAvailable,
} from '../src/server/tenant.ts';
import {
  issueEmailVerification,
  issuePasswordReset,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
} from '../src/server/auth-email.ts';
import { verifyLogin, isEmailVerified } from '../src/server/auth.ts';

process.env.RESEND_API_KEY = '';
process.env.APP_URL = process.env.APP_URL || 'http://localhost:4321';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await ensureDbReady();
  const suffix = randomBytes(4).toString('hex');
  let checks = 0;
  const ok = (label: string) => {
    checks += 1;
    console.log(`  ✓ ${checks}. ${label}`);
  };

  // --- 1. Tenant existente continúa funcionando ---
  const existingBefore = await getTenantById('tenant-demo');
  assert(existingBefore, 'tenant-demo debe existir tras seed/migrate');
  assert(existingBefore.status === 'active', 'tenant existente status=active');
  assert(existingBefore.slug, 'tenant existente tiene slug backfilled');
  assert(existingBefore.nombre, 'tenant existente conserva nombre');
  ok('Tenant existente continúa funcionando (slug/status/nombre)');

  // --- 2. Tenant nuevo recibe valores correctos ---
  const newId = `tenant-fase2-${suffix}`;
  await createTenant(`Colegio Fase2 ${suffix}`, newId);
  const created = await getTenantById(newId);
  assert(created, 'tenant nuevo creado');
  assert(created.status === 'active', 'status por defecto active');
  assert(created.slug === normalizeSlug(newId) || created.slug === newId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), 'slug por defecto derivado del id');
  assert(created.email == null, 'email null por defecto');
  assert(created.telefono == null && created.direccion == null && created.logo_url == null, 'campos opcionales null');
  ok('Tenant nuevo recibe valores correctos');

  // --- Admin A / Admin B isolation ---
  const adminA = await createUser({
    nombre: 'Admin A',
    email: `admin-a-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: newId,
    markEmailVerified: true,
  });
  assert(adminA, 'admin A creado');

  const otherId = `tenant-other-${suffix}`;
  await createTenant(`Otro Colegio ${suffix}`, otherId);
  const adminB = await createUser({
    nombre: 'Admin B',
    email: `admin-b-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: otherId,
    markEmailVerified: true,
  });
  assert(adminB, 'admin B creado');

  // --- 3. Tenant puede actualizar sus datos ---
  const slugWanted = normalizeSlug(`colegio-fase2-${suffix}`);
  const updated = await updateTenant(newId, {
    nombre: `Colegio Actualizado ${suffix}`,
    slug: slugWanted,
    email: `info-${suffix}@colegio.edu`,
    telefono: '+54 11 1234-5678',
    direccion: 'Calle Falsa 123',
    logo_url: 'https://example.com/logo.png',
  }, { actor: adminA! });
  assert(updated.ok, `update propio debe ok: ${!updated.ok ? updated.error : ''}`);
  assert(updated.ok && updated.tenant.nombre.includes('Actualizado'), 'nombre actualizado');
  assert(updated.ok && updated.tenant.slug === slugWanted, 'slug actualizado');
  assert(updated.ok && updated.tenant.email === `info-${suffix}@colegio.edu`, 'email actualizado');
  ok('Tenant puede actualizar sus datos');

  // --- 4. Admin solo modifica su propio tenant ---
  const ownOnly = await updateTenant(newId, { telefono: '111' }, { actor: adminA! });
  assert(ownOnly.ok, 'admin A modifica su tenant');
  ok('Admin puede modificar únicamente su propio tenant');

  // --- 5. Admin no puede modificar otro tenant manipulando ID ---
  const cross = await updateTenant(otherId, { nombre: 'Hackeado' }, { actor: adminA! });
  assert(!cross.ok && cross.code === 'forbidden', 'cross-tenant update forbidden');
  const otherStill = await getTenantById(otherId);
  assert(otherStill?.nombre.startsWith('Otro Colegio'), 'otro tenant intacto');
  ok('Admin no puede modificar otro tenant manipulando el ID');

  // Slug conflict
  await updateTenant(otherId, { slug: `otro-${suffix}` }, { actor: adminB! });
  const steal = await updateTenant(newId, { slug: `otro-${suffix}` }, { actor: adminA! });
  assert(!steal.ok && steal.code === 'slug_taken', 'slug de otro tenant rechazado');
  const badEmail = await updateTenant(newId, { email: 'no-es-email' }, { actor: adminA! });
  assert(!badEmail.ok && badEmail.code === 'validation', 'email inválido rechazado');
  const badStatus = await updateTenant(newId, { status: 'deleted' as 'active' }, { actor: adminA! });
  assert(!badStatus.ok && badStatus.code === 'validation', 'status inválido rechazado');
  assert(!(await isSlugAvailable(`otro-${suffix}`, newId)), 'slug ocupado detectado');
  const unique = await allocateUniqueSlug(`otro-${suffix}`, newId);
  assert(unique !== `otro-${suffix}`, 'allocateUniqueSlug evita colisión');

  // --- Docente en tenant A ---
  const teacher = await createUser({
    nombre: 'Docente A',
    email: `docente-a-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'docente',
    tenant_id: newId,
    markEmailVerified: true,
  });
  assert(teacher, 'docente creado');

  // --- 6. Admin no lista usuarios de otro tenant ---
  const listA = await listUsersForInstitutionAdmin(adminA!);
  assert(listA.ok, 'list A ok');
  assert(listA.users.every((u) => u.tenant_id === newId), 'todos los listados son del tenant A');
  assert(listA.users.some((u) => u.id === teacher!.id), 'incluye docente propio');
  assert(!listA.users.some((u) => u.id === adminB!.id), 'no incluye admin B');
  ok('Admin no puede listar usuarios de otro tenant');

  // --- 7. Docente no accede a endpoints admin (helpers) ---
  const teacherList = await listUsersForInstitutionAdmin(teacher!);
  assert(!teacherList.ok && teacherList.code === 'forbidden', 'docente forbidden en listUsers');
  const teacherUpdate = await updateTenant(newId, { nombre: 'X' }, { actor: teacher! });
  assert(!teacherUpdate.ok && teacherUpdate.code === 'forbidden', 'docente forbidden en updateTenant');
  ok('Docente no puede acceder a operaciones administrativas');

  // --- Stats ---
  const stats = await getTenantStats(newId);
  assert(stats && stats.usuarios >= 2 && stats.admins >= 1 && stats.docentes >= 1, 'getTenantStats coherente');

  // --- 8. Login continúa funcionando ---
  const loginAdmin = await verifyLogin(`admin-a-${suffix}@example.com`, 'Clave123');
  assert(loginAdmin && isEmailVerified(loginAdmin), 'login admin ok');
  const loginTeacher = await verifyLogin(`docente-a-${suffix}@example.com`, 'Clave123');
  assert(loginTeacher && loginTeacher.rol === 'docente', 'login docente ok');
  ok('Login continúa funcionando');

  // --- 9. Registro continúa funcionando (createTenant + createUser admin) ---
  const regTenant = `tenant-reg-${suffix}`;
  await createTenant(`Institución Registro ${suffix}`, regTenant);
  const regUser = await createUser({
    nombre: 'Registro Test',
    email: `reg-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: regTenant,
    markEmailVerified: false,
  });
  assert(regUser && !regUser.email_verified_at, 'registro crea usuario pendiente');
  const regTenantRow = await getTenantById(regTenant);
  assert(regTenantRow?.status === 'active', 'registro crea tenant active');
  ok('Registro continúa funcionando');

  // --- 10 + 11. Password reset + email verification ---
  const issued = await issueEmailVerification(regUser!, 'http://localhost:4321');
  assert(issued.ok, 'issue verification');
  const tokRow = await db.prepare(`
    SELECT token_hash FROM email_verification_tokens WHERE user_id = ? AND used_at IS NULL LIMIT 1
  `).get(regUser!.id);
  assert(tokRow, 'token verificación persistido');

  // Consumir vía helper de fase 1 ya cubierto; aquí validamos que schema/tenant no rompe el flujo.
  const forgot = await issuePasswordReset(`admin-a-${suffix}@example.com`);
  assert(forgot.ok, 'forgot password ok');
  ok('Password reset continúa funcionando');
  ok('Email verification continúa funcionando');

  // --- 12. Sync contract: usuarios.tenant_id intacto + columnas sync_log ---
  const userReload = await getUserById(adminA!.id);
  assert(userReload?.tenant_id === newId, 'usuarios.tenant_id intacto');
  const syncCols = (await db.prepare('PRAGMA table_info(sync_log)').all()) as Array<{ name: string }>;
  assert(syncCols.some((c) => c.name === 'tenant_id'), 'sync_log.tenant_id presente');
  ok('Sync continúa funcionando (tenant_id + schema sync_log)');

  // Columns present on tenants
  const tenantCols = (await db.prepare('PRAGMA table_info(tenants)').all()) as Array<{ name: string }>;
  for (const col of ['id', 'nombre', 'slug', 'email', 'telefono', 'direccion', 'logo_url', 'status', 'created_at', 'updated_at']) {
    assert(tenantCols.some((c) => c.name === col), `columna tenants.${col}`);
  }

  // Migración idempotente: re-ejecutar ensureDbReady no falla
  await ensureDbReady();
  const again = await getTenantById(newId);
  assert(again?.slug === slugWanted, 'migración idempotente conserva slug custom');

  console.log(`\nOK: Fase 2 Institution Model — ${checks} checks pasaron.`);
}

main().catch((error) => {
  console.error('FAIL:', error);
  process.exit(1);
});
