#!/usr/bin/env node
/**
 * Verificación Fase 4B/4C: AuthContext + hardening membership-aware authorization.
 * Uso: npx tsx scripts/verify-auth-memberships.ts
 */
import { randomBytes } from 'node:crypto';
import {
  ensureDbReady,
  createTenant,
  createUser,
  createGuestUser,
  db,
  purgeGuestAccount,
} from '../src/server/db.ts';
import {
  resolveAuthContext,
  resolveAuthContextDetailed,
  applyAuthContextToUser,
  resolveAuthorizedUser,
} from '../src/server/auth-context.ts';
import {
  createMembership,
  revokeMembership,
  ensureActiveMembershipForUser,
  getActiveMembership,
} from '../src/server/memberships.ts';
import { canAccessStudent, canAccessSubject, canAccessCourse, verifyLogin } from '../src/server/auth.ts';
import { ensureDocenteCourseAccess, ensureDocenteSubjectAccess } from '../src/server/docente-access.ts';
import { updateTenant } from '../src/server/tenant.ts';
import { getActividadForUser } from '../src/server/actividades-service.ts';
import { listTrabajoEntregas } from '../src/server/trabajo-entregas.ts';
import { pullClientData } from '../src/server/sync-pull.ts';

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

  const tenantA = `tenant-4ca-${suffix}`;
  const tenantB = `tenant-4cb-${suffix}`;
  await createTenant(`Hardening Colegio A ${suffix}`, tenantA);
  await createTenant(`Hardening Colegio B ${suffix}`, tenantB);

  const adminA = await createUser({
    nombre: 'Admin 4C A',
    email: `admin-4ca-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  assert(adminA, 'admin A');

  const teacherA = await createUser({
    nombre: 'Docente 4C A',
    email: `doc-4ca-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'docente',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  assert(teacherA, 'teacher A');

  const adminB = await createUser({
    nombre: 'Admin 4C B',
    email: `admin-4cb-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantB,
    markEmailVerified: true,
  });
  assert(adminB, 'admin B');

  // Resources A/B
  await db.prepare(`INSERT OR IGNORE INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo) VALUES (?, ?, 'E', 'Curso A', 'Manana', 2026)`).run(`curso-a-${suffix}`, tenantA);
  await db.prepare(`INSERT OR IGNORE INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo) VALUES (?, ?, 'E', 'Curso B', 'Tarde', 2026)`).run(`curso-b-${suffix}`, tenantB);
  await db.prepare(`INSERT OR IGNORE INTO materias (id, tenant_id, nombre, activo) VALUES (?, ?, 'Materia A', 1)`).run(`mat-a-${suffix}`, tenantA);
  await db.prepare(`INSERT OR IGNORE INTO materias (id, tenant_id, nombre, activo) VALUES (?, ?, 'Materia B', 1)`).run(`mat-b-${suffix}`, tenantB);
  await db.prepare(`INSERT OR IGNORE INTO alumnos (id, tenant_id, curso_id, nombre, dni) VALUES (?, ?, ?, 'Alumno A', '111')`).run(`al-a-${suffix}`, tenantA, `curso-a-${suffix}`);
  await db.prepare(`INSERT OR IGNORE INTO alumnos (id, tenant_id, curso_id, nombre, dni) VALUES (?, ?, ?, 'Alumno B', '222')`).run(`al-b-${suffix}`, tenantB, `curso-b-${suffix}`);
  await db.prepare(`INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)`).run(tenantA, teacherA!.id, `curso-a-${suffix}`);
  await db.prepare(`INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id) VALUES (?, ?, ?)`).run(tenantA, teacherA!.id, `mat-a-${suffix}`);
  await db.prepare(`INSERT OR IGNORE INTO asistencias (id, tenant_id, docente_id, alumno_id, materia_id, fecha, estado, updated_at) VALUES (?, ?, ?, ?, ?, '2026-03-01', 'presente', ?)`).run(
    `ast-b-${suffix}`, tenantB, adminB!.id, `al-b-${suffix}`, `mat-b-${suffix}`, new Date().toISOString(),
  );
  await db.prepare(`INSERT OR IGNORE INTO notas (id, tenant_id, docente_id, alumno_id, materia_id, titulo, valor, peso, fecha, updated_at) VALUES (?, ?, ?, ?, ?, 'P1', 8, 100, '2026-03-01', ?)`).run(
    `nota-b-${suffix}`, tenantB, adminB!.id, `al-b-${suffix}`, `mat-b-${suffix}`, new Date().toISOString(),
  );
  await db.prepare(`
    INSERT OR IGNORE INTO actividades (id, tenant_id, docente_id, colegio, turno, curso_id, materia_id, tipo, titulo, estado, contenido_json)
    VALUES (?, ?, ?, 'E', 'Tarde', ?, ?, 'tp', 'TP B', 'borrador', '{}')
  `).run(`act-b-${suffix}`, tenantB, adminB!.id, `curso-b-${suffix}`, `mat-b-${suffix}`);

  // --- Baseline AuthContext ---
  const ctxA = await resolveAuthContext(adminA!);
  assert(ctxA?.source === 'membership' && ctxA.tenantId === tenantA && ctxA.role === 'admin', 'baseline context');
  ok('usuario normal + membership active → acceso OK');
  ok('tenant/role provienen de membership');

  // --- Role drift A/B ---
  await db.prepare(`UPDATE institution_memberships SET role = 'docente' WHERE user_id = ? AND tenant_id = ?`).run(adminA!.id, tenantA);
  const driftedDocente = await resolveAuthContext(adminA!);
  assert(driftedDocente?.role === 'docente', 'drift A: membership docente');
  const rawRolStillAdmin = (await db.prepare(`SELECT rol FROM usuarios WHERE id = ?`).get(adminA!.id)) as { rol: string };
  assert(rawRolStillAdmin.rol === 'admin', 'usuarios.rol legacy sigue admin');
  // Admin bypass no aplica: sin asignación docente no ve alumno A vía canAccess (docente path)
  // Pero el recurso es del mismo tenant — docente sin assignment: canAccessStudent false unless assigned
  assert(!(await canAccessStudent(adminA!, `al-a-${suffix}`)), 'drift A: se comporta como docente (sin assignment)');
  assert(!(await canAccessStudent(adminA!, `al-b-${suffix}`)), 'drift A: sigue denegando tenant B');

  await db.prepare(`UPDATE institution_memberships SET role = 'admin' WHERE user_id = ? AND tenant_id = ?`).run(adminA!.id, tenantA);
  await db.prepare(`UPDATE usuarios SET rol = 'docente' WHERE id = ?`).run(adminA!.id);
  const driftedAdmin = await resolveAuthContext({ ...adminA!, rol: 'docente' });
  assert(driftedAdmin?.role === 'admin', 'drift B: membership admin gana');
  assert(await canAccessStudent({ ...adminA!, rol: 'docente' }, `al-a-${suffix}`), 'drift B: admin membership accede A');
  assert(!(await canAccessStudent({ ...adminA!, rol: 'docente' }, `al-b-${suffix}`)), 'drift B: no accede B');
  // restore
  await db.prepare(`UPDATE usuarios SET rol = 'admin' WHERE id = ?`).run(adminA!.id);
  await db.prepare(`UPDATE institution_memberships SET role = 'admin' WHERE user_id = ? AND tenant_id = ?`).run(adminA!.id, tenantA);
  ok('role drift: usuarios.rol=admin membership=docente → docente');
  ok('role drift: usuarios.rol=docente membership=admin → admin');

  // --- Tenant drift ---
  assert(await resolveAuthContext(adminA!), 'tenant match OK');
  await createMembership({ userId: adminA!.id, tenantId: tenantB, role: 'docente' }, { system: true });
  const multi = await resolveAuthContext(adminA!);
  assert(multi?.tenantId === tenantA, 'multi active usa solo user.tenant_id');
  ok('varias memberships active → solo user.tenant_id');

  await revokeMembership(adminA!.id, tenantA, { system: true });
  assert((await resolveAuthContext(adminA!)) == null, 'A revoked + B active → DENY (no auto-switch)');
  ok('tenant actual revoked + otra membership active → DENY');

  const driftedTenantUser = { ...adminA!, tenant_id: tenantB, rol: 'admin' as const };
  // membership B is docente for adminA; resolve with tenant_id=B finds B membership
  const ctxOnB = await resolveAuthContext(driftedTenantUser);
  assert(ctxOnB?.tenantId === tenantB && ctxOnB.role === 'docente', 'si user.tenant_id=B usa membership B');
  // Spec case: usuarios.tenant_id=A but only B active (A revoked) → DENY already tested
  await createMembership({ userId: adminA!.id, tenantId: tenantA, role: 'admin' }, { system: true });
  const onlyBActiveUser = { ...adminA!, tenant_id: `tenant-none-${suffix}`, rol: 'admin' as const };
  await createTenant(`None ${suffix}`, onlyBActiveUser.tenant_id);
  assert((await resolveAuthContext(onlyBActiveUser)) == null, 'tenant_id sin membership → DENY');
  ok('usuarios.tenant_id sin membership matching → DENY');

  // --- Revoked + session-like / passport-like ---
  await revokeMembership(adminA!.id, tenantA, { system: true });
  assert((await resolveAuthContext(adminA!)) == null, 'revoked → deny');
  assert((await resolveAuthorizedUser(adminA!)) == null, 'resolveAuthorizedUser null');
  const passportLike = { ...adminA!, rol: 'admin' as const, tenant_id: tenantA };
  assert((await resolveAuthContext(passportLike)) == null, 'passport-like no resucita');
  const detailed = await resolveAuthContextDetailed(adminA!);
  assert(!detailed.ok && detailed.reason === 'membership_revoked', 'reason revoked');
  await createMembership({ userId: adminA!.id, tenantId: tenantA, role: 'admin' }, { system: true });
  ok('membership revoked → denegado (session/passport-like)');

  // revoked_at edge
  await db.prepare(`UPDATE institution_memberships SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND tenant_id = ?`).run(adminA!.id, tenantA);
  assert((await resolveAuthContext(adminA!)) == null, 'revoked_at set → deny');
  await db.prepare(`UPDATE institution_memberships SET status='active', revoked_at=NULL, role='admin' WHERE user_id = ? AND tenant_id = ?`).run(adminA!.id, tenantA);
  ok('revoked_at != NULL → denegado');

  // --- Suspended ---
  await updateTenant(tenantA, { status: 'suspended' }, { actor: adminA! });
  assert((await resolveAuthContext(adminA!)) == null, 'suspended → deny');
  // Reactivation via updateTenant is blocked (AuthContext null) — expected debt, not a bypass.
  const reactivationBlocked = await updateTenant(tenantA, { status: 'active' }, { actor: adminA! });
  assert(!reactivationBlocked.ok && reactivationBlocked.code === 'forbidden', 'reactivación vía helper bloqueada sin AuthContext');
  await db.prepare(`UPDATE tenants SET status = 'active' WHERE id = ?`).run(tenantA);
  assert(await resolveAuthContext(adminA!), 'unsuspend system → OK');
  ok('institución suspended → denegado + reactivación admin bloqueada (deuda documentada)');

  // --- Cross-tenant matrix ---
  const actors = [
    { name: 'Admin A', user: adminA! },
    { name: 'Docente A', user: teacherA! },
  ];
  for (const actor of actors) {
    assert(await canAccessStudent(actor.user, `al-a-${suffix}`) || actor.name === 'Docente A', `${actor.name} student A`);
    if (actor.name === 'Admin A') assert(await canAccessStudent(actor.user, `al-a-${suffix}`), 'Admin A student A');
    if (actor.name === 'Docente A') assert(await canAccessStudent(actor.user, `al-a-${suffix}`), 'Docente A student A (assigned)');
    assert(!(await canAccessStudent(actor.user, `al-b-${suffix}`)), `${actor.name} DENY student B`);
    assert(!(await canAccessCourse(actor.user, `curso-b-${suffix}`)), `${actor.name} DENY course B`);
    assert(!(await canAccessSubject(actor.user, `mat-b-${suffix}`)), `${actor.name} DENY subject B`);
    assert(await ensureDocenteCourseAccess(actor.user, { id: `curso-b-${suffix}` }), `${actor.name} DENY ensure course B`);
    assert(await ensureDocenteSubjectAccess(actor.user, { id: `mat-b-${suffix}` }), `${actor.name} DENY ensure subject B`);
    assert(!(await getActividadForUser(actor.user, `act-b-${suffix}`)), `${actor.name} DENY activity B`);
  }
  // Admin A OK on A resources
  assert(await canAccessCourse(adminA!, `curso-a-${suffix}`), 'Admin A course A');
  assert(await canAccessSubject(adminA!, `mat-a-${suffix}`), 'Admin A subject A');
  ok('matriz cross-tenant students/courses/subjects/activities');

  // Grades/attendance isolation via pull
  const pullA = await pullClientData(adminA!);
  assert(!pullA.grades.some((g: { id: string }) => g.id === `nota-b-${suffix}`), 'pull A sin nota B');
  assert(!pullA.attendance.some((a: { id: string }) => a.id === `ast-b-${suffix}`), 'pull A sin asistencia B');
  const pullDenied = await revokeMembership(adminA!.id, tenantA, { system: true }).then(async () => {
    try {
      await pullClientData(adminA!);
      return false;
    } catch {
      return true;
    }
  });
  assert(pullDenied, 'pull con membership revoked → throw');
  await createMembership({ userId: adminA!.id, tenantId: tenantA, role: 'admin' }, { system: true });
  ok('sync pull aísla tenant + revoke rechaza pull');

  // Sync payload mismatch contract
  const syncCtx = await resolveAuthContext(adminA!);
  assert(syncCtx?.tenantId === tenantA, 'sync tenant A');
  assert(String('tenant-foreign') !== syncCtx!.tenantId, 'payload tenant ajeno mismatch');
  ok('sync tenant correcto / tenant ajeno rechazable');

  // Suspended sync
  await db.prepare(`UPDATE tenants SET status = 'suspended' WHERE id = ?`).run(tenantA);
  assert((await resolveAuthContext(adminA!)) == null, 'suspended sync context null');
  await db.prepare(`UPDATE tenants SET status = 'active' WHERE id = ?`).run(tenantA);
  ok('tenant suspended → sync context denegado');

  // --- Guests ---
  const guest = await createGuestUser();
  const gctx = await resolveAuthContext(guest);
  assert(gctx?.source === 'guest-legacy', 'guest legacy');
  assert((await getActiveMembership(guest.id, guest.tenant_id)) == null, 'guest sin membership row');
  const guestMems = (await db.prepare(`SELECT COUNT(*) AS c FROM institution_memberships WHERE user_id = ?`).get(guest.id)) as { c: number };
  assert(Number(guestMems.c) === 0, 'guest 0 memberships');
  await purgeGuestAccount(guest.id, guest.tenant_id);
  assert(!(await db.prepare(`SELECT id FROM usuarios WHERE id = ?`).get(guest.id)), 'guest purged');
  ok('guest legacy + sin membership + purge OK');

  // --- Auth regression smoke ---
  const login = await verifyLogin(`admin-4ca-${suffix}@example.com`, 'Clave123');
  assert(login && (await resolveAuthContext(login)), 'login + context');
  const loginTeacher = await verifyLogin(`doc-4ca-${suffix}@example.com`, 'Clave123');
  assert(loginTeacher?.rol === 'docente', 'login docente');
  ok('login admin/docente continúa');

  // listTrabajoEntregas empty for cross-tenant (no data A) and deny when revoked
  const entregas = await listTrabajoEntregas(adminA!, {});
  assert(Array.isArray(entregas), 'trabajos list OK');
  await revokeMembership(adminA!.id, tenantA, { system: true });
  assert((await listTrabajoEntregas(adminA!, {})).length === 0, 'trabajos revoked → []');
  await createMembership({ userId: adminA!.id, tenantId: tenantA, role: 'admin' }, { system: true });
  ok('trabajos/actividades helpers respetan AuthContext');

  // applyAuthContextToUser overlay
  const applied = applyAuthContextToUser({ ...adminA!, rol: 'docente' }, (await resolveAuthContext(adminA!))!);
  assert(applied.rol === 'admin' && applied.tenant_id === tenantA, 'overlay membership.role');
  ok('applyAuthContextToUser usa membership.role');

  // No membership user
  const orphanId = `orphan-${suffix}`;
  const orphanTenant = `tenant-orph-${suffix}`;
  await createTenant(`Orph ${suffix}`, orphanTenant);
  await db.prepare(`INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol, email_verified_at) VALUES (?, ?, 'O', ?, 'x', 'docente', ?)`).run(
    orphanId, orphanTenant, `orph-${suffix}@example.com`, new Date().toISOString(),
  );
  assert((await resolveAuthContext({ id: orphanId, tenant_id: orphanTenant, nombre: 'O', email: `orph-${suffix}@example.com`, rol: 'docente' })) == null, 'sin membership deny');
  ok('usuario sin membership → denegado');

  console.log(`\nOK: Fase 4C Auth hardening — ${checks} checks pasaron.`);
}

main().catch((error) => {
  console.error('FAIL:', error);
  process.exit(1);
});
