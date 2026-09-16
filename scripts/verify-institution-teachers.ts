#!/usr/bin/env node
/**
 * Verificación Fase 5A: gestión institucional de docentes.
 * Uso: npx tsx scripts/verify-institution-teachers.ts
 */
import { randomBytes } from 'node:crypto';
import {
  ensureDbReady,
  createTenant,
  createUser,
  createGuestUser,
  db,
  purgeGuestAccount,
  getUserById,
} from '../src/server/db.ts';
import { resolveAuthContext, resolveAuthContextDetailed } from '../src/server/auth-context.ts';
import {
  getMembershipByUserAndTenant,
  getActiveMembership,
  createMembership,
} from '../src/server/memberships.ts';
import {
  listTeachersForInstitutionAdmin,
  addOrInviteTeacher,
  revokeTeacher,
  reactivateTeacher,
  countTenants,
} from '../src/server/institution-teachers.ts';
import { verifyLogin } from '../src/server/auth.ts';
import {
  issueEmailVerification,
  issuePasswordReset,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
} from '../src/server/auth-email.ts';

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

  const tenantA = `tenant-5aa-${suffix}`;
  const tenantB = `tenant-5ab-${suffix}`;
  await createTenant(`Teachers Colegio A ${suffix}`, tenantA);
  await createTenant(`Teachers Colegio B ${suffix}`, tenantB);

  const adminA = await createUser({
    nombre: 'Admin 5A A',
    email: `admin-5aa-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  assert(adminA, 'admin A');

  const adminB = await createUser({
    nombre: 'Admin 5A B',
    email: `admin-5ab-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantB,
    markEmailVerified: true,
  });
  assert(adminB, 'admin B');

  const teacherB = await createUser({
    nombre: 'Docente B seed',
    email: `doc-seed-b-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'docente',
    tenant_id: tenantB,
    markEmailVerified: true,
  });
  assert(teacherB, 'teacher B seed');

  // Baseline: A vacío de docentes (admins no aparecen en listado docente)
  const emptyList = await listTeachersForInstitutionAdmin(adminA!);
  assert(emptyList.ok, 'list A ok');
  assert(emptyList.teachers.every((t) => t.userId !== adminA!.id), 'admin no listado como docente');
  ok('Admin A lista únicamente docentes de A (lista vacía inicial)');

  const tenantsBefore = await countTenants();

  // Crear docente en A
  const created = await addOrInviteTeacher(adminA!, {
    nombre: 'Docente Nuevo A',
    email: `doc-new-a-${suffix}@example.com`,
    password: 'Clave123',
  });
  assert(created.ok, `create teacher: ${!created.ok ? created.error : ''}`);
  assert(created.ok && created.createdUser, 'usuario nuevo creado');
  assert(created.ok && created.membership.role === 'docente', 'membership.role = docente');
  assert(created.ok && created.membership.tenant_id === tenantA, 'membership.tenant_id = A');
  assert(created.ok && created.membership.status === 'active', 'membership active');

  const tenantsAfter = await countTenants();
  assert(tenantsAfter === tenantsBefore, 'crear docente NO crea tenant nuevo');
  ok('Crear docente desde A no crea tenant nuevo');
  ok('Crear docente genera membership correcta (role=docente, tenant=A)');

  const listA = await listTeachersForInstitutionAdmin(adminA!);
  assert(listA.ok && listA.teachers.some((t) => t.userId === created.teacher.userId), 'docente A en lista A');
  assert(listA.ok && listA.teachers.every((t) => t.email.includes('@')), 'emails presentes');
  ok('Admin A lista docentes de A con id/nombre/email/estado');

  // Admin A no ve docentes de B
  const listAIds = new Set(listA.teachers.map((t) => t.userId));
  assert(!listAIds.has(teacherB!.id), 'lista A no incluye docente B');
  const listB = await listTeachersForInstitutionAdmin(adminB!);
  assert(listB.ok && listB.teachers.some((t) => t.userId === teacherB!.id), 'B ve su docente');
  assert(listB.ok && !listB.teachers.some((t) => t.userId === created.teacher.userId), 'B no ve docente A');
  ok('Admin A no puede listar docentes de B (aislamiento)');

  // Admin A no puede crear membership en B vía actor (createMembership actor check)
  const crossCreate = await createMembership(
    { userId: created.teacher.userId, tenantId: tenantB, role: 'docente' },
    { actor: adminA! },
  );
  assert(!crossCreate.ok && crossCreate.code === 'forbidden', 'A no crea membership en B');
  ok('Admin A no puede crear membership en B');

  // Email duplicado activo
  const dup = await addOrInviteTeacher(adminA!, {
    nombre: 'Otro',
    email: `doc-new-a-${suffix}@example.com`,
    password: 'Clave123',
  });
  assert(!dup.ok && dup.code === 'conflict', 'duplicado activo → conflict');
  ok('Email duplicado se maneja correctamente (conflict)');

  // Revocar
  const userBeforeRevoke = await getUserById(created.teacher.userId);
  assert(userBeforeRevoke, 'usuario existe antes de revocar');
  const revoked = await revokeTeacher(adminA!, { userId: created.teacher.userId });
  assert(revoked.ok && revoked.teacher.status === 'revoked', 'status revoked');
  assert(revoked.ok && revoked.membership.revoked_at, 'revoked_at set');
  const memRevoked = await getMembershipByUserAndTenant(created.teacher.userId, tenantA);
  assert(memRevoked?.status === 'revoked', 'membership revoked en DB');
  ok('Revocar cambia membership a revoked');

  const ctxDenied = await resolveAuthContextDetailed(userBeforeRevoke!);
  assert(!ctxDenied.ok && ctxDenied.reason === 'membership_revoked', 'AuthContext denegado tras revoke');
  const ctxNull = await resolveAuthContext(userBeforeRevoke!);
  assert(ctxNull === null, 'resolveAuthContext null tras revoke');
  ok('Revocado no obtiene AuthContext válido');

  // Usuario no eliminado; B intacto
  const userAfterRevoke = await getUserById(created.teacher.userId);
  assert(userAfterRevoke, 'usuario sigue existiendo');
  const teacherBAfter = await getUserById(teacherB!.id);
  const memB = await getActiveMembership(teacherB!.id, tenantB);
  assert(teacherBAfter && memB?.status === 'active', 'usuario B no alterado');
  const memCountForRevoked = (await db.prepare(`
    SELECT COUNT(*) AS c FROM institution_memberships WHERE user_id = ? AND tenant_id = ?
  `).get(created.teacher.userId, tenantA)) as { c: number };
  assert(Number(memCountForRevoked.c) === 1, 'sigue siendo una sola membership (no duplicada)');
  ok('Usuario no se elimina al revocar');
  ok('Usuario de otra institución no es alterado');

  // Reactivar (misma fila)
  const reactivated = await reactivateTeacher(adminA!, { membershipId: memRevoked!.id });
  assert(reactivated.ok && reactivated.teacher.status === 'active', 'reactivado active');
  assert(reactivated.ok && !reactivated.membership.revoked_at, 'revoked_at limpio');
  const memActive = await getMembershipByUserAndTenant(created.teacher.userId, tenantA);
  assert(memActive?.id === memRevoked!.id, 'misma membership id');
  assert(memActive?.status === 'active', 'status active');
  ok('Reactivar devuelve membership a active (misma fila)');

  const userReload = await getUserById(created.teacher.userId);
  const ctxOk = await resolveAuthContext(userReload!);
  assert(ctxOk?.tenantId === tenantA && ctxOk.role === 'docente', 'AuthContext OK tras reactivar');
  ok('Reactivado puede obtener AuthContext nuevamente');

  // needs_reactivation path: revoke again, then addOrInvite debe pedir reactivar
  await revokeTeacher(adminA!, { userId: created.teacher.userId });
  const needs = await addOrInviteTeacher(adminA!, {
    nombre: 'Docente Nuevo A',
    email: `doc-new-a-${suffix}@example.com`,
    password: 'Clave123',
  });
  assert(!needs.ok && needs.code === 'needs_reactivation', 'invite de revoked → needs_reactivation');
  await reactivateTeacher(adminA!, { userId: created.teacher.userId });
  ok('Invite sobre revoked exige reactivación explícita');

  // Invite sin password usa reset infra (no rompe)
  const invited = await addOrInviteTeacher(adminA!, {
    nombre: 'Docente Invite',
    email: `doc-invite-a-${suffix}@example.com`,
  });
  assert(invited.ok && invited.createdUser && invited.invitedByEmail, 'invite sin password');
  const tenantsAfterInvite = await countTenants();
  assert(tenantsAfterInvite === tenantsBefore, 'invite tampoco crea tenant');
  ok('Invite sin password reutiliza reset email y no crea tenant');

  // Guests legacy
  const guest = await createGuestUser();
  const guestCtx = await resolveAuthContext(guest);
  assert(guestCtx?.source === 'guest-legacy', 'guest legacy');
  const guestMems = (await db.prepare(`
    SELECT COUNT(*) AS c FROM institution_memberships WHERE user_id = ?
  `).get(guest.id)) as { c: number };
  assert(Number(guestMems.c) === 0, 'guest sin memberships');
  await purgeGuestAccount(guest.id);
  ok('Guests continúan funcionando (legacy, sin memberships)');

  // Login / verificación / reset siguen funcionando
  const loginOk = await verifyLogin(`doc-new-a-${suffix}@example.com`, 'Clave123');
  assert(loginOk, 'login docente reactivado');

  const unverified = await createUser({
    nombre: 'Verif 5A',
    email: `verif-5a-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'docente',
    tenant_id: tenantA,
    markEmailVerified: false,
  });
  assert(unverified, 'user unverified');
  const issued = await issueEmailVerification(unverified!);
  assert(issued.ok, 'issue verification');
  if (issued.link) {
    const token = new URL(issued.link).searchParams.get('token');
    assert(token, 'token verify');
    const consumed = await consumeEmailVerificationToken(token!);
    assert(consumed.ok, 'consume verify');
  }

  const resetIssued = await issuePasswordReset(`doc-new-a-${suffix}@example.com`);
  assert(resetIssued.ok, 'issue reset');
  if (resetIssued.debugLink) {
    const token = new URL(resetIssued.debugLink).searchParams.get('token');
    assert(token, 'reset token');
    const reset = await consumePasswordResetToken(token!, 'NuevaClave1');
    assert(reset.ok, 'consume reset');
    const loginNew = await verifyLogin(`doc-new-a-${suffix}@example.com`, 'NuevaClave1');
    assert(loginNew, 'login con password reset');
  }
  ok('Login/verificación/reset existentes continúan funcionando');

  // Docente no-admin no lista
  const teacherUser = await getUserById(created.teacher.userId);
  const asTeacher = await listTeachersForInstitutionAdmin(teacherUser!);
  assert(!asTeacher.ok && asTeacher.code === 'forbidden', 'docente no puede listar admin teachers');
  ok('Autorización admin-only en helpers');

  console.log(`\nverify:institution-teachers OK (${checks} checks)`);
}

main().catch((error) => {
  console.error('\nverify:institution-teachers FAILED');
  console.error(error);
  process.exit(1);
});
