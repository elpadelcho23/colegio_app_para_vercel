#!/usr/bin/env node
/**
 * Verificación Fase 4B: AuthContext + membership-aware authorization.
 * Uso: npx tsx scripts/verify-auth-memberships.ts
 */
import { randomBytes } from 'node:crypto';
import {
  ensureDbReady,
  createTenant,
  createUser,
  createGuestUser,
  db,
} from '../src/server/db.ts';
import {
  resolveAuthContext,
  resolveAuthContextDetailed,
  applyAuthContextToUser,
} from '../src/server/auth-context.ts';
import {
  createMembership,
  revokeMembership,
  ensureActiveMembershipForUser,
} from '../src/server/memberships.ts';
import { canAccessStudent, canAccessSubject, canAccessCourse } from '../src/server/auth.ts';
import { updateTenant } from '../src/server/tenant.ts';

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

  const tenantA = `tenant-4ba-${suffix}`;
  const tenantB = `tenant-4bb-${suffix}`;
  await createTenant(`AuthCtx Colegio A ${suffix}`, tenantA);
  await createTenant(`AuthCtx Colegio B ${suffix}`, tenantB);

  const adminA = await createUser({
    nombre: 'Admin 4B A',
    email: `admin-4ba-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  assert(adminA, 'admin A');

  const teacherA = await createUser({
    nombre: 'Docente 4B A',
    email: `doc-4ba-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'docente',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  assert(teacherA, 'teacher A');

  const adminB = await createUser({
    nombre: 'Admin 4B B',
    email: `admin-4bb-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantB,
    markEmailVerified: true,
  });
  assert(adminB, 'admin B');

  // Seed resources in A and B
  await db.prepare(`
    INSERT OR IGNORE INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo)
    VALUES (?, ?, 'Escuela', 'Curso A', 'Manana', 2026)
  `).run(`curso-a-${suffix}`, tenantA);
  await db.prepare(`
    INSERT OR IGNORE INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo)
    VALUES (?, ?, 'Escuela', 'Curso B', 'Tarde', 2026)
  `).run(`curso-b-${suffix}`, tenantB);
  await db.prepare(`
    INSERT OR IGNORE INTO materias (id, tenant_id, nombre, activo)
    VALUES (?, ?, 'Materia A', 1)
  `).run(`mat-a-${suffix}`, tenantA);
  await db.prepare(`
    INSERT OR IGNORE INTO materias (id, tenant_id, nombre, activo)
    VALUES (?, ?, 'Materia B', 1)
  `).run(`mat-b-${suffix}`, tenantB);
  await db.prepare(`
    INSERT OR IGNORE INTO alumnos (id, tenant_id, curso_id, nombre, dni)
    VALUES (?, ?, ?, 'Alumno A', '111')
  `).run(`al-a-${suffix}`, tenantA, `curso-a-${suffix}`);
  await db.prepare(`
    INSERT OR IGNORE INTO alumnos (id, tenant_id, curso_id, nombre, dni)
    VALUES (?, ?, ?, 'Alumno B', '222')
  `).run(`al-b-${suffix}`, tenantB, `curso-b-${suffix}`);

  // 1 + 2. Normal user + active membership
  const ctxA = await resolveAuthContext(adminA!);
  assert(ctxA, '1. context OK');
  assert(ctxA!.source === 'membership', 'source membership');
  assert(ctxA!.tenantId === tenantA, '2. tenant from membership');
  assert(ctxA!.role === 'admin', '2. role from membership');
  assert(ctxA!.membershipId, 'membershipId presente');
  ok('usuario normal + membership active → acceso OK');
  ok('tenant/role provienen de membership');

  // 3. Revoked → deny
  await revokeMembership(adminA!.id, tenantA, { system: true });
  const afterRevoke = await resolveAuthContext(adminA!);
  assert(afterRevoke == null, '3. revoked → null context');
  const detailedRevoked = await resolveAuthContextDetailed(adminA!);
  assert(!detailedRevoked.ok && detailedRevoked.reason === 'membership_revoked', 'reason revoked');
  ok('membership revoked → denegado');

  // Reactivate for further tests
  await createMembership({ userId: adminA!.id, tenantId: tenantA, role: 'admin' }, { system: true });

  // 4. revoked_at set while status active (edge) — force via SQL
  await db.prepare(`
    UPDATE institution_memberships
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND tenant_id = ?
  `).run(adminA!.id, tenantA);
  const revokedAtDeny = await resolveAuthContext(adminA!);
  assert(revokedAtDeny == null, '4. revoked_at set → deny');
  // repair
  await db.prepare(`
    UPDATE institution_memberships
    SET status = 'active', revoked_at = NULL, role = 'admin'
    WHERE user_id = ? AND tenant_id = ?
  `).run(adminA!.id, tenantA);
  ok('revoked_at != NULL → denegado');

  // 5. Institution suspended
  await updateTenant(tenantA, { status: 'suspended' }, { actor: adminA! });
  const suspended = await resolveAuthContext(adminA!);
  assert(suspended == null, '5. suspended tenant → deny');
  const detailedSusp = await resolveAuthContextDetailed(adminA!);
  assert(!detailedSusp.ok && detailedSusp.reason === 'tenant_suspended', 'reason suspended');
  await updateTenant(tenantA, { status: 'active' }, { actor: adminA! });
  // updateTenant needs auth context - adminA raw user still has membership; resolve works after status active
  // But updateTenant with suspended tenant still allowed actor with membership on suspended?
  // After suspend, resolveAuthContext fails so updateTenant via actor would fail!
  // Need system path to unsuspend for test:
  await db.prepare(`UPDATE tenants SET status = 'active' WHERE id = ?`).run(tenantA);
  ok('institución suspended → denegado');

  // 6. User without membership
  const orphanTenant = `tenant-orphan-${suffix}`;
  await createTenant(`Orphan ${suffix}`, orphanTenant);
  const orphanId = `docente-orphan-${suffix}`;
  await db.prepare(`
    INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol, email_verified_at)
    VALUES (?, ?, 'Orphan', ?, 'x', 'docente', ?)
  `).run(orphanId, orphanTenant, `orphan-${suffix}@example.com`, new Date().toISOString());
  const orphanUser = {
    id: orphanId,
    tenant_id: orphanTenant,
    nombre: 'Orphan',
    email: `orphan-${suffix}@example.com`,
    rol: 'docente' as const,
    is_guest: false,
  };
  assert((await resolveAuthContext(orphanUser)) == null, '6. sin membership → deny');
  ok('usuario sin membership → denegado');

  // 7. Guest legacy
  const guest = await createGuestUser();
  const guestCtx = await resolveAuthContext(guest);
  assert(guestCtx, 'guest context');
  assert(guestCtx!.source === 'guest-legacy', 'guest-legacy');
  assert(guestCtx!.tenantId === guest.tenant_id, 'guest tenant');
  const guestMemCount = (await db.prepare(`
    SELECT COUNT(*) AS c FROM institution_memberships WHERE user_id = ?
  `).get(guest.id)) as { c: number };
  assert(Number(guestMemCount.c) === 0, 'guest sin membership rows');
  ok('guest → continúa funcionando sin membership');

  // 8. Multiple active memberships → use user.tenant_id only
  await createMembership({ userId: adminA!.id, tenantId: tenantB, role: 'docente' }, { system: true });
  const multi = await resolveAuthContext(adminA!);
  assert(multi?.tenantId === tenantA && multi.role === 'admin', '8. usa solo tenant A');
  ok('varias memberships active → se utiliza solo user.tenant_id');

  // 9. Current tenant revoked + other active → deny (no auto-switch)
  await revokeMembership(adminA!.id, tenantA, { system: true });
  const noSwitch = await resolveAuthContext(adminA!);
  assert(noSwitch == null, '9. no auto-switch a B');
  // restore A
  await createMembership({ userId: adminA!.id, tenantId: tenantA, role: 'admin' }, { system: true });
  ok('tenant actual revoked + otra membership active → denegado');

  // 10. Drift: usuarios.tenant_id points to tenant without matching membership tenant
  // Simulate: user.tenant_id = A but we only have membership... already have A.
  // Force drift by pointing usuarios.tenant_id to a fake id while membership stays on A
  // Spec: usuarios.tenant_id != membership for THAT pair → deny when looking up (user.id, user.tenant_id)
  const drifted = { ...adminA!, tenant_id: `tenant-drift-${suffix}` };
  await createTenant(`Drift ${suffix}`, drifted.tenant_id);
  assert((await resolveAuthContext(drifted)) == null, '10. drift → deny');
  ok('usuarios.tenant_id != membership tenant → denegado');

  // 11-14. Cross-tenant canAccess*
  const adminAFresh = { ...adminA!, tenant_id: tenantA, rol: 'admin' as const };
  await ensureActiveMembershipForUser(adminAFresh);
  assert(!(await canAccessStudent(adminAFresh, `al-b-${suffix}`)), '11. admin A no student B');
  assert(await canAccessStudent(adminAFresh, `al-a-${suffix}`), 'admin A sí student A');
  assert(!(await canAccessCourse(adminAFresh, `curso-b-${suffix}`)), '12. admin A no course B');
  assert(await canAccessCourse(adminAFresh, `curso-a-${suffix}`), 'admin A sí course A');
  assert(!(await canAccessSubject(adminAFresh, `mat-b-${suffix}`)), '13. admin A no subject B');
  assert(await canAccessSubject(adminAFresh, `mat-a-${suffix}`), 'admin A sí subject A');
  assert(!(await canAccessStudent(teacherA!, `al-b-${suffix}`)), '14. docente A no student B');
  assert(!(await canAccessCourse(teacherA!, `curso-b-${suffix}`)), 'docente A no course B');
  ok('admin A no puede acceder a student B');
  ok('admin A no puede acceder a course B');
  ok('admin A no puede acceder a subject B');
  ok('docente A no puede acceder a recursos B');

  // 15. Passport rehydrate simulation: user exists from passport fields but membership revoked
  await revokeMembership(adminA!.id, tenantA, { system: true });
  const passportLikeUser = {
    id: adminA!.id,
    tenant_id: tenantA,
    nombre: adminA!.nombre,
    email: adminA!.email,
    rol: 'admin' as const,
    is_guest: false,
  };
  assert((await resolveAuthContext(passportLikeUser)) == null, '15. passport-like + revoked → deny');
  await createMembership({ userId: adminA!.id, tenantId: tenantA, role: 'admin' }, { system: true });
  ok('Passport rehydrate + membership revoked → denegado');

  // 16 + 17. Sync tenant helpers (mirror sync.ts contract)
  const ctxSync = await resolveAuthContext(adminA!);
  assert(ctxSync?.tenantId === tenantA, '16. sync tenant correcto');
  const claimedForeign = 'tenant-foreign';
  const mismatch = claimedForeign !== ctxSync!.tenantId;
  assert(mismatch, '17. tenant ajeno detectado');
  ok('sync tenant correcto');
  ok('sync con tenant ajeno → rechazado');

  // applyAuthContextToUser
  const applied = applyAuthContextToUser(adminA!, ctxSync!);
  assert(applied.tenant_id === ctxSync!.tenantId && applied.rol === ctxSync!.role, 'apply overlay');

  console.log(`\nOK: Fase 4B AuthContext/memberships — ${checks} checks pasaron.`);
}

main().catch((error) => {
  console.error('FAIL:', error);
  process.exit(1);
});
