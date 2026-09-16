#!/usr/bin/env node
/**
 * Verificación Fase 5C Part 2: admin structure (escuelas/cursos/materias).
 * Uso: npx tsx scripts/verify-institution-academic.ts
 */
import { randomBytes } from 'node:crypto';
import {
  ensureDbReady,
  createTenant,
  createUser,
  db,
  getUserById,
} from '../src/server/db.ts';
import { resolveAuthContext } from '../src/server/auth-context.ts';
import { revokeMembership, createMembership } from '../src/server/memberships.ts';
import { updateTenant } from '../src/server/tenant.ts';
import {
  listSchoolsForInstitutionAdmin,
  createSchoolForInstitutionAdmin,
  updateSchoolForInstitutionAdmin,
  deactivateSchoolForInstitutionAdmin,
  listCoursesForInstitutionAdmin,
  createCourseForInstitutionAdmin,
  updateCourseForInstitutionAdmin,
  deleteCourseForInstitutionAdmin,
  listSubjectsForInstitutionAdmin,
  createSubjectForInstitutionAdmin,
  updateSubjectForInstitutionAdmin,
  deactivateSubjectForInstitutionAdmin,
  rejectForeignTenantId,
} from '../src/server/institution-academic.ts';

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

  const tenantA = `tenant-5c2a-${suffix}`;
  const tenantB = `tenant-5c2b-${suffix}`;
  await createTenant(`Academic A ${suffix}`, tenantA);
  await createTenant(`Academic B ${suffix}`, tenantB);

  const adminA = await createUser({
    nombre: 'Admin 5C2 A',
    email: `admin-5c2a-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantA,
    markEmailVerified: true,
  });
  const adminB = await createUser({
    nombre: 'Admin 5C2 B',
    email: `admin-5c2b-${suffix}@example.com`,
    password: 'Clave123',
    rol: 'admin',
    tenant_id: tenantB,
    markEmailVerified: true,
  });
  assert(adminA && adminB, 'admins');

  // Seed school B
  const schoolB = await createSchoolForInstitutionAdmin(adminB!, { nombre: `Escuela B ${suffix}` });
  assert(schoolB.ok, 'school B');
  const courseB = await createCourseForInstitutionAdmin(adminB!, {
    escuela: schoolB.row.nombre,
    nombre: '1ro B',
    turno: 'Tarde',
    ciclo_lectivo: 2026,
  });
  assert(courseB.ok, 'course B');
  const subjectB = await createSubjectForInstitutionAdmin(adminB!, { nombre: `Materia B ${suffix}` });
  assert(subjectB.ok, 'subject B');

  // --- Escuelas ---
  const empty = await listSchoolsForInstitutionAdmin(adminA!);
  assert(empty.ok && !empty.schools.some((s) => s.id === schoolB.row.id), 'A no ve escuela B');
  ok('Admin A lista solo escuelas A / no ve B');

  const schoolA = await createSchoolForInstitutionAdmin(adminA!, { nombre: `Escuela A ${suffix}` });
  assert(schoolA.ok && schoolA.row.tenant_id === tenantA && schoolA.row.activo, 'create school A');
  ok('Admin A crea escuela A');

  const renamed = await updateSchoolForInstitutionAdmin(adminA!, schoolA.row.id, {
    nombre: `Escuela A Renombrada ${suffix}`,
  });
  assert(renamed.ok && renamed.row.nombre.includes('Renombrada'), 'update school A');
  ok('Admin A modifica escuela A');

  const crossSchool = await updateSchoolForInstitutionAdmin(adminA!, schoolB.row.id, { nombre: 'Hack' });
  assert(!crossSchool.ok && crossSchool.code === 'not_found', 'no modifica escuela B');
  ok('Admin A no modifica escuela B');

  const deactivated = await deactivateSchoolForInstitutionAdmin(adminA!, schoolA.row.id);
  assert(deactivated.ok && !deactivated.row.activo, 'soft deactivate');
  const schoolRow = (await db.prepare('SELECT activo FROM escuelas WHERE id = ?').get(schoolA.row.id)) as { activo: number };
  assert(Number(schoolRow.activo) === 0, 'activo=0 en DB');
  ok('Soft-delete escuela funciona (activo=0)');

  // Reactivar para cursos
  await updateSchoolForInstitutionAdmin(adminA!, schoolA.row.id, {
    nombre: `Escuela A Renombrada ${suffix}`,
    activo: true,
  });

  // --- Cursos ---
  const listCoursesEmpty = await listCoursesForInstitutionAdmin(adminA!);
  assert(listCoursesEmpty.ok && !listCoursesEmpty.courses.some((c) => c.id === courseB.row.id), 'A no ve curso B');
  ok('Admin A lista solo cursos A');

  const courseA = await createCourseForInstitutionAdmin(adminA!, {
    escuela: `Escuela A Renombrada ${suffix}`,
    nombre: '4to 1ra',
    turno: 'Mañana',
    ciclo_lectivo: 2026,
  });
  assert(courseA.ok && courseA.row.tenant_id === tenantA, 'create course A');
  assert(typeof courseA.row.escuela === 'string' && courseA.row.escuela.includes('Renombrada'), 'escuela TEXT');
  ok('Admin A crea curso A');
  ok('curso conserva compatibilidad con escuela TEXT');

  // Confirm no escuela_id column introduced
  const courseCols = ((await db.prepare('PRAGMA table_info(cursos)').all()) as Array<{ name: string }>).map((c) => c.name);
  assert(!courseCols.includes('escuela_id'), 'no FK escuela_id nueva');
  assert(courseCols.includes('escuela'), 'columna escuela TEXT sigue');
  ok('No se crea FK nueva escuela_id');

  const updatedCourse = await updateCourseForInstitutionAdmin(adminA!, courseA.row.id, { turno: 'Tarde' });
  assert(updatedCourse.ok && updatedCourse.row.turno === 'Tarde', 'update course A');
  ok('Admin A modifica curso A');

  const crossCourse = await updateCourseForInstitutionAdmin(adminA!, courseB.row.id, { nombre: 'Hack' });
  assert(!crossCourse.ok && crossCourse.code === 'not_found', 'no modifica curso B');
  ok('Admin A no modifica curso B');

  // --- Materias ---
  const listSub = await listSubjectsForInstitutionAdmin(adminA!);
  assert(listSub.ok && !listSub.subjects.some((s) => s.id === subjectB.row.id), 'A no ve materia B');
  ok('Admin A lista solo materias A');

  const subjectA = await createSubjectForInstitutionAdmin(adminA!, { nombre: `Matemática ${suffix}` });
  assert(subjectA.ok && subjectA.row.tenant_id === tenantA, 'create subject A');
  ok('Admin A crea materia A');

  const updSub = await updateSubjectForInstitutionAdmin(adminA!, subjectA.row.id, { nombre: `Matemática II ${suffix}` });
  assert(updSub.ok && updSub.row.nombre.includes('II'), 'update subject A');
  ok('Admin A modifica materia A');

  const crossSub = await updateSubjectForInstitutionAdmin(adminA!, subjectB.row.id, { nombre: 'Hack' });
  assert(!crossSub.ok && crossSub.code === 'not_found', 'no modifica materia B');
  ok('Admin A no modifica materia B');

  await deactivateSubjectForInstitutionAdmin(adminA!, subjectA.row.id);
  const subRow = (await db.prepare('SELECT activo FROM materias WHERE id = ?').get(subjectA.row.id)) as { activo: number };
  assert(Number(subRow.activo) === 0, 'materia soft-delete');

  // --- Seguridad tenant_id cliente ---
  assert(rejectForeignTenantId(tenantA, { tenant_id: tenantB }) === 'forbidden', 'reject foreign tenant');
  assert(rejectForeignTenantId(tenantA, { tenant_id: tenantA }) === null, 'same tenant ok');
  ok('tenant_id enviado por cliente no cambia contexto (reject helper)');

  // IDs otro tenant → not_found (scoped query)
  const getForeign = await updateCourseForInstitutionAdmin(adminA!, courseB.row.id, { turno: 'X' });
  assert(!getForeign.ok && (getForeign.code === 'not_found' || getForeign.code === 'forbidden'), 'ID ajeno 404/403');
  ok('IDs de otro tenant devuelven not_found/forbidden');

  // Membership revoked
  await revokeMembership(adminA!.id, tenantA, { system: true });
  const revokedList = await listSchoolsForInstitutionAdmin(adminA!);
  assert(!revokedList.ok && revokedList.code === 'forbidden', 'revoked no administra');
  ok('membership revoked no puede administrar');

  await createMembership({ userId: adminA!.id, tenantId: tenantA, role: 'admin' }, { system: true });

  // Tenant suspended
  await db.prepare(`UPDATE tenants SET status='suspended' WHERE id = ?`).run(tenantA);
  const suspendedList = await listCoursesForInstitutionAdmin(adminA!);
  assert(!suspendedList.ok && suspendedList.code === 'forbidden', 'suspended no administra');
  ok('tenant suspended no puede administrar');
  await db.prepare(`UPDATE tenants SET status='active' WHERE id = ?`).run(tenantA);

  // Delete course without students
  const del = await deleteCourseForInstitutionAdmin(adminA!, courseA.row.id);
  assert(del.ok, 'delete empty course');
  const gone = (await db.prepare('SELECT id FROM cursos WHERE id = ?').get(courseA.row.id)) as { id: string } | undefined;
  assert(!gone, 'course deleted');

  // Course with student cannot delete
  const courseWithStudent = await createCourseForInstitutionAdmin(adminA!, {
    escuela: `Escuela A Renombrada ${suffix}`,
    nombre: 'Con alumnos',
    turno: 'Mañana',
  });
  assert(courseWithStudent.ok, 'course with student setup');
  await db.prepare(`
    INSERT INTO alumnos (id, tenant_id, curso_id, nombre, dni)
    VALUES (?, ?, ?, 'Alumno', ?)
  `).run(`al-5c2-${suffix}`, tenantA, courseWithStudent.row.id, `dni-${suffix}`);
  const blocked = await deleteCourseForInstitutionAdmin(adminA!, courseWithStudent.row.id);
  assert(!blocked.ok && blocked.code === 'has_dependencies', 'delete blocked with alumnos');
  ok('Curso con alumnos no se elimina');

  // AuthContext role still from membership
  const ctx = await resolveAuthContext(await getUserById(adminA!.id));
  assert(ctx?.role === 'admin' && ctx.tenantId === tenantA, 'auth context admin A');
  ok('AuthContext admin restaurado tras tests');

  // No parallel tables
  const parallel = (await db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name IN (
      'institution_schools','institution_courses','institution_subjects'
    )
  `).all()) as Array<{ name: string }>;
  assert(parallel.length === 0, 'no tablas paralelas');
  ok('No se creó modelo académico paralelo');

  console.log(`\nverify:institution-academic OK (${checks} checks)`);
}

main().catch((error) => {
  console.error('\nverify:institution-academic FAILED');
  console.error(error);
  process.exit(1);
});
