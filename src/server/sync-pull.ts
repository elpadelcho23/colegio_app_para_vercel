import { db, type User } from './db';

function tenantFilter(user: User, table: string) {
  if (user.rol === 'admin') return { clause: `WHERE ${table}.tenant_id = @tenant_id`, params: { tenant_id: user.tenant_id } };
  return {
    clause: `WHERE ${table}.tenant_id = @tenant_id AND ${table}.docente_id = @docente_id`,
    params: { tenant_id: user.tenant_id, docente_id: user.id },
  };
}

export function pullClientData(user: User) {
  const { tenant_id: tenantId, id: docenteId } = user;
  const isAdmin = user.rol === 'admin';

  const courses = (isAdmin
    ? db.prepare(`
      SELECT id, escuela, nombre, turno, ciclo_lectivo AS cicloLectivo
      FROM cursos
      WHERE tenant_id = ?
    `)
    : db.prepare(`
      SELECT cursos.id, cursos.escuela, cursos.nombre, cursos.turno, cursos.ciclo_lectivo AS cicloLectivo
      FROM cursos
      JOIN docente_cursos ON docente_cursos.curso_id = cursos.id AND docente_cursos.tenant_id = cursos.tenant_id
      WHERE cursos.tenant_id = ? AND docente_cursos.docente_id = ?
    `)
  ).all(...(isAdmin ? [tenantId] : [tenantId, docenteId])) as Array<{
    id: string;
    escuela: string;
    nombre: string;
    turno: string;
    cicloLectivo: number;
  }>;

  const subjects = (isAdmin
    ? db.prepare(`
      SELECT id, nombre, activo
      FROM materias
      WHERE tenant_id = ?
    `)
    : db.prepare(`
      SELECT materias.id, materias.nombre, materias.activo
      FROM materias
      JOIN docente_materias ON docente_materias.materia_id = materias.id AND docente_materias.tenant_id = materias.tenant_id
      WHERE materias.tenant_id = ? AND docente_materias.docente_id = ?
    `)
  ).all(...(isAdmin ? [tenantId] : [tenantId, docenteId])) as Array<{
    id: string;
    nombre: string;
    activo: number;
  }>;

  const students = (isAdmin
    ? db.prepare(`
      SELECT id, nombre, dni, curso_id AS cursoId, tutor, activo
      FROM alumnos
      WHERE tenant_id = ?
    `)
    : db.prepare(`
      SELECT alumnos.id, alumnos.nombre, alumnos.dni, alumnos.curso_id AS cursoId, alumnos.tutor, alumnos.activo
      FROM alumnos
      JOIN docente_cursos ON docente_cursos.curso_id = alumnos.curso_id AND docente_cursos.tenant_id = alumnos.tenant_id
      WHERE alumnos.tenant_id = ? AND docente_cursos.docente_id = ?
    `)
  ).all(...(isAdmin ? [tenantId] : [tenantId, docenteId])) as Array<{
    id: string;
    nombre: string;
    dni: string | null;
    cursoId: string;
    tutor: string | null;
    activo: number;
  }>;

  const subjectLinks = db.prepare(`
    SELECT alumno_id, materia_id
    FROM alumno_materias
    WHERE tenant_id = ?
  `).all(tenantId) as Array<{ alumno_id: string; materia_id: string }>;

  const attendanceFilter = tenantFilter(user, 'asistencias');
  const attendance = db.prepare(`
    SELECT id, alumno_id AS studentId, materia_id AS subjectId, fecha, estado, updated_at AS updatedAt
    FROM asistencias
    ${attendanceFilter.clause}
  `).all(attendanceFilter.params) as Array<{
    id: string;
    studentId: string;
    subjectId: string;
    fecha: string;
    estado: 'presente' | 'ausente';
    updatedAt: string;
  }>;

  const gradesFilter = tenantFilter(user, 'notas');
  const grades = db.prepare(`
    SELECT
      id,
      alumno_id AS studentId,
      materia_id AS subjectId,
      titulo,
      tipo_evaluacion AS tipoEvaluacion,
      valor,
      calificacion_texto AS calificacionTexto,
      peso,
      fecha,
      fecha_entrega AS fechaEntrega,
      updated_at AS updatedAt
    FROM notas
    ${gradesFilter.clause}
  `).all(gradesFilter.params) as Array<{
    id: string;
    studentId: string;
    subjectId: string;
    titulo: string;
    tipoEvaluacion: string | null;
    valor: number | null;
    calificacionTexto: string | null;
    peso: number;
    fecha: string;
    fechaEntrega: string | null;
    updatedAt: string;
  }>;

  return {
    courses,
    subjects: subjects.map((subject) => ({
      id: subject.id,
      nombre: subject.nombre,
      activo: subject.activo !== 0,
    })),
    students: students.map((student) => ({
      id: student.id,
      nombre: student.nombre,
      dni: student.dni || '',
      cursoId: student.cursoId,
      tutor: student.tutor || '',
      activo: student.activo !== 0,
      subjectIds: subjectLinks
        .filter((link) => link.alumno_id === student.id)
        .map((link) => link.materia_id),
    })),
    attendance,
    grades,
  };
}
