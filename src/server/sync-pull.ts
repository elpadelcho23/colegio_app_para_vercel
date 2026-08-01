import { db, type User } from './db';

/**
 * Filtro estricto por sesión: tenant siempre; docente_id cuando la tabla lo tiene.
 * Nunca confiar en IDs del cliente — solo `user` de la sesión autenticada.
 */
function tenantFilter(user: User, table: string) {
  if (user.rol === 'admin') {
    return { clause: `WHERE ${table}.tenant_id = @tenant_id`, params: { tenant_id: user.tenant_id } };
  }
  return {
    clause: `WHERE ${table}.tenant_id = @tenant_id AND ${table}.docente_id = @docente_id`,
    params: { tenant_id: user.tenant_id, docente_id: user.id },
  };
}

export async function pullClientData(user: User) {
  const { tenant_id: tenantId, id: docenteId } = user;
  const isAdmin = user.rol === 'admin';

  const courses = (await (isAdmin
    ? db.prepare(`
      SELECT id, escuela, nombre, turno, ciclo_lectivo AS cicloLectivo
      FROM cursos
      WHERE tenant_id = ?
    `)
    : db.prepare(`
      SELECT cursos.id, cursos.escuela, cursos.nombre, cursos.turno, cursos.ciclo_lectivo AS cicloLectivo
      FROM cursos
      JOIN docente_cursos
        ON docente_cursos.curso_id = cursos.id
       AND docente_cursos.tenant_id = cursos.tenant_id
      WHERE cursos.tenant_id = ?
        AND docente_cursos.docente_id = ?
    `)
  ).all(...(isAdmin ? [tenantId] : [tenantId, docenteId]))) as Array<{
    id: string;
    escuela: string;
    nombre: string;
    turno: string;
    cicloLectivo: number;
  }>;

  const schools = (await (isAdmin
    ? db.prepare(`
      SELECT id, nombre, activo
      FROM escuelas
      WHERE tenant_id = ?
    `)
    : db.prepare(`
      SELECT escuelas.id, escuelas.nombre, escuelas.activo
      FROM escuelas
      JOIN docente_escuelas
        ON docente_escuelas.escuela_id = escuelas.id
       AND docente_escuelas.tenant_id = escuelas.tenant_id
      WHERE escuelas.tenant_id = ?
        AND docente_escuelas.docente_id = ?
    `)
  ).all(...(isAdmin ? [tenantId] : [tenantId, docenteId]))) as Array<{
    id: string;
    nombre: string;
    activo: number;
  }>;

  const subjects = (await (isAdmin
    ? db.prepare(`
      SELECT id, nombre, activo
      FROM materias
      WHERE tenant_id = ?
    `)
    : db.prepare(`
      SELECT materias.id, materias.nombre, materias.activo
      FROM materias
      JOIN docente_materias
        ON docente_materias.materia_id = materias.id
       AND docente_materias.tenant_id = materias.tenant_id
      WHERE materias.tenant_id = ?
        AND docente_materias.docente_id = ?
    `)
  ).all(...(isAdmin ? [tenantId] : [tenantId, docenteId]))) as Array<{
    id: string;
    nombre: string;
    activo: number;
  }>;

  const students = (await (isAdmin
    ? db.prepare(`
      SELECT id, nombre, dni, curso_id AS cursoId, tutor, activo
      FROM alumnos
      WHERE tenant_id = ?
    `)
    : db.prepare(`
      SELECT alumnos.id, alumnos.nombre, alumnos.dni, alumnos.curso_id AS cursoId, alumnos.tutor, alumnos.activo
      FROM alumnos
      JOIN docente_cursos
        ON docente_cursos.curso_id = alumnos.curso_id
       AND docente_cursos.tenant_id = alumnos.tenant_id
      WHERE alumnos.tenant_id = ?
        AND docente_cursos.docente_id = ?
    `)
  ).all(...(isAdmin ? [tenantId] : [tenantId, docenteId]))) as Array<{
    id: string;
    nombre: string;
    dni: string | null;
    cursoId: string;
    tutor: string | null;
    activo: number;
  }>;

  // alumno_materias no tiene docente_id: acotar por cursos y materias del docente de la sesión.
  const subjectLinks = (await (isAdmin
    ? db.prepare(`
      SELECT alumno_id, materia_id
      FROM alumno_materias
      WHERE tenant_id = ?
    `).all(tenantId)
    : db.prepare(`
      SELECT DISTINCT am.alumno_id, am.materia_id
      FROM alumno_materias am
      INNER JOIN alumnos a
        ON a.id = am.alumno_id
       AND a.tenant_id = am.tenant_id
      INNER JOIN docente_cursos dc
        ON dc.curso_id = a.curso_id
       AND dc.tenant_id = am.tenant_id
       AND dc.docente_id = ?
      INNER JOIN docente_materias dm
        ON dm.materia_id = am.materia_id
       AND dm.tenant_id = am.tenant_id
       AND dm.docente_id = ?
      WHERE am.tenant_id = ?
    `).all(docenteId, docenteId, tenantId)
  )) as Array<{ alumno_id: string; materia_id: string }>;

  const attendanceFilter = tenantFilter(user, 'asistencias');
  const attendance = (await db.prepare(`
    SELECT id, alumno_id AS studentId, materia_id AS subjectId, fecha, estado, updated_at AS updatedAt
    FROM asistencias
    ${attendanceFilter.clause}
  `).all(attendanceFilter.params)) as Array<{
    id: string;
    studentId: string;
    subjectId: string;
    fecha: string;
    estado: 'presente' | 'ausente';
    updatedAt: string;
  }>;

  const gradesFilter = tenantFilter(user, 'notas');
  const grades = (await db.prepare(`
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
      periodo,
      motivo,
      updated_at AS updatedAt
    FROM notas
    ${gradesFilter.clause}
  `).all(gradesFilter.params)) as Array<{
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
    periodo: string | null;
    motivo: string | null;
    updatedAt: string;
  }>;

  const subjectByStudent = new Map<string, string[]>();
  for (const link of subjectLinks) {
    const list = subjectByStudent.get(link.alumno_id) || [];
    list.push(link.materia_id);
    subjectByStudent.set(link.alumno_id, list);
  }

  return {
    courses: courses.map((course) => {
      const ids = new Set<string>();
      for (const student of students) {
        if (student.cursoId !== course.id) continue;
        for (const materiaId of subjectByStudent.get(student.id) || []) ids.add(materiaId);
      }
      // Fallback: si el curso aún no tiene alumnos con materias, ofrecer las del docente.
      if (!ids.size) {
        for (const subject of subjects) ids.add(subject.id);
      }
      return {
        ...course,
        subjectIds: [...ids],
      };
    }),
    schools: schools.map((school) => ({
      id: school.id,
      nombre: school.nombre,
      activo: school.activo !== 0,
    })),
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
      subjectIds: subjectByStudent.get(student.id) || [],
    })),
    attendance,
    grades,
  };
}
