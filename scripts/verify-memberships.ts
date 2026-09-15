#!/usr/bin/env node
/**
 * Verificación Fase 3: institution_memberships.
 * Uso: npx tsx scripts/verify-memberships.ts
 */
import { randomBytes } from 'node:crypto';
import {
  ensureDbReady,
  createTenant,
  createUser,
  createGuestUser,
  db,
  getUserById,
} from '../src/server/db.ts';
import {
  getMembershipByUserAndTenant,
  getActiveMembership,
  getUserMemberships,
  createMembership,
  revokeMembership,
  listMembershipsForInstitutionAdmin,
  ensureActiveMembershipForUser,
} from '../src/server/memberships.ts';

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

  // 1. Tabla existe
  const table = (await db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'institution_memberships'
  `).get()) as { name: string } | undefined;
  assert(table?.name === 'institution_memberships', 'tabla institution_memberships debe existir');
  ok('tabla institution_memberships existe');

  // 2. Columnas esperadas
  const cols = ((await db.prepare('PRAGMA table_info(institution_memberships)').all()) as Array<{ name: string }>)
    .map((c) => c.name);
  for (const col of ['id', 'user_id', 'tenant_id', 'role', 'status', 'created_at', 'revoked_at']) {
    assert(cols.includes(col), `columna ${col}`);
  }
  ok('columnas esperadas existen');

  // 3. Constraints / FKs (unique + FK invalid)
  const tenantA = `tenant-m3a-${suffix}`;
  const tenantB = `tenant-m3b-${suffix}`;
  await createTenant(`Membership Colegio A ${suffix}`, tenantA);
  await createTenant(`Membership Colegio B ${suffix}`, tenantB);

  let fkFailed = false;
  try {
    await db.prepare(`
      INSERT INTO institution_memberships (id, user_id, tenant_id, role, status)
      VALUES (?, ?, ?, 'docente', 'active')
    `).run(`mem-bad-${suffix}`, 'user-inexistente', tenantA);
  } catch {
    fkFailed = true;
  }
  assert(fkFailed, 'FK user_id debe rechazar usuario inexistente');
  ok('constraints/FKs funcionan');

  // 4. Usuarios existentes (no-guest) tienen membership correspondiente
  const nonGuests = (await db.prepare(`
    SELECT id, tenant_id, rol FROM usuarios
    WHERE COALESCE(is_guest, 0) = 0 AND rol IN ('admin', 'docente')
  `).all()) as Array<{ id: string; tenant_id: string; rol: string }>;
  assert(nonGuests.length > 0, 'debe haber usuarios no-guest');
  for (const u of nonGuests) {
    const m = await getActiveMembership(u.id, u.tenant_id);
    assert(m, `membership activa faltante para ${u.id}`);
    assert(m.role === u.rol, `role membership != usuarios.rol para ${u.id}`);
    assert(m.status === 'active', 'status active');
  }
  ok('usuarios existentes tienen membership correspondiente');

  // 5. No duplicadas
  const adminA = await createUser({
    nombre: 'Admin Mem A',
    email: `admin-mem-a-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  assert(adminA, 'admin A');
  const first = await getMembershipByUserAndTenant(adminA!.id, tenantA);
  assert(first, 'membership creada con createUser');
  const again = await ensureActiveMembershipForUser(adminA!);
  assert(again?.id === first!.id, 'ensure idempotente no duplica');
  const dup = await createMembership(
    { userId: adminA!.id, tenantId: tenantA, role: 'admin' },
    { system: true },
  );
  assert(dup.ok && dup.membership.id === first!.id, 'createMembership idempotente');
  const count = (await db.prepare(`
    SELECT COUNT(*) AS c FROM institution_memberships WHERE user_id = ? AND tenant_id = ?
  `).get(adminA!.id, tenantA)) as { c: number };
  assert(Number(count.c) === 1, 'exactamente una fila user/tenant');
  ok('no se crean memberships duplicadas');

  // 6 + 7. Roles admin y docente
  assert(first!.role === 'admin', 'role admin');
  const teacher = await createUser({
    nombre: 'Docente Mem',
    email: `doc-mem-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'docente',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  assert(teacher, 'docente');
  const teacherMem = await getActiveMembership(teacher!.id, tenantA);
  assert(teacherMem?.role === 'docente', 'role docente');
  ok('role admin funciona');
  ok('role docente funciona');

  // 8. Revoked
  const revoked = await revokeMembership(teacher!.id, tenantA, { system: true });
  assert(revoked.ok && revoked.membership.status === 'revoked', 'revoke ok');
  assert(revoked.ok && revoked.membership.revoked_at, 'revoked_at seteado');
  assert(!(await getActiveMembership(teacher!.id, tenantA)), 'getActiveMembership null tras revoke');
  ok('revoked membership puede representarse');

  // Reactivar (createMembership) para no dejar inconsistencia vs usuarios.tenant_id en tests posteriores
  const reactivated = await createMembership(
    { userId: teacher!.id, tenantId: tenantA, role: 'docente' },
    { system: true },
  );
  assert(reactivated.ok && reactivated.membership.status === 'active', 'reactivar ok');

  // 9. getActiveMembership
  const active = await getActiveMembership(adminA!.id, tenantA);
  assert(active?.user_id === adminA!.id && active.tenant_id === tenantA, 'getActiveMembership');
  ok('getActiveMembership funciona');

  // 10. getUserMemberships
  const adminB = await createUser({
    nombre: 'Admin Mem B',
    email: `admin-mem-b-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantB,
    markEmailVerified: true,
  });
  assert(adminB, 'admin B');
  // Segunda membership activa en otro tenant (preparación multi-institución; auth aún usa usuarios.tenant_id)
  const second = await createMembership(
    { userId: adminA!.id, tenantId: tenantB, role: 'docente' },
    { system: true },
  );
  assert(second.ok, 'segunda membership cross-tenant (system)');
  const allActive = await getUserMemberships(adminA!.id);
  assert(allActive.length >= 2, 'getUserMemberships active >= 2');
  assert(allActive.every((m) => m.status === 'active'), 'solo active por defecto');
  const withRevoked = await getUserMemberships(teacher!.id, { includeRevoked: true });
  assert(withRevoked.some((m) => m.tenant_id === tenantA), 'includeRevoked incluye fila');
  ok('getUserMemberships funciona');

  // 11. Aislamiento entre tenants
  const listA = await listMembershipsForInstitutionAdmin(adminA!);
  assert(listA.ok, 'list A ok');
  assert(listA.memberships.every((m) => m.tenant_id === tenantA), 'list A solo tenant A');
  assert(!listA.memberships.some((m) => m.user_id === adminB!.id && m.tenant_id === tenantB), 'no lista B');

  const crossCreate = await createMembership(
    { userId: teacher!.id, tenantId: tenantB, role: 'docente' },
    { actor: adminA! },
  );
  assert(!crossCreate.ok && crossCreate.code === 'forbidden', 'admin A no crea en tenant B');

  const crossRevoke = await revokeMembership(adminB!.id, tenantB, { actor: adminA! });
  assert(!crossRevoke.ok && crossRevoke.code === 'forbidden', 'admin A no revoca en tenant B');

  const teacherList = await listMembershipsForInstitutionAdmin(teacher!);
  assert(!teacherList.ok && teacherList.code === 'forbidden', 'docente no lista memberships admin');
  ok('aislamiento entre tenants');

  // 12. Guests no generan memberships permanentes
  const guest = await createGuestUser();
  assert(guest.is_guest, 'guest flag');
  const guestMems = await getUserMemberships(guest.id, { includeRevoked: true });
  assert(guestMems.length === 0, 'guest sin memberships');
  const guestEnsure = await ensureActiveMembershipForUser(guest);
  assert(guestEnsure == null, 'ensure guest no-op');
  const guestCreate = await createMembership(
    { userId: guest.id, tenantId: guest.tenant_id, role: 'docente' },
    { system: true },
  );
  assert(!guestCreate.ok && guestCreate.code === 'validation', 'createMembership rechaza guest');
  ok('usuarios guest no generan memberships permanentes');

  // Auth source of truth intacta
  const reloaded = await getUserById(adminA!.id);
  assert(reloaded?.tenant_id === tenantA, 'usuarios.tenant_id intacto');

  // Migración idempotente
  await ensureDbReady();
  const stillOne = (await db.prepare(`
    SELECT COUNT(*) AS c FROM institution_memberships WHERE user_id = ? AND tenant_id = ?
  `).get(adminA!.id, tenantA)) as { c: number };
  assert(Number(stillOne.c) === 1, 're-migrate no duplica');

  console.log(`\nOK: Fase 3 Institution Memberships — ${checks} checks pasaron.`);
}

main().catch((error) => {
  console.error('FAIL:', error);
  process.exit(1);
});
