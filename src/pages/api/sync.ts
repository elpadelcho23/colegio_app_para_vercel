import type { APIRoute } from 'astro';
import { canAccessCourse, canAccessStudent, canAccessSubject } from '../../server/auth';
import { db, type User } from '../../server/db';

type SyncEntity = 'attendance' | 'student' | 'grade' | 'subject' | 'course';
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
  updatedAt: string;
}

interface SubjectPayload {
  id: string;
  docenteId: string;
  nombre?: string;
  activo?: boolean;
  updatedAt: string;
}

interface SyncResult {
  clientMutationId: string;
  status: 'synced' | 'duplicate' | 'error';
  message?: string;
  ignoredOlderWrite?: boolean;
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

function validateAttendancePermission(user: User, payload: AttendancePayload) {
  if (user.rol !== 'admin' && payload.docenteId !== user.id) {
    return 'La operacion pertenece a otro docente.';
  }

  if (!canAccessStudent(user, payload.studentId)) {
    return 'El docente no tiene permiso sobre este alumno.';
  }

  if (!canAccessSubject(user, payload.subjectId)) {
    return 'El docente no tiene permiso sobre esta materia.';
  }

  return null;
}

function applyAttendance(operation: PendingOperation<AttendancePayload>, user: User) {
  const payload = operation.payload;
  const docenteId = user.rol === 'admin' ? payload.docenteId : user.id;
  const tenantId = user.rol === 'admin'
    ? (db.prepare('SELECT tenant_id FROM usuarios WHERE id = ?').get(docenteId) as { tenant_id: string } | undefined)?.tenant_id || user.tenant_id
    : user.tenant_id;

  const existing = db.prepare(`
    SELECT id, updated_at
    FROM asistencias
    WHERE tenant_id = ?
      AND docente_id = ?
      AND alumno_id = ?
      AND materia_id = ?
      AND fecha = ?
  `).get(tenantId, docenteId, payload.studentId, payload.subjectId, payload.fecha) as { id: string; updated_at: string } | undefined;

  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced' as const, ignoredOlderWrite: true };
  }

  db.prepare(`
    INSERT INTO asistencias (id, tenant_id, docente_id, alumno_id, materia_id, fecha, estado, updated_at)
    VALUES (@id, @tenant_id, @docente_id, @alumno_id, @materia_id, @fecha, @estado, @updated_at)
    ON CONFLICT (docente_id, alumno_id, materia_id, fecha)
    DO UPDATE SET
      estado = excluded.estado,
      updated_at = excluded.updated_at
  `).run({
    id: payload.id,
    tenant_id: tenantId,
    docente_id: docenteId,
    alumno_id: payload.studentId,
    materia_id: payload.subjectId,
    fecha: payload.fecha,
    estado: payload.estado,
    updated_at: payload.updatedAt,
  });

  return { status: 'synced' as const };
}

function validateDocentePayload(user: User, payload: { docenteId: string }) {
  if (user.rol !== 'admin' && payload.docenteId !== user.id) return 'La operacion pertenece a otro docente.';
  return null;
}

function applyStudent(operation: PendingOperation<StudentPayload>, user: User) {
  const payload = operation.payload;
  const docenteId = user.rol === 'admin' ? payload.docenteId : user.id;
  const tenantId = user.rol === 'admin'
    ? (db.prepare('SELECT tenant_id FROM usuarios WHERE id = ?').get(docenteId) as { tenant_id: string } | undefined)?.tenant_id || user.tenant_id
    : user.tenant_id;

  if (operation.action === 'delete') {
    const hasDependencies = db.prepare(`
      SELECT 1 FROM asistencias WHERE tenant_id = ? AND alumno_id = ?
      UNION
      SELECT 1 FROM notas WHERE tenant_id = ? AND alumno_id = ?
      LIMIT 1
    `).get(tenantId, payload.id, tenantId, payload.id);

    if (hasDependencies) {
      db.prepare('UPDATE alumnos SET activo = 0, updated_at = ? WHERE id = ? AND tenant_id = ?').run(payload.updatedAt, payload.id, tenantId);
    } else {
      db.prepare('DELETE FROM alumnos WHERE id = ? AND tenant_id = ?').run(payload.id, tenantId);
    }
    return { status: 'synced' as const };
  }

  if (!payload.nombre || !payload.cursoId) return { status: 'error' as const, message: 'Datos de alumno incompletos.' };

  const existing = db.prepare('SELECT tenant_id, updated_at FROM alumnos WHERE id = ?').get(payload.id) as { tenant_id: string; updated_at: string } | undefined;
  if (existing && existing.tenant_id !== tenantId) return { status: 'error' as const, message: 'El alumno pertenece a otra cuenta.' };
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced' as const, ignoredOlderWrite: true };
  }

  if (user.rol !== 'admin') {
    const course = db.prepare('SELECT curso_id FROM docente_cursos WHERE tenant_id = ? AND docente_id = ? AND curso_id = ?').get(tenantId, docenteId, payload.cursoId);
    if (!course) return { status: 'error' as const, message: 'El docente no tiene permiso sobre el curso.' };
  }

  const subjectIds = Array.isArray(payload.subjectIds) ? [...new Set(payload.subjectIds.filter(Boolean))] : null;
  if (subjectIds) {
    for (const subjectId of subjectIds) {
      if (!canAccessSubject(user, subjectId)) {
        return { status: 'error' as const, message: 'El docente no tiene permiso sobre una materia del alumno.' };
      }
    }
  }

  db.prepare(`
    INSERT INTO alumnos (id, tenant_id, curso_id, nombre, dni, tutor, activo, updated_at)
    VALUES (@id, @tenant_id, @curso_id, @nombre, @dni, @tutor, @activo, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      curso_id = excluded.curso_id,
      nombre = excluded.nombre,
      dni = excluded.dni,
      tutor = excluded.tutor,
      activo = excluded.activo,
      updated_at = excluded.updated_at
  `).run({
    id: payload.id,
    tenant_id: tenantId,
    curso_id: payload.cursoId,
    nombre: payload.nombre,
    dni: payload.dni || null,
    tutor: payload.tutor || null,
    activo: payload.activo === false ? 0 : 1,
    updated_at: payload.updatedAt,
  });

  if (subjectIds) {
    db.prepare('DELETE FROM alumno_materias WHERE tenant_id = ? AND alumno_id = ?').run(tenantId, payload.id);
    const insert = db.prepare('INSERT OR IGNORE INTO alumno_materias (tenant_id, alumno_id, materia_id) VALUES (?, ?, ?)');
    for (const subjectId of subjectIds) insert.run(tenantId, payload.id, subjectId);
  }

  return { status: 'synced' as const };
}

function applyCourse(operation: PendingOperation<CoursePayload>, user: User) {
  const payload = operation.payload;
  const docenteId = user.rol === 'admin' ? payload.docenteId : user.id;
  const tenantId = user.rol === 'admin'
    ? (db.prepare('SELECT tenant_id FROM usuarios WHERE id = ?').get(docenteId) as { tenant_id: string } | undefined)?.tenant_id || user.tenant_id
    : user.tenant_id;

  if (operation.action === 'delete') {
    const hasStudents = db.prepare('SELECT 1 FROM alumnos WHERE tenant_id = ? AND curso_id = ? LIMIT 1').get(tenantId, payload.id);
    if (hasStudents) return { status: 'error' as const, message: 'El curso tiene alumnos vinculados.' };
    db.prepare('DELETE FROM docente_cursos WHERE tenant_id = ? AND curso_id = ?').run(tenantId, payload.id);
    db.prepare('DELETE FROM cursos WHERE tenant_id = ? AND id = ?').run(tenantId, payload.id);
    return { status: 'synced' as const };
  }

  if (!payload.escuela || !payload.nombre || !payload.turno) {
    return { status: 'error' as const, message: 'Datos de curso incompletos.' };
  }

  const existing = db.prepare('SELECT tenant_id, updated_at FROM cursos WHERE id = ?').get(payload.id) as { tenant_id: string; updated_at: string } | undefined;
  if (existing && existing.tenant_id !== tenantId) return { status: 'error' as const, message: 'El curso pertenece a otra cuenta.' };
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced' as const, ignoredOlderWrite: true };
  }

  db.prepare(`
    INSERT INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo, updated_at)
    VALUES (@id, @tenant_id, @escuela, @nombre, @turno, @ciclo_lectivo, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      escuela = excluded.escuela,
      nombre = excluded.nombre,
      turno = excluded.turno,
      ciclo_lectivo = excluded.ciclo_lectivo,
      updated_at = excluded.updated_at
  `).run({
    id: payload.id,
    tenant_id: tenantId,
    escuela: payload.escuela,
    nombre: payload.nombre,
    turno: payload.turno,
    ciclo_lectivo: payload.cicloLectivo || new Date().getFullYear(),
    updated_at: payload.updatedAt,
  });
  db.prepare('INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)').run(tenantId, docenteId, payload.id);

  return { status: 'synced' as const };
}

function applyGrade(operation: PendingOperation<GradePayload>, user: User) {
  const payload = operation.payload;
  const docenteId = user.rol === 'admin' ? payload.docenteId : user.id;
  const tenantId = user.rol === 'admin'
    ? (db.prepare('SELECT tenant_id FROM usuarios WHERE id = ?').get(docenteId) as { tenant_id: string } | undefined)?.tenant_id || user.tenant_id
    : user.tenant_id;

  if (operation.action === 'delete') {
    db.prepare('DELETE FROM notas WHERE id = ? AND tenant_id = ? AND (? = 1 OR docente_id = ?)').run(payload.id, tenantId, user.rol === 'admin' ? 1 : 0, docenteId);
    return { status: 'synced' as const };
  }

  const hasNumericGrade = typeof payload.valor === 'number' && Number.isFinite(payload.valor);
  const hasTextGrade = typeof payload.calificacionTexto === 'string' && payload.calificacionTexto.trim().length > 0;
  if (!payload.studentId || !payload.subjectId || !payload.titulo || !payload.fecha || (!hasNumericGrade && !hasTextGrade)) {
    return { status: 'error' as const, message: 'Datos de nota incompletos.' };
  }
  const permissionError = validateAttendancePermission(user, {
    id: payload.id,
    docenteId,
    studentId: payload.studentId,
    subjectId: payload.subjectId,
    fecha: payload.fecha,
    estado: 'presente',
    updatedAt: payload.updatedAt,
  });
  if (permissionError) return { status: 'error' as const, message: permissionError };

  const existing = db.prepare('SELECT tenant_id, updated_at FROM notas WHERE id = ?').get(payload.id) as { tenant_id: string; updated_at: string } | undefined;
  if (existing && existing.tenant_id !== tenantId) return { status: 'error' as const, message: 'La nota pertenece a otra cuenta.' };
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced' as const, ignoredOlderWrite: true };
  }

  db.prepare(`
    INSERT INTO notas (id, tenant_id, docente_id, alumno_id, materia_id, titulo, tipo_evaluacion, valor, calificacion_texto, peso, fecha, fecha_entrega, updated_at)
    VALUES (@id, @tenant_id, @docente_id, @alumno_id, @materia_id, @titulo, @tipo_evaluacion, @valor, @calificacion_texto, @peso, @fecha, @fecha_entrega, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      titulo = excluded.titulo,
      tipo_evaluacion = excluded.tipo_evaluacion,
      valor = excluded.valor,
      calificacion_texto = excluded.calificacion_texto,
      peso = excluded.peso,
      fecha = excluded.fecha,
      fecha_entrega = excluded.fecha_entrega,
      updated_at = excluded.updated_at
  `).run({
    id: payload.id,
    tenant_id: tenantId,
    docente_id: docenteId,
    alumno_id: payload.studentId,
    materia_id: payload.subjectId,
    titulo: payload.titulo,
    tipo_evaluacion: payload.tipoEvaluacion || null,
    valor: hasNumericGrade ? payload.valor : null,
    calificacion_texto: hasTextGrade ? payload.calificacionTexto?.trim() : null,
    peso: payload.peso || 100,
    fecha: payload.fecha,
    fecha_entrega: payload.fechaEntrega || null,
    updated_at: payload.updatedAt,
  });

  return { status: 'synced' as const };
}

function applySubject(operation: PendingOperation<SubjectPayload>, user: User) {
  const payload = operation.payload;
  const docenteId = user.rol === 'admin' ? payload.docenteId : user.id;
  const tenantId = user.rol === 'admin'
    ? (db.prepare('SELECT tenant_id FROM usuarios WHERE id = ?').get(docenteId) as { tenant_id: string } | undefined)?.tenant_id || user.tenant_id
    : user.tenant_id;

  if (operation.action === 'delete') {
    const hasDependencies = db.prepare(`
      SELECT 1 FROM asistencias WHERE tenant_id = ? AND materia_id = ?
      UNION
      SELECT 1 FROM notas WHERE tenant_id = ? AND materia_id = ?
      LIMIT 1
    `).get(tenantId, payload.id, tenantId, payload.id);

    if (hasDependencies) {
      db.prepare('UPDATE materias SET activo = 0, updated_at = ? WHERE id = ? AND tenant_id = ?').run(payload.updatedAt, payload.id, tenantId);
    } else {
      db.prepare('DELETE FROM docente_materias WHERE tenant_id = ? AND materia_id = ?').run(tenantId, payload.id);
      db.prepare('DELETE FROM materias WHERE id = ? AND tenant_id = ?').run(payload.id, tenantId);
    }
    return { status: 'synced' as const };
  }

  if (!payload.nombre) return { status: 'error' as const, message: 'Nombre de materia requerido.' };
  const existing = db.prepare('SELECT tenant_id, updated_at FROM materias WHERE id = ?').get(payload.id) as { tenant_id: string; updated_at: string } | undefined;
  if (existing && existing.tenant_id !== tenantId) return { status: 'error' as const, message: 'La materia pertenece a otra cuenta.' };
  if (existing && new Date(existing.updated_at).getTime() > new Date(payload.updatedAt).getTime()) {
    return { status: 'synced' as const, ignoredOlderWrite: true };
  }

  db.prepare(`
    INSERT INTO materias (id, tenant_id, nombre, activo, updated_at)
    VALUES (@id, @tenant_id, @nombre, @activo, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      nombre = excluded.nombre,
      activo = excluded.activo,
      updated_at = excluded.updated_at
  `).run({
    id: payload.id,
    tenant_id: tenantId,
    nombre: payload.nombre,
    activo: payload.activo === false ? 0 : 1,
    updated_at: payload.updatedAt,
  });
  db.prepare('INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id) VALUES (?, ?, ?)').run(tenantId, docenteId, payload.id);

  return { status: 'synced' as const };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const operations = Array.isArray(body?.operations) ? body.operations as PendingOperation[] : [];

  if (operations.length === 0) {
    return Response.json({ results: [] }, { status: 400 });
  }

  const results: SyncResult[] = [];
  const tx = db.transaction((items: PendingOperation[]) => {
    for (const operation of items) {
      if (!operation.clientMutationId) {
        results.push({ clientMutationId: '', status: 'error', message: 'Falta clientMutationId.' });
        continue;
      }

      const duplicate = db.prepare(`
        SELECT client_mutation_id
        FROM sync_log
        WHERE client_mutation_id = ?
      `).get(operation.clientMutationId);

      if (duplicate) {
        results.push({ clientMutationId: operation.clientMutationId, status: 'duplicate' });
        continue;
      }

      if (!['attendance', 'student', 'grade', 'subject', 'course'].includes(operation.entity)) {
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

      const docenteError = validateDocentePayload(user, payload);
      if (docenteError) {
        results.push({
          clientMutationId: operation.clientMutationId,
          status: 'error',
          message: docenteError,
        });
        continue;
      }

      let applied:
        | { status: 'synced'; ignoredOlderWrite?: boolean }
        | { status: 'error'; message: string };

      if (operation.entity === 'attendance') {
        if (!isAttendancePayload(payload) || operation.action !== 'upsert') {
          applied = { status: 'error', message: 'Payload de asistencia invalido.' };
        } else {
          const permissionError = validateAttendancePermission(user, payload);
          applied = permissionError
            ? { status: 'error', message: permissionError }
            : applyAttendance(operation as PendingOperation<AttendancePayload>, user);
        }
      } else if (operation.entity === 'student') {
        applied = applyStudent(operation as PendingOperation<StudentPayload>, user);
      } else if (operation.entity === 'course') {
        const coursePayload = payload as CoursePayload;
        if (coursePayload.id && !canAccessCourse(user, coursePayload.id) && operation.action === 'delete') {
          applied = { status: 'error', message: 'El docente no tiene permiso sobre este curso.' };
        } else {
          applied = applyCourse(operation as PendingOperation<CoursePayload>, user);
        }
      } else if (operation.entity === 'grade') {
        applied = applyGrade(operation as PendingOperation<GradePayload>, user);
      } else {
        applied = applySubject(operation as PendingOperation<SubjectPayload>, user);
      }

      if (applied.status === 'error') {
        results.push({
          clientMutationId: operation.clientMutationId,
          status: 'error',
          message: applied.message,
        });
        continue;
      }

      db.prepare(`
        INSERT INTO sync_log (client_mutation_id, tenant_id, docente_id, entity, operation_id, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(operation.clientMutationId, user.tenant_id, user.rol === 'admin' ? payload.docenteId : user.id, operation.entity, operation.id, 'synced');

      results.push({
        clientMutationId: operation.clientMutationId,
        status: applied.status,
        ignoredOlderWrite: applied.ignoredOlderWrite ?? false,
      });
    }
  });

  tx(operations);

  return Response.json({ results });
};
