#!/usr/bin/env node
/**
 * Verificación Fase 5D Part 2: asignaciones académicas docentes (admin).
 * Uso: npx tsx scripts/verify-institution-assignments.ts
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
import { resolveAuthContext } from '../src/server/auth-context.ts';
import { getMembershipByUserAndTenant } from '../src/server/memberships.ts';
import { canAccessCourse, canAccessSubject } from '../src/server/auth.ts';
import {
  addOrInviteTeacher,
  revokeTeacher,
  listTeachersForInstitutionAdmin,
} from '../src/server/institution-teachers.ts';
import {
  createSchoolForInstitutionAdmin,
  createCourseForInstitutionAdmin,
  createSubjectForInstitutionAdmin,
} from '../src/server/institution-academic.ts';
import {
  assignTeacherResourceForInstitutionAdmin,
  unassignTeacherResourceForInstitutionAdmin,
  getTeacherAssignmentsForInstitutionAdmin,
  listAssignableTeachersForInstitutionAdmin,
  rejectForeignTenantId,
} from '../src/server/institution-assignments.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function countTenants() {
  const row = (await db.prepare('SELECT COUNT(*) AS c FROM tenants').get()) as { c: number };
  return Number(row?.c || 0);
}

async function main() {
  await ensureDbReady();
  const suffix = randomBytes(4).toString('hex');
  let checks = 0;
  const ok = (label: string) => {
    checks += 1;
    console.log(`  ✓ ${checks}. ${label}`);
  };

  const tenantA = `tenant-5d2a-${suffix}`;
  const tenantB = `tenant-5d2b-${suffix}`;
  await createTenant(`Assign A ${suffix}`, tenantA);
  await createTenant(`Assign B ${suffix}`, tenantB);

  const adminA = await createUser({
    nombre: 'Admin 5D2 A',
    email: `admin-5d2a-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  const adminB = await createUser({
    nombre: 'Admin 5D2 B',
    email: `admin-5d2b-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantB,
    markEmailVerified: true,
  });
  assert(adminA && adminB, 'admins');

  const teacherA = await addOrInviteTeacher(adminA!, {
    nombre: 'Docente A Assign',
    email: `doc-5d2a-${suffix}@example.com`,
    password: 'Clave123',
  });
  assert(teacherA.ok, 'teacher A');
  const teacherB = await addOrInviteTeacher(adminB!, {
    nombre: 'Docente B Assign',
    email: `doc-5d2b-${suffix}@example.com`,
    password: 'Clave123',
  });
  assert(teacherB.ok, 'teacher B');

  const schoolA = await createSchoolForInstitutionAdmin(adminA!, { nombre: `Escuela A ${suffix}` });
  const schoolB = await createSchoolForInstitutionAdmin(adminB!, { nombre: `Escuela B ${suffix}` });
  assert(schoolA.ok && schoolB.ok, 'schools');

  const courseA = await createCourseForInstitutionAdmin(adminA!, {
    escuela: schoolA.row.nombre,
    nombre: '3° A',
    turno: 'Mañana',
    ciclo_lectivo: 2026,
  });
  const courseB = await createCourseForInstitutionAdmin(adminB!, {
    escuela: schoolB.row.nombre,
    nombre: '3° B',
    turno: 'Tarde',
    ciclo_lectivo: 2026,
  });
  assert(courseA.ok && courseB.ok, 'courses');

  const subjectA = await createSubjectForInstitutionAdmin(adminA!, { nombre: `Matemática ${suffix}` });
  const subjectB = await createSubjectForInstitutionAdmin(adminB!, { nombre: `Física ${suffix}` });
  assert(subjectA.ok && subjectB.ok, 'subjects');

  const teacherUserA = await getUserById(teacherA.teacher.userId);
  assert(teacherUserA, 'teacher user A');

  // 1. List assignments (empty initially)
  const listedEmpty = await getTeacherAssignmentsForInstitutionAdmin(adminA!, teacherA.teacher.userId);
  assert(listedEmpty.ok, 'list ok');
  assert(listedEmpty.view.schoolIds.length === 0, 'no schools yet');
  assert(listedEmpty.view.courseIds.length === 0, 'no courses yet');
  assert(listedEmpty.view.subjectIds.length === 0, 'no subjects yet');
  assert(listedEmpty.view.schools.some((s) => s.id === schoolA.row.id), 'catalog school A visible');
  assert(!listedEmpty.view.schools.some((s) => s.id === schoolB.row.id), 'school B hidden');
  ok('Admin puede listar asignaciones de docente de su institución');

  // 2–3. School assign / unassign
  const asSchool = await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'school',
    resourceId: schoolA.row.id,
  });
  assert(asSchool.ok && asSchool.created, 'assign school');
  const schoolLink = await db.prepare(`
    SELECT 1 AS ok FROM docente_escuelas
    WHERE tenant_id = ? AND docente_id = ? AND escuela_id = ?
  `).get(tenantA, teacherA.teacher.userId, schoolA.row.id);
  assert(schoolLink, 'school link in DB');
  ok('Admin puede asignar docente → escuela');

  const usSchool = await unassignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'school',
    resourceId: schoolA.row.id,
  });
  assert(usSchool.ok && usSchool.removed, 'unassign school');
  const schoolGone = await db.prepare(`
    SELECT 1 AS ok FROM docente_escuelas
    WHERE tenant_id = ? AND docente_id = ? AND escuela_id = ?
  `).get(tenantA, teacherA.teacher.userId, schoolA.row.id);
  assert(!schoolGone, 'school link removed');
  ok('Admin puede quitar docente → escuela');

  // 4–5. Course
  const asCourse = await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'course',
    resourceId: courseA.row.id,
  });
  assert(asCourse.ok, 'assign course');
  ok('Admin puede asignar docente → curso');

  const usCourse = await unassignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'course',
    resourceId: courseA.row.id,
  });
  assert(usCourse.ok, 'unassign course');
  // re-assign for canAccess checks later
  await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'course',
    resourceId: courseA.row.id,
  });
  ok('Admin puede quitar docente → curso');

  // 6–7. Subject
  const asSubject = await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'subject',
    resourceId: subjectA.row.id,
  });
  assert(asSubject.ok, 'assign subject');
  ok('Admin puede asignar docente → materia');

  const usSubject = await unassignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'subject',
    resourceId: subjectA.row.id,
  });
  assert(usSubject.ok, 'unassign subject');
  await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'subject',
    resourceId: subjectA.row.id,
  });
  ok('Admin puede quitar docente → materia');

  // 8. No duplicates
  const dup = await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'course',
    resourceId: courseA.row.id,
  });
  assert(!dup.ok && dup.code === 'conflict', 'duplicate rejected');
  ok('No se crean duplicados');

  // 9. Teacher from other institution
  const foreignTeacher = await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherB.teacher.userId,
    type: 'course',
    resourceId: courseA.row.id,
  });
  assert(!foreignTeacher.ok && foreignTeacher.code === 'not_found', 'foreign teacher rejected');
  ok('Docente de otra institución: rechazo');

  // 10. Resource from other institution
  const foreignResource = await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'course',
    resourceId: courseB.row.id,
  });
  assert(!foreignResource.ok && foreignResource.code === 'not_found', 'foreign resource rejected');
  ok('Recurso de otra institución: rechazo');

  // 11. Teacher A + resource B
  const mix = await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'school',
    resourceId: schoolB.row.id,
  });
  assert(!mix.ok && mix.code === 'not_found', 'cross combo rejected');
  ok('Combinación docente A + recurso B: rechazo');

  // 12. Client tenant_id manipulation helper + B admin cannot touch A
  assert(rejectForeignTenantId(tenantA, { tenant_id: tenantB }) === 'forbidden', 'rejectForeignTenantId');
  const crossAdmin = await assignTeacherResourceForInstitutionAdmin(adminB!, {
    teacherId: teacherA.teacher.userId,
    type: 'course',
    resourceId: courseA.row.id,
  });
  assert(!crossAdmin.ok, 'admin B cannot assign teacher A');
  ok('Admin intentando manipular otro tenant: rechazo');

  // 13. Revoked teacher cannot receive new assignments
  const revoked = await revokeTeacher(adminA!, { userId: teacherA.teacher.userId });
  assert(revoked.ok, 'revoke');
  const assignRevoked = await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'school',
    resourceId: schoolA.row.id,
  });
  assert(!assignRevoked.ok && assignRevoked.code === 'revoked', 'revoked blocked');
  // Existing course link must remain (no auto-cleanup)
  const stillLinked = await db.prepare(`
    SELECT 1 AS ok FROM docente_cursos
    WHERE tenant_id = ? AND docente_id = ? AND curso_id = ?
  `).get(tenantA, teacherA.teacher.userId, courseA.row.id);
  assert(stillLinked, 'revoke keeps existing docente_cursos');
  ok('Docente revocado: no puede recibir nuevas asignaciones');

  // Reactivate for remaining checks that need active teacher
  const { reactivateTeacher } = await import('../src/server/institution-teachers.ts');
  const reactivated = await reactivateTeacher(adminA!, { userId: teacherA.teacher.userId });
  assert(reactivated.ok, 'reactivate');

  // 14. Guest not assignable
  const guest = await createGuestUser();
  const assignable = await listAssignableTeachersForInstitutionAdmin(adminA!);
  assert(assignable.ok, 'assignable list');
  assert(!assignable.teachers.some((t) => t.userId === guest.id), 'guest not listed');
  const allTeachers = await listTeachersForInstitutionAdmin(adminA!);
  assert(allTeachers.ok && !allTeachers.teachers.some((t) => t.userId === guest.id), 'guest not in teachers');
  const guestAssign = await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: guest.id,
    type: 'course',
    resourceId: courseA.row.id,
  });
  assert(!guestAssign.ok, 'guest assign rejected');
  ok('Guest: no aparece como docente administrable');

  // 15. Without valid AuthContext
  const noAuth = await getTeacherAssignmentsForInstitutionAdmin(null as unknown as typeof adminA!, teacherA.teacher.userId);
  assert(!noAuth.ok && noAuth.code === 'forbidden', 'null actor forbidden');
  ok('Sin AuthContext válido: rechazo');

  // 16. Docente cannot use admin assignment APIs
  const asDocente = await assignTeacherResourceForInstitutionAdmin(teacherUserA!, {
    teacherId: teacherA.teacher.userId,
    type: 'school',
    resourceId: schoolA.row.id,
  });
  assert(!asDocente.ok && asDocente.code === 'forbidden', 'docente forbidden');
  ok('Un docente no puede utilizar estos endpoints administrativos');

  // 17. Assignments feed canAccess*
  assert(await canAccessCourse(teacherUserA!, courseA.row.id), 'canAccessCourse true');
  assert(!(await canAccessCourse(teacherUserA!, courseB.row.id)), 'canAccessCourse false for B');
  assert(await canAccessSubject(teacherUserA!, subjectA.row.id), 'canAccessSubject true');
  assert(!(await canAccessSubject(teacherUserA!, subjectB.row.id)), 'canAccessSubject false for B');
  ok('Las asignaciones existentes continúan siendo utilizadas por canAccess*');

  // 18–20. Assign does not mutate tenant / membership / create tenant
  const tenantsBefore = await countTenants();
  const userBefore = await getUserById(teacherA.teacher.userId);
  const memBefore = await getMembershipByUserAndTenant(teacherA.teacher.userId, tenantA);
  assert(userBefore && memBefore, 'baseline user/mem');
  await assignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'school',
    resourceId: schoolA.row.id,
  });
  const userAfter = await getUserById(teacherA.teacher.userId);
  const memAfter = await getMembershipByUserAndTenant(teacherA.teacher.userId, tenantA);
  const tenantsAfter = await countTenants();
  assert(userAfter!.tenant_id === userBefore!.tenant_id, 'tenant_id unchanged');
  assert(memAfter!.id === memBefore!.id && memAfter!.status === memBefore!.status, 'membership unchanged');
  assert(tenantsAfter === tenantsBefore, 'no new tenant');
  ok('Crear asignación no modifica tenant del usuario');
  ok('Crear asignación no modifica membership');
  ok('Crear asignación no crea tenant');

  // 21–22. Unassign does not delete user or academic resource
  await unassignTeacherResourceForInstitutionAdmin(adminA!, {
    teacherId: teacherA.teacher.userId,
    type: 'school',
    resourceId: schoolA.row.id,
  });
  const userStill = await getUserById(teacherA.teacher.userId);
  const schoolStill = await db.prepare('SELECT id FROM escuelas WHERE id = ?').get(schoolA.row.id);
  const courseStill = await db.prepare('SELECT id FROM cursos WHERE id = ?').get(courseA.row.id);
  const subjectStill = await db.prepare('SELECT id FROM materias WHERE id = ?').get(subjectA.row.id);
  assert(userStill, 'user remains');
  assert(schoolStill && courseStill && subjectStill, 'resources remain');
  ok('Eliminar asignación no elimina usuario');
  ok('Eliminar asignación no elimina recurso académico');

  // AuthContext still resolves for admin
  const ctx = await resolveAuthContext(adminA!);
  assert(ctx && ctx.role === 'admin' && ctx.tenantId === tenantA, 'admin context intact');

  console.log(`\nverify:institution-assignments OK (${checks} checks)`);
}

main().catch((err) => {
  console.error('verify:institution-assignments FAILED');
  console.error(err);
  process.exit(1);
});
