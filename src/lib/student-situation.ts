/** Motor de situación académica por alumno (asistencia, notas, deuda de TPs). */

export const DEFAULT_ATTENDANCE_THRESHOLD = 75;
export const DEFAULT_GRADE_THRESHOLD = 6;

export type AttendanceRecord = {
  studentId: string;
  subjectId?: string;
  fecha: string;
  estado: string;
};

export type GradeRecord = {
  studentId: string;
  subjectId?: string;
  titulo?: string;
  valor?: number | string | null;
  calificacionTexto?: string;
  fecha?: string;
  periodo?: string;
  tipoEvaluacion?: string;
};

export type ActivityRecord = {
  id: string;
  titulo: string;
  tipo?: string;
  cursoId?: string;
  materiaId?: string;
  fechaPublicacion?: string | null;
  fechaVencimiento?: string | null;
};

export type DeliveryRecord = {
  id: string;
  alumnoId?: string | null;
  actividadId?: string | null;
  estado?: string;
};

export type StudentInput = {
  id: string;
  nombre: string;
  cursoId: string;
  dni?: string;
  tutor?: string;
  subjectIds?: string[];
  activo?: boolean;
};

export type CourseInput = {
  id: string;
  nombre: string;
  escuela?: string;
  turno?: string;
};

export type SubjectInput = {
  id: string;
  nombre: string;
};

export type SituationFilters = {
  escuela?: string;
  cursoId?: string;
  subjectId?: string;
  attendanceThreshold?: number;
  gradeThreshold?: number;
};

export type PendingWorkSuggestion = {
  activityId: string;
  titulo: string;
  tipo: string;
  fechaReferencia: string;
  reason: 'falta_en_fecha' | 'sin_entrega';
};

export type StudentSituation = {
  student: StudentInput;
  course: CourseInput | null;
  subjectId: string;
  subjectName: string;
  present: number;
  total: number;
  attendanceRate: number | null;
  acredita: boolean;
  status: 'libre' | 'riesgo' | 'atencion' | 'correcto';
  gradeAverage: number | null;
  recentGrades: Array<{ titulo: string; display: string; fecha: string }>;
  absentDates: string[];
  pendingWorks: PendingWorkSuggestion[];
};

function toNumberGrade(grade: GradeRecord): number | null {
  if (grade.valor === null || grade.valor === undefined || grade.valor === '') return null;
  const n = Number(grade.valor);
  return Number.isFinite(n) ? n : null;
}

function gradeDisplay(grade: GradeRecord): string {
  if (grade.calificacionTexto) return String(grade.calificacionTexto);
  const n = toNumberGrade(grade);
  return n === null ? '-' : n.toFixed(1);
}

function activityDate(activity: ActivityRecord): string {
  return String(activity.fechaVencimiento || activity.fechaPublicacion || '').slice(0, 10);
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Calcula situación por alumno+materia (o todas las materias del alumno si subjectId vacío → agrega asistencia).
 */
export function buildStudentSituations(input: {
  students: StudentInput[];
  courses: CourseInput[];
  subjects: SubjectInput[];
  attendance: AttendanceRecord[];
  grades: GradeRecord[];
  activities?: ActivityRecord[];
  deliveries?: DeliveryRecord[];
  filters?: SituationFilters;
}): StudentSituation[] {
  const filters = input.filters || {};
  const threshold = filters.attendanceThreshold ?? DEFAULT_ATTENDANCE_THRESHOLD;
  const gradeThreshold = filters.gradeThreshold ?? DEFAULT_GRADE_THRESHOLD;
  const courseMap = new Map(input.courses.map((course) => [course.id, course]));
  const subjectMap = new Map(input.subjects.map((subject) => [subject.id, subject]));
  const deliveriesByActivity = new Map<string, DeliveryRecord[]>();
  for (const delivery of input.deliveries || []) {
    if (!delivery.actividadId) continue;
    const list = deliveriesByActivity.get(delivery.actividadId) || [];
    list.push(delivery);
    deliveriesByActivity.set(delivery.actividadId, list);
  }

  let students = input.students.filter((student) => student.activo !== false);
  if (filters.cursoId) {
    students = students.filter((student) => student.cursoId === filters.cursoId);
  }
  if (filters.escuela) {
    students = students.filter((student) => courseMap.get(student.cursoId)?.escuela === filters.escuela);
  }

  const results: StudentSituation[] = [];

  for (const student of students) {
    const course = courseMap.get(student.cursoId) || null;
    const subjectIds = filters.subjectId
      ? [filters.subjectId]
      : [...new Set(
          input.attendance
            .filter((item) => item.studentId === student.id && item.subjectId)
            .map((item) => String(item.subjectId)),
        )];

    const targets = subjectIds.length
      ? subjectIds
      : (filters.subjectId ? [filters.subjectId] : ['']);

    for (const subjectId of targets) {
      const attendanceRows = input.attendance.filter((item) =>
        item.studentId === student.id && (!subjectId || item.subjectId === subjectId)
      );
      const present = attendanceRows.filter((item) => item.estado === 'presente').length;
      const total = attendanceRows.length;
      const attendanceRate = total ? (present / total) * 100 : null;
      const acredita = attendanceRate === null ? true : attendanceRate >= threshold;
      const absentDates = attendanceRows
        .filter((item) => item.estado === 'ausente')
        .map((item) => item.fecha)
        .sort();

      const studentGrades = input.grades.filter((grade) =>
        grade.studentId === student.id && (!subjectId || grade.subjectId === subjectId)
      );
      const numeric = studentGrades.map(toNumberGrade).filter((value): value is number => value !== null);
      const gradeAverage = average(numeric);
      const recentGrades = [...studentGrades]
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
        .slice(0, 5)
        .map((grade) => ({
          titulo: grade.titulo || grade.tipoEvaluacion || 'Evaluación',
          display: gradeDisplay(grade),
          fecha: grade.fecha || '',
        }));

      const courseActivities = (input.activities || []).filter((activity) => {
        if (activity.cursoId && activity.cursoId !== student.cursoId) return false;
        if (subjectId && activity.materiaId && activity.materiaId !== subjectId) return false;
        return true;
      });

      const pendingWorks: PendingWorkSuggestion[] = [];
      const hasDeliveryData = (input.deliveries || []).length > 0;
      const today = new Date().toISOString().slice(0, 10);

      for (const activity of courseActivities) {
        const refDate = activityDate(activity);
        const deliveries = deliveriesByActivity.get(activity.id) || [];
        const hasDelivery = deliveries.some((delivery) =>
          !delivery.alumnoId || delivery.alumnoId === student.id
        );
        const missedDuringAbsence = Boolean(refDate && absentDates.includes(refDate));

        if (missedDuringAbsence) {
          pendingWorks.push({
            activityId: activity.id,
            titulo: activity.titulo,
            tipo: activity.tipo || 'tp',
            fechaReferencia: refDate || '',
            reason: 'falta_en_fecha',
          });
          continue;
        }

        if (hasDeliveryData && !hasDelivery && refDate && refDate <= today) {
          pendingWorks.push({
            activityId: activity.id,
            titulo: activity.titulo,
            tipo: activity.tipo || 'tp',
            fechaReferencia: refDate,
            reason: 'sin_entrega',
          });
        }
      }
      let status: StudentSituation['status'] = 'correcto';
      if (!acredita) status = 'libre';
      else if (gradeAverage !== null && gradeAverage < gradeThreshold) status = 'riesgo';
      else if (pendingWorks.length) status = 'atencion';

      results.push({
        student,
        course,
        subjectId: subjectId || '',
        subjectName: subjectId ? (subjectMap.get(subjectId)?.nombre || 'Materia') : 'General',
        present,
        total,
        attendanceRate,
        acredita,
        status,
        gradeAverage,
        recentGrades,
        absentDates,
        pendingWorks: pendingWorks.slice(0, 8),
      });
    }
  }

  return results.sort((a, b) => {
    const order = { libre: 0, riesgo: 1, atencion: 2, correcto: 3 };
    const byStatus = order[a.status] - order[b.status];
    if (byStatus) return byStatus;
    return a.student.nombre.localeCompare(b.student.nombre, 'es');
  });
}

export function situationsNeedingFollowUp(situations: StudentSituation[]) {
  return situations.filter((item) => item.status === 'libre' || item.status === 'riesgo' || item.status === 'atencion');
}

export function buildAttendanceMatrix(input: {
  students: StudentInput[];
  attendance: AttendanceRecord[];
  courseId: string;
  subjectId: string;
  year: number;
  month: number; // 1-12
}) {
  const daysInMonth = new Date(input.year, input.month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return `${input.year}-${String(input.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });

  const students = input.students.filter((student) => student.cursoId === input.courseId && student.activo !== false);
  const rows = students.map((student) => {
    const byDate = new Map<string, string>();
    input.attendance
      .filter((item) =>
        item.studentId === student.id
        && item.subjectId === input.subjectId
        && item.fecha.startsWith(`${input.year}-${String(input.month).padStart(2, '0')}`)
      )
      .forEach((item) => byDate.set(item.fecha, item.estado));

    let present = 0;
    let total = 0;
    const cells = days.map((fecha) => {
      const estado = byDate.get(fecha) || '';
      if (estado) {
        total += 1;
        if (estado === 'presente') present += 1;
      }
      return estado;
    });
    const rate = total ? (present / total) * 100 : null;
    return { student, cells, present, total, rate };
  });

  return { days, rows };
}
