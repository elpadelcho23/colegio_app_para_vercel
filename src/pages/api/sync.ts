import type { APIRoute } from 'astro';
import { canAccessCourse, canAccessStudent, canAccessSubject } from '../../server/auth';
import { db, type User } from '../../server/db';

type SyncEntity = 'attendance' | 'student' | 'grade' | 'subject' | 'course' | 'school' | 'clientState';
type SyncAction = 'upsert' | 'delete';

interface PendingOperation<TPayload = unknown> {
  id: string;
  clientMutationId: string;
  entity: SyncEntity;
  action: SyncAction;
  payload: TPayload;
}

interface AttendancePayload {
  id: string;
  docenteId: string;
  studentId: string;
  subjectId: string;
  fecha: string;
  estado: 'presente' | 'ausente';
  updatedAt: string;
}

interface StudentPayload {
  id: string;
  docenteId: string;
  nombre?: string;
  dni?: string;
  cursoId?: string;
  tutor?: string;
  subjectIds?: string[];
  activo?: boolean;
  updatedAt: string;
}

interface CoursePayload {
  id: string;
  docenteId: string;
  escuela?: string;
  nombre?: string;
  turno?: string;
  cicloLectivo?: number;
  updatedAt: string;
}

interface GradePayload {
  id: string;
  docenteId: string;
  studentId?: string;
  subjectId?: string;
  titulo?: string;
  tipoEvaluacion?: string;
  valor?: number | null;
  calificacionTexto?: string;
  peso?: number;
  fecha?: string;
  fechaEntrega?: string;
  periodo?: string;
  motivo?: string;
  updatedAt: string;
}

interface SubjectPayload {
  id: string;
  docenteId: string;
  nombre?: string;
  activo?: boolean;
  updatedAt: string;
}

interface SchoolPayload {
  id: string;
  docenteId: string;
  nombre?: string;
  activo?: boolean;
  updatedAt: string;
}

interface ClientStatePayload {
  id: string;
  docenteId: string;
  dashboardFilters?: Record<string, unknown>;
  teacherContext?: unknown[];
  updatedAt: string;
}

interface SyncResult {
  clientMutationId: string;
  status: 'synced' | 'duplicate' | 'error';
  message?: string;
  ignoredOlderWrite?: boolean;
}

type SyncApplyResult =
  | { status: 'synced'; ignoredOlderWrite?: boolean }
  | { status: 'error'; message: string };

/** Siempre usa el tenant de la sesión; nunca confía en el payload del cliente. */
function syncTenantId(user: User) {
  return user.tenant_id;
}

function rejectPayloadTenantMismatch(user: User, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const item = payload as { tenantId?: unknown; tenant_id?: unknown };
  const claimed = item.tenantId ?? item.tenant_id;
  if (claimed !== undefined && String(claimed) !== user.tenant_id) {
    return 'El tenant del payload no coincide con la sesión.';
  }
  return null;
}

/** Evita ON CONFLICT(id) que reescribe filas de otro tenant (PK global). */
async function rejectForeignPrimaryKey(
  table: 'alumnos' | 'cursos' | 'materias' | 'notas' | 'escuelas' | 'asistencias',
  id: string,
  tenantId: string,
): Promise<string | null> {
  const row = (await db.prepare(`SELECT tenant_id FROM ${table} WHERE id = ?`).get(id)) as
    | { tenant_id: string }
    | undefined;
  if (row && row.tenant_id !== tenantId) {
    return 'El id ya pertenece a otra cuenta.';
  }
  return null;
}

async function resolveSyncDocenteId(user: User, payload: { docenteId: string }): Promise<string | { error: string }> {
  if (payload.docenteId !== user.id && user.rol !== 'admin') {
    return { error: 'La operacion pertenece a otro docente.' };
  }

  if (payload.docenteId === user.id) return user.id;

  const docente = (await db.prepare(`
    SELECT id
    FROM usuarios
    WHERE id = ?
      AND tenant_id = ?
  `).get(payload.docenteId, user.tenant_id)) as { id: string } | undefined;

  if (!docente) {
    return { error: 'El docente no pertenece a esta institución.' };
  }

  return payload.docenteId;
}

function isAttendancePayload(payload: unknown): payload is AttendancePayload {
  if (!payload || typeof payload !== 'object') return false;
  const item = payload as Partial<AttendancePayload>;
  return Boolean(
    item.id &&
    item.docenteId &&
    item.studentId &&
    item.subjectId &&
    item.fecha &&
    (item.estado === 'presente' || item.estado === 'ausente') &&
    item.updatedAt,
  );
}

function hasIdAndUpdatedAt(payload: unknown): payload is { id: string; docenteId: string; updatedAt: string } {
  if (!payload || typeof payload !== 'object') return false;
  const item = payload as { id?: unknown; docenteId?: unknown; updatedAt?: unknown };
  return typeof item.id === 'string' && typeof item.docenteId === 'string' && typeof item.updatedAt === 'string';
}

async function validateAttendancePermission(user: User, payload: AttendancePayload) {
  if (user.rol !== 'admin' && payload.docenteId !== user.id) {
    return 'La operacion pertenece a otro docente.';
  }

  if (!(await canAccessStudent(user, payload.studentId))) {
    return 'El docente no tiene permiso sobre este alumno.';
  }

  if (!(await canAccessSubject(user, payload.subjectId))) {
    return 'El docente no tiene permiso sobre esta materia.';
  }

  return null;
}

async function applyAttendance(operation: PendingOperation<AttendancePayload>, user: User): Promise<SyncApplyResult> {
  const payload = operation.payload;
  const tenantMismatch = rejectPayloadTenantMismatch(user, payload);
  if (tenantMismatch) return { status: 'error', message: tenantMismatch };

  const tenantId = syncTenantId(user);
  const docenteResult = await resolveSyncDocenteId(user, payload);
  if (typeof docenteResult !== 'string') return { status: 'error', message: docenteResult.error };
  const docenteId = docenteResult;

  const existing = (await db.prepare(`
    SELECT id, updated_at
    FROM asistencias
    WHERE tenant_id = ?
      AND docente_id = ?
      AND alumno_id = ?
      AND materia_id = ?
      AND fecha = ?
  `).get(tenantId, docenteId, payload.studentId, payload.subjectId, payload.fecha)) as { id: string; updated_at: string } | undefined;

  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced' as const, ignoredOlderWrite: true };
  }

  const foreignId = await rejectForeignPrimaryKey('asistencias', payload.id, tenantId);
  if (foreignId) return { status: 'error', message: foreignId };

  await db.prepare(`
    INSERT INTO asistencias (id, tenant_id, docente_id, alumno_id, materia_id, fecha, estado, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (docente_id, alumno_id, materia_id, fecha)
    DO UPDATE SET
      id = excluded.id,
      estado = excluded.estado,
      updated_at = excluded.updated_at
    WHERE asistencias.tenant_id = excluded.tenant_id
  `).run([
    payload.id ?? null,
    tenantId ?? null,
    docenteId ?? null,
    payload.studentId ?? null,
    payload.subjectId ?? null,
    payload.fecha ?? null,
    payload.estado ?? null,
    payload.updatedAt ?? null,
  ]);

  return { status: 'synced' as const };
}

async function validateDocentePayload(user: User, payload: { docenteId: string }) {
  const docenteResult = await resolveSyncDocenteId(user, payload);
  if (typeof docenteResult !== 'string') return docenteResult.error;
  return null;
}

async function applyStudent(operation: PendingOperation<StudentPayload>, user: User): Promise<SyncApplyResult> {
  const payload = operation.payload;
  const tenantMismatch = rejectPayloadTenantMismatch(user, payload);
  if (tenantMismatch) return { status: 'error', message: tenantMismatch };

  const tenantId = syncTenantId(user);
  const docenteResult = await resolveSyncDocenteId(user, payload);
  if (typeof docenteResult !== 'string') return { status: 'error', message: docenteResult.error };
  const docenteId = docenteResult;

  if (operation.action === 'delete') {
    const existing = await db.prepare('SELECT id FROM alumnos WHERE id = ? AND tenant_id = ?')
      .get(payload.id, tenantId);
    if (!existing) return { status: 'error', message: 'Alumno no encontrado en esta institución.' };
    if (user.rol !== 'admin' && !(await canAccessStudent(user, payload.id))) {
      return { status: 'error', message: 'El docente no tiene permiso sobre este alumno.' };
    }

    const hasDependencies = await db.prepare(`
      SELECT 1 FROM asistencias
      WHERE tenant_id = ? AND alumno_id = ? AND (? = 1 OR docente_id = ?)
      UNION
      SELECT 1 FROM notas
      WHERE tenant_id = ? AND alumno_id = ? AND (? = 1 OR docente_id = ?)
      LIMIT 1
    `).get(
      tenantId, payload.id, user.rol === 'admin' ? 1 : 0, docenteId,
      tenantId, payload.id, user.rol === 'admin' ? 1 : 0, docenteId,
    );

    if (hasDependencies) {
      await db.prepare('UPDATE alumnos SET activo = 0, updated_at = ? WHERE id = ? AND tenant_id = ?').run(payload.updatedAt, payload.id, tenantId);
    } else {
      await db.prepare('DELETE FROM alumno_materias WHERE tenant_id = ? AND alumno_id = ?').run(tenantId, payload.id);
      await db.prepare('DELETE FROM alumnos WHERE id = ? AND tenant_id = ?').run(payload.id, tenantId);
    }
    return { status: 'synced' };
  }

  if (!payload.nombre || !payload.cursoId) return { status: 'error', message: 'Datos de alumno incompletos.' };

  const courseInTenant = await db.prepare('SELECT id FROM cursos WHERE id = ? AND tenant_id = ?')
    .get(payload.cursoId, tenantId);
  if (!courseInTenant) return { status: 'error', message: 'El curso no pertenece a esta institución.' };

  const existing = (await db.prepare('SELECT updated_at FROM alumnos WHERE id = ? AND tenant_id = ?')
    .get(payload.id, tenantId)) as { updated_at: string } | undefined;
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced', ignoredOlderWrite: true };
  }
  if (existing && user.rol !== 'admin' && !(await canAccessStudent(user, payload.id))) {
    return { status: 'error', message: 'El docente no tiene permiso sobre este alumno.' };
  }

  if (user.rol !== 'admin') {
    const course = await db.prepare('SELECT curso_id FROM docente_cursos WHERE tenant_id = ? AND docente_id = ? AND curso_id = ?').get(tenantId, docenteId, payload.cursoId);
    if (!course) return { status: 'error', message: 'El docente no tiene permiso sobre el curso.' };
  }

  const subjectIds = Array.isArray(payload.subjectIds) ? [...new Set(payload.subjectIds.filter(Boolean))] : null;
  if (subjectIds) {
    for (const subjectId of subjectIds) {
      const subjectInTenant = await db.prepare('SELECT id FROM materias WHERE id = ? AND tenant_id = ?').get(subjectId, tenantId);
      if (!subjectInTenant) return { status: 'error', message: 'Una materia no pertenece a esta institución.' };
      if (user.rol !== 'admin' && !(await canAccessSubject(user, subjectId))) {
        return { status: 'error', message: 'El docente no tiene permiso sobre una materia del alumno.' };
      }
    }
  }

  const foreignId = await rejectForeignPrimaryKey('alumnos', payload.id, tenantId);
  if (foreignId) return { status: 'error', message: foreignId };

  await db.prepare(`
    INSERT INTO alumnos (id, tenant_id, curso_id, nombre, dni, tutor, activo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      curso_id = excluded.curso_id,
      nombre = excluded.nombre,
      dni = excluded.dni,
      tutor = excluded.tutor,
      activo = excluded.activo,
      updated_at = excluded.updated_at
    WHERE alumnos.tenant_id = excluded.tenant_id
  `).run([
    payload.id ?? null,
    tenantId ?? null,
    payload.cursoId ?? null,
    payload.nombre ?? null,
    payload.dni || null,
    payload.tutor || null,
    payload.activo === false ? 0 : 1,
    payload.updatedAt ?? null,
  ]);

  if (subjectIds?.length) {
    await db.prepare('DELETE FROM alumno_materias WHERE tenant_id = ? AND alumno_id = ?').run([tenantId, payload.id]);
    const insert = db.prepare('INSERT OR IGNORE INTO alumno_materias (tenant_id, alumno_id, materia_id) VALUES (?, ?, ?)');
    for (const subjectId of subjectIds) await insert.run([tenantId, payload.id, subjectId]);
  }

  return { status: 'synced' };
}

async function applyCourse(operation: PendingOperation<CoursePayload>, user: User): Promise<SyncApplyResult> {
  const payload = operation.payload;
  const tenantMismatch = rejectPayloadTenantMismatch(user, payload);
  if (tenantMismatch) return { status: 'error', message: tenantMismatch };

  const tenantId = syncTenantId(user);
  const docenteResult = await resolveSyncDocenteId(user, payload);
  if (typeof docenteResult !== 'string') return { status: 'error', message: docenteResult.error };
  const docenteId = docenteResult;

  if (operation.action === 'delete') {
    const existing = await db.prepare('SELECT id FROM cursos WHERE id = ? AND tenant_id = ?')
      .get(payload.id, tenantId);
    if (!existing) return { status: 'error', message: 'Curso no encontrado en esta institución.' };
    if (user.rol !== 'admin' && !(await canAccessCourse(user, payload.id))) {
      return { status: 'error', message: 'El docente no tiene permiso sobre este curso.' };
    }

    const hasStudents = await db.prepare('SELECT 1 FROM alumnos WHERE tenant_id = ? AND curso_id = ? LIMIT 1').get(tenantId, payload.id);
    if (hasStudents) return { status: 'error', message: 'El curso tiene alumnos vinculados.' };
    if (user.rol === 'admin') {
      await db.prepare('DELETE FROM docente_cursos WHERE tenant_id = ? AND curso_id = ?').run(tenantId, payload.id);
      await db.prepare('DELETE FROM cursos WHERE tenant_id = ? AND id = ?').run(tenantId, payload.id);
    } else {
      await db.prepare('DELETE FROM docente_cursos WHERE tenant_id = ? AND docente_id = ? AND curso_id = ?')
        .run(tenantId, docenteId, payload.id);
      const remaining = await db.prepare('SELECT 1 FROM docente_cursos WHERE tenant_id = ? AND curso_id = ? LIMIT 1')
        .get(tenantId, payload.id);
      if (!remaining) {
        await db.prepare('DELETE FROM cursos WHERE tenant_id = ? AND id = ?').run(tenantId, payload.id);
      }
    }
    return { status: 'synced' };
  }

  if (!payload.escuela || !payload.nombre || !payload.turno) {
    return { status: 'error', message: 'Datos de curso incompletos.' };
  }

  const existing = (await db.prepare('SELECT updated_at FROM cursos WHERE id = ? AND tenant_id = ?')
    .get(payload.id, tenantId)) as { updated_at: string } | undefined;
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced', ignoredOlderWrite: true };
  }
  if (existing && user.rol !== 'admin' && !(await canAccessCourse(user, payload.id))) {
    return { status: 'error', message: 'El docente no tiene permiso sobre este curso.' };
  }

  const foreignId = await rejectForeignPrimaryKey('cursos', payload.id, tenantId);
  if (foreignId) return { status: 'error', message: foreignId };

  await db.prepare(`
    INSERT INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      escuela = excluded.escuela,
      nombre = excluded.nombre,
      turno = excluded.turno,
      ciclo_lectivo = excluded.ciclo_lectivo,
      updated_at = excluded.updated_at
    WHERE cursos.tenant_id = excluded.tenant_id
  `).run([
    payload.id ?? null,
    tenantId ?? null,
    payload.escuela ?? null,
    payload.nombre ?? null,
    payload.turno ?? null,
    payload.cicloLectivo || new Date().getFullYear(),
    payload.updatedAt ?? null,
  ]);
  await db.prepare('INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)')
    .run([tenantId, docenteId, payload.id]);

  return { status: 'synced' };
}

async function applyGrade(operation: PendingOperation<GradePayload>, user: User): Promise<SyncApplyResult> {
  const payload = operation.payload;
  const tenantMismatch = rejectPayloadTenantMismatch(user, payload);
  if (tenantMismatch) return { status: 'error', message: tenantMismatch };

  const tenantId = syncTenantId(user);
  const docenteResult = await resolveSyncDocenteId(user, payload);
  if (typeof docenteResult !== 'string') return { status: 'error', message: docenteResult.error };
  const docenteId = docenteResult;

  if (operation.action === 'delete') {
    const existing = await db.prepare('SELECT id FROM notas WHERE id = ? AND tenant_id = ?')
      .get(payload.id, tenantId);
    if (!existing) return { status: 'error', message: 'Nota no encontrada en esta institución.' };
    await db.prepare('DELETE FROM notas WHERE id = ? AND tenant_id = ? AND (? = 1 OR docente_id = ?)').run(payload.id, tenantId, user.rol === 'admin' ? 1 : 0, docenteId);
    return { status: 'synced' };
  }

  const hasNumericGrade = typeof payload.valor === 'number' && Number.isFinite(payload.valor);
  const hasTextGrade = typeof payload.calificacionTexto === 'string' && payload.calificacionTexto.trim().length > 0;
  if (!payload.studentId || !payload.subjectId || !payload.titulo || !payload.fecha || (!hasNumericGrade && !hasTextGrade)) {
    return { status: 'error' as const, message: 'Datos de nota incompletos.' };
  }
  const permissionError = await validateAttendancePermission(user, {
    id: payload.id,
    docenteId,
    studentId: payload.studentId,
    subjectId: payload.subjectId,
    fecha: payload.fecha,
    estado: 'presente',
    updatedAt: payload.updatedAt,
  });
  if (permissionError) return { status: 'error' as const, message: permissionError };

  const existing = (await db.prepare('SELECT updated_at FROM notas WHERE id = ? AND tenant_id = ?')
    .get(payload.id, tenantId)) as { updated_at: string } | undefined;
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced', ignoredOlderWrite: true };
  }

  const foreignId = await rejectForeignPrimaryKey('notas', payload.id, tenantId);
  if (foreignId) return { status: 'error', message: foreignId };

  await db.prepare(`
    INSERT INTO notas (id, tenant_id, docente_id, alumno_id, materia_id, titulo, tipo_evaluacion, valor, calificacion_texto, peso, fecha, fecha_entrega, periodo, motivo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      titulo = excluded.titulo,
      tipo_evaluacion = excluded.tipo_evaluacion,
      valor = excluded.valor,
      calificacion_texto = excluded.calificacion_texto,
      peso = excluded.peso,
      fecha = excluded.fecha,
      fecha_entrega = excluded.fecha_entrega,
      periodo = excluded.periodo,
      motivo = excluded.motivo,
      updated_at = excluded.updated_at
    WHERE notas.tenant_id = excluded.tenant_id
  `).run([
    payload.id ?? null,
    tenantId ?? null,
    docenteId ?? null,
    payload.studentId ?? null,
    payload.subjectId ?? null,
    payload.titulo ?? null,
    payload.tipoEvaluacion || null,
    hasNumericGrade ? payload.valor : null,
    hasTextGrade ? (payload.calificacionTexto?.trim() || null) : null,
    payload.peso || 100,
    payload.fecha ?? null,
    payload.fechaEntrega || null,
    payload.periodo || null,
    payload.motivo?.trim() || null,
    payload.updatedAt ?? null,
  ]);

  return { status: 'synced' };
}

async function applySubject(operation: PendingOperation<SubjectPayload>, user: User): Promise<SyncApplyResult> {
  const payload = operation.payload;
  const tenantMismatch = rejectPayloadTenantMismatch(user, payload);
  if (tenantMismatch) return { status: 'error', message: tenantMismatch };

  const tenantId = syncTenantId(user);
  const docenteResult = await resolveSyncDocenteId(user, payload);
  if (typeof docenteResult !== 'string') return { status: 'error', message: docenteResult.error };
  const docenteId = docenteResult;

  if (operation.action === 'delete') {
    const existing = await db.prepare('SELECT id FROM materias WHERE id = ? AND tenant_id = ?')
      .get(payload.id, tenantId);
    if (!existing) return { status: 'error', message: 'Materia no encontrada en esta institución.' };
    if (user.rol !== 'admin' && !(await canAccessSubject(user, payload.id))) {
      return { status: 'error', message: 'El docente no tiene permiso sobre esta materia.' };
    }

    const hasDependencies = await db.prepare(`
      SELECT 1 FROM asistencias
      WHERE tenant_id = ? AND materia_id = ? AND (? = 1 OR docente_id = ?)
      UNION
      SELECT 1 FROM notas
      WHERE tenant_id = ? AND materia_id = ? AND (? = 1 OR docente_id = ?)
      LIMIT 1
    `).get(
      tenantId, payload.id, user.rol === 'admin' ? 1 : 0, docenteId,
      tenantId, payload.id, user.rol === 'admin' ? 1 : 0, docenteId,
    );

    if (hasDependencies) {
      if (user.rol === 'admin') {
        await db.prepare('UPDATE materias SET activo = 0, updated_at = ? WHERE id = ? AND tenant_id = ?').run(payload.updatedAt, payload.id, tenantId);
      } else {
        await db.prepare('DELETE FROM docente_materias WHERE tenant_id = ? AND docente_id = ? AND materia_id = ?')
          .run(tenantId, docenteId, payload.id);
      }
    } else if (user.rol === 'admin') {
      await db.prepare('DELETE FROM docente_materias WHERE tenant_id = ? AND materia_id = ?').run(tenantId, payload.id);
      await db.prepare('DELETE FROM materias WHERE id = ? AND tenant_id = ?').run(payload.id, tenantId);
    } else {
      await db.prepare('DELETE FROM docente_materias WHERE tenant_id = ? AND docente_id = ? AND materia_id = ?')
        .run(tenantId, docenteId, payload.id);
      const remaining = await db.prepare('SELECT 1 FROM docente_materias WHERE tenant_id = ? AND materia_id = ? LIMIT 1')
        .get(tenantId, payload.id);
      if (!remaining) {
        await db.prepare('DELETE FROM materias WHERE id = ? AND tenant_id = ?').run(payload.id, tenantId);
      }
    }
    return { status: 'synced' };
  }

  if (!payload.nombre) return { status: 'error', message: 'Nombre de materia requerido.' };
  const existing = (await db.prepare('SELECT updated_at FROM materias WHERE id = ? AND tenant_id = ?')
    .get(payload.id, tenantId)) as { updated_at: string } | undefined;
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced', ignoredOlderWrite: true };
  }
  if (existing && user.rol !== 'admin' && !(await canAccessSubject(user, payload.id))) {
    return { status: 'error', message: 'El docente no tiene permiso sobre esta materia.' };
  }

  const foreignId = await rejectForeignPrimaryKey('materias', payload.id, tenantId);
  if (foreignId) return { status: 'error', message: foreignId };

  await db.prepare(`
    INSERT INTO materias (id, tenant_id, nombre, activo, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      nombre = excluded.nombre,
      activo = excluded.activo,
      updated_at = excluded.updated_at
    WHERE materias.tenant_id = excluded.tenant_id
  `).run([
    payload.id ?? null,
    tenantId ?? null,
    payload.nombre ?? null,
    payload.activo === false ? 0 : 1,
    payload.updatedAt ?? null,
  ]);
  await db.prepare('INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id) VALUES (?, ?, ?)')
    .run([tenantId, docenteId, payload.id]);

  return { status: 'synced' };
}

async function applySchool(operation: PendingOperation<SchoolPayload>, user: User): Promise<SyncApplyResult> {
  const payload = operation.payload;
  const docenteId = user.rol === 'admin' ? payload.docenteId : user.id;
  const tenantId = user.rol === 'admin'
    ? ((await db.prepare('SELECT tenant_id FROM usuarios WHERE id = ?').get(docenteId)) as { tenant_id: string } | undefined)?.tenant_id || user.tenant_id
    : user.tenant_id;

  if (operation.action === 'delete') {
    const school = (await db.prepare('SELECT nombre FROM escuelas WHERE id = ? AND tenant_id = ?').get(payload.id, tenantId)) as { nombre: string } | undefined;
    if (school) {
      const hasCourses = await db.prepare('SELECT 1 FROM cursos WHERE tenant_id = ? AND escuela = ? LIMIT 1').get(tenantId, school.nombre);
      if (hasCourses) {
        if (user.rol === 'admin') {
          await db.prepare('UPDATE escuelas SET activo = 0, updated_at = ? WHERE id = ? AND tenant_id = ?').run(payload.updatedAt, payload.id, tenantId);
        } else {
          await db.prepare('DELETE FROM docente_escuelas WHERE tenant_id = ? AND docente_id = ? AND escuela_id = ?')
            .run(tenantId, docenteId, payload.id);
        }
        return { status: 'synced' as const };
      }
    }
    await db.prepare(
      user.rol === 'admin'
        ? 'DELETE FROM docente_escuelas WHERE tenant_id = ? AND escuela_id = ?'
        : 'DELETE FROM docente_escuelas WHERE tenant_id = ? AND docente_id = ? AND escuela_id = ?',
    ).run(...(user.rol === 'admin' ? [tenantId, payload.id] : [tenantId, docenteId, payload.id]));
    if (user.rol === 'admin') {
      await db.prepare('DELETE FROM escuelas WHERE id = ? AND tenant_id = ?').run(payload.id, tenantId);
    } else {
      const remaining = await db.prepare('SELECT 1 FROM docente_escuelas WHERE tenant_id = ? AND escuela_id = ? LIMIT 1')
        .get(tenantId, payload.id);
      if (!remaining) {
        await db.prepare('DELETE FROM escuelas WHERE id = ? AND tenant_id = ?').run(payload.id, tenantId);
      }
    }
    return { status: 'synced' as const };
  }

  if (!payload.nombre) return { status: 'error' as const, message: 'Nombre de escuela requerido.' };
  const existing = (await db.prepare('SELECT tenant_id, updated_at FROM escuelas WHERE id = ?').get(payload.id)) as { tenant_id: string; updated_at: string } | undefined;
  if (existing && existing.tenant_id !== tenantId) return { status: 'error' as const, message: 'La escuela pertenece a otra cuenta.' };
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced' as const, ignoredOlderWrite: true };
  }

  const foreignId = await rejectForeignPrimaryKey('escuelas', payload.id, tenantId);
  if (foreignId) return { status: 'error' as const, message: foreignId };

  await db.prepare(`
    INSERT INTO escuelas (id, tenant_id, nombre, activo, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      nombre = excluded.nombre,
      activo = excluded.activo,
      updated_at = excluded.updated_at
    WHERE escuelas.tenant_id = excluded.tenant_id
  `).run([
    payload.id ?? null,
    tenantId ?? null,
    payload.nombre ?? null,
    payload.activo === false ? 0 : 1,
    payload.updatedAt ?? null,
  ]);
  await db.prepare('INSERT OR IGNORE INTO docente_escuelas (tenant_id, docente_id, escuela_id) VALUES (?, ?, ?)')
    .run([tenantId, docenteId, payload.id]);

  return { status: 'synced' as const };
}

async function applyClientState(operation: PendingOperation<ClientStatePayload>, user: User): Promise<SyncApplyResult> {
  const payload = operation.payload;
  if (operation.action === 'delete') {
    return { status: 'error', message: 'El estado del docente no se elimina.' };
  }

  const tenantId = syncTenantId(user);
  const docenteId = user.rol === 'admin' ? (payload.docenteId || user.id) : user.id;
  if (user.rol !== 'admin' && payload.id !== user.id && payload.docenteId !== user.id) {
    return { status: 'error', message: 'El estado pertenece a otro docente.' };
  }

  const existing = (await db.prepare(
    'SELECT updated_at FROM docente_client_state WHERE docente_id = ? AND tenant_id = ?',
  ).get(docenteId, tenantId)) as { updated_at: string } | undefined;
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced', ignoredOlderWrite: true };
  }

  const dashboardFilters = payload.dashboardFilters && typeof payload.dashboardFilters === 'object' && !Array.isArray(payload.dashboardFilters)
    ? payload.dashboardFilters
    : {};
  const teacherContext = Array.isArray(payload.teacherContext) ? payload.teacherContext : [];

  await db.prepare(`
    INSERT INTO docente_client_state (docente_id, tenant_id, dashboard_filters, teacher_context, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(docente_id) DO UPDATE SET
      dashboard_filters = excluded.dashboard_filters,
      teacher_context = excluded.teacher_context,
      updated_at = excluded.updated_at
    WHERE docente_client_state.tenant_id = excluded.tenant_id
  `).run([
    docenteId,
    tenantId,
    JSON.stringify(dashboardFilters),
    JSON.stringify(teacherContext),
    payload.updatedAt,
  ]);

  return { status: 'synced' };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ success: false, error: 'No autenticado' }, { status: 401 });

  try {
    const body = await request.json().catch(() => null);
    const operations = Array.isArray(body?.operations) ? body.operations as PendingOperation[] : [];

    if (operations.length === 0) {
      return Response.json({ success: false, error: 'Sin operaciones', results: [] }, { status: 400 });
    }

    const results: SyncResult[] = [];
    const tx = db.transaction(async () => {
      for (const operation of operations) {
        if (!operation.clientMutationId) {
          results.push({ clientMutationId: '', status: 'error', message: 'Falta clientMutationId.' });
          continue;
        }

        const duplicate = await db.prepare(`
          SELECT client_mutation_id
          FROM sync_log
          WHERE client_mutation_id = ?
            AND tenant_id = ?
        `).get([operation.clientMutationId, user.tenant_id]);

        if (duplicate) {
          results.push({ clientMutationId: operation.clientMutationId, status: 'duplicate' });
          continue;
        }

        if (!['attendance', 'student', 'grade', 'subject', 'school', 'course', 'clientState'].includes(operation.entity)) {
          results.push({
            clientMutationId: operation.clientMutationId,
            status: 'error',
            message: 'Operacion no soportada.',
          });
          continue;
        }

        const payload = operation.payload;
        if (!hasIdAndUpdatedAt(payload)) {
          results.push({
            clientMutationId: operation.clientMutationId,
            status: 'error',
            message: 'Payload invalido.',
          });
          continue;
        }

        // Forzar docente/tenant de la sesión (no confiar en el cliente).
        if (user.rol !== 'admin') {
          (payload as { docenteId: string }).docenteId = user.id;
        }

        const tenantMismatch = rejectPayloadTenantMismatch(user, payload);
        if (tenantMismatch) {
          results.push({
            clientMutationId: operation.clientMutationId,
            status: 'error',
            message: tenantMismatch,
          });
          continue;
        }

        const docenteError = await validateDocentePayload(user, payload);
        if (docenteError) {
          results.push({
            clientMutationId: operation.clientMutationId,
            status: 'error',
            message: docenteError,
          });
          continue;
        }

        let applied: SyncApplyResult;

        // Errores de LibSQL salen al catch externo del POST (1 op por request desde el cliente).
        if (operation.entity === 'attendance') {
          if (!isAttendancePayload(payload) || operation.action !== 'upsert') {
            applied = { status: 'error', message: 'Payload de asistencia invalido.' };
          } else {
            const permissionError = await validateAttendancePermission(user, payload);
            applied = permissionError
              ? { status: 'error', message: permissionError }
              : await applyAttendance(operation as PendingOperation<AttendancePayload>, user);
          }
        } else if (operation.entity === 'student') {
          applied = await applyStudent(operation as PendingOperation<StudentPayload>, user);
        } else if (operation.entity === 'course') {
          applied = await applyCourse(operation as PendingOperation<CoursePayload>, user);
        } else if (operation.entity === 'grade') {
          applied = await applyGrade(operation as PendingOperation<GradePayload>, user);
        } else if (operation.entity === 'school') {
          applied = await applySchool(operation as PendingOperation<SchoolPayload>, user);
        } else if (operation.entity === 'clientState') {
          applied = await applyClientState(operation as PendingOperation<ClientStatePayload>, user);
        } else {
          applied = await applySubject(operation as PendingOperation<SubjectPayload>, user);
        }

        if (applied.status === 'error') {
          results.push({
            clientMutationId: operation.clientMutationId,
            status: 'error',
            message: applied.message,
          });
          continue;
        }

        const loggedDocenteId = await resolveSyncDocenteId(user, payload);
        const docenteIdForLog = typeof loggedDocenteId === 'string' ? loggedDocenteId : user.id;

        await db.prepare(`
          INSERT OR IGNORE INTO sync_log (client_mutation_id, tenant_id, docente_id, entity, operation_id, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run([
          operation.clientMutationId,
          user.tenant_id,
          docenteIdForLog,
          operation.entity,
          operation.id,
          'synced',
        ]);

        results.push({
          clientMutationId: operation.clientMutationId,
          status: applied.status,
          ignoredOlderWrite: applied.ignoredOlderWrite ?? false,
        });
      }
    });

    await tx();

    return Response.json({ success: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Error desconocido');
    console.error('[api/sync] POST failed', message);
    return Response.json({ success: false, error: message, results: [] }, { status: 500 });
  }
};
