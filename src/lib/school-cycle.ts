/** Ciclo escolar anual: agrupa cursos por año lectivo y permite clonar estructura entre ciclos. */

export type CourseLike = {
  id: string;
  escuela: string;
  nombre: string;
  turno: string;
  cicloLectivo?: number;
  subjectIds?: string[];
  updatedAt?: string;
};

export type TeacherScheduleBlock = {
  id: string;
  dias: string[];
  desde: string;
  hasta: string;
  escuela: string;
  cursoId: string;
  materiaId: string;
  cicloLectivo?: number;
  updatedAt?: string;
};

export type CloneSchoolCycleOptions = {
  courses: CourseLike[];
  teacherContext: TeacherScheduleBlock[];
  sourceCiclo: number;
  targetCiclo: number;
  escuela?: string;
  includeSchedules?: boolean;
  createId: (prefix: string) => string;
  nowIso: () => string;
};

export type CloneSchoolCycleResult = {
  courses: CourseLike[];
  teacherContext: TeacherScheduleBlock[];
  courseIdMap: Record<string, string>;
  skipped: Array<{ escuela: string; nombre: string; turno: string; reason: string }>;
  summary: {
    coursesCreated: number;
    schedulesCreated: number;
    sourceCiclo: number;
    targetCiclo: number;
  };
};

export function currentCalendarYear(date = new Date()) {
  return date.getFullYear();
}

export function resolveCourseCiclo(course: CourseLike | null | undefined, fallbackYear = currentCalendarYear()) {
  const ciclo = Number(course?.cicloLectivo);
  return Number.isFinite(ciclo) && ciclo > 0 ? ciclo : fallbackYear;
}

export function courseIdentityKey(course: Pick<CourseLike, 'escuela' | 'nombre' | 'turno' | 'cicloLectivo'>) {
  const escuela = String(course.escuela || '').trim().toLowerCase();
  const nombre = String(course.nombre || '').trim().toLowerCase();
  const turno = String(course.turno || '').trim().toLowerCase();
  const ciclo = resolveCourseCiclo(course as CourseLike);
  return `${escuela}|${nombre}|${turno}|${ciclo}`;
}

export function listAvailableCycles(courses: CourseLike[], fallbackYear = currentCalendarYear()) {
  const cycles = new Set<number>();
  courses.forEach((course) => cycles.add(resolveCourseCiclo(course, fallbackYear)));
  cycles.add(fallbackYear);
  return [...cycles].sort((a, b) => b - a);
}

export function coursesInCiclo(
  courses: CourseLike[],
  cicloLectivo: number,
  escuela = '',
  fallbackYear = currentCalendarYear(),
) {
  const normalizedSchool = escuela.trim().toLowerCase();
  return courses.filter((course) => {
    if (resolveCourseCiclo(course, fallbackYear) !== cicloLectivo) return false;
    if (!normalizedSchool) return true;
    return String(course.escuela || '').trim().toLowerCase() === normalizedSchool;
  });
}

export function findCourseInCiclo(
  courses: CourseLike[],
  escuela: string,
  nombre: string,
  turno: string,
  cicloLectivo: number,
) {
  const key = courseIdentityKey({ escuela, nombre, turno, cicloLectivo });
  return courses.find((course) => courseIdentityKey(course) === key) || null;
}

export function deriveCourseSubjectIds(
  courseId: string,
  course: CourseLike | null | undefined,
  teacherContext: TeacherScheduleBlock[],
  sourceCiclo?: number,
) {
  const fromCourse = Array.isArray(course?.subjectIds) ? course.subjectIds.filter(Boolean) : [];
  if (fromCourse.length) return [...new Set(fromCourse)];

  const ciclo = sourceCiclo ?? resolveCourseCiclo(course || undefined);
  const fromSchedule = teacherContext
    .filter((block) => block.cursoId === courseId)
    .filter((block) => !block.cicloLectivo || resolveCourseCiclo({ cicloLectivo: block.cicloLectivo } as CourseLike) === ciclo)
    .map((block) => block.materiaId)
    .filter(Boolean);

  return [...new Set(fromSchedule)];
}

export function subjectsForCourseDisplay(
  course: CourseLike,
  allSubjectIds: string[],
  teacherContext: TeacherScheduleBlock[],
) {
  const ids = deriveCourseSubjectIds(course.id, course, teacherContext);
  if (ids.length) return ids;
  return allSubjectIds;
}

export function cloneSchoolCycle(options: CloneSchoolCycleOptions): CloneSchoolCycleResult {
  const {
    courses,
    teacherContext,
    sourceCiclo,
    targetCiclo,
    escuela = '',
    includeSchedules = true,
    createId,
    nowIso,
  } = options;

  if (!Number.isFinite(sourceCiclo) || !Number.isFinite(targetCiclo)) {
    throw new Error('Elegí ciclos lectivos válidos.');
  }
  if (sourceCiclo === targetCiclo) {
    throw new Error('El ciclo destino debe ser distinto al ciclo origen.');
  }

  const sourceCourses = coursesInCiclo(courses, sourceCiclo, escuela);
  const courseIdMap: Record<string, string> = {};
  const skipped: CloneSchoolCycleResult['skipped'] = [];
  const newCourses: CourseLike[] = [];
  const newSchedules: TeacherScheduleBlock[] = [];

  sourceCourses.forEach((source) => {
    const existing = findCourseInCiclo(courses, source.escuela, source.nombre, source.turno, targetCiclo);
    if (existing) {
      skipped.push({
        escuela: source.escuela,
        nombre: source.nombre,
        turno: source.turno,
        reason: 'Ya existe en el ciclo destino',
      });
      courseIdMap[source.id] = existing.id;
      return;
    }

    const subjectIds = deriveCourseSubjectIds(source.id, source, teacherContext, sourceCiclo);
    const cloned: CourseLike = {
      id: createId('curso'),
      escuela: source.escuela,
      nombre: source.nombre,
      turno: source.turno,
      cicloLectivo: targetCiclo,
      subjectIds,
      updatedAt: nowIso(),
    };
    courseIdMap[source.id] = cloned.id;
    newCourses.push(cloned);
  });

  if (includeSchedules) {
    teacherContext
      .filter((block) => {
        const mappedCourseId = courseIdMap[block.cursoId];
        if (!mappedCourseId) return false;
        const blockCiclo = block.cicloLectivo ?? sourceCiclo;
        if (blockCiclo !== sourceCiclo) return false;
        if (escuela && String(block.escuela || '').trim().toLowerCase() !== escuela.trim().toLowerCase()) {
          const sourceCourse = courses.find((course) => course.id === block.cursoId);
          if (sourceCourse && sourceCourse.escuela.trim().toLowerCase() !== escuela.trim().toLowerCase()) return false;
        }
        return true;
      })
      .forEach((block) => {
        const mappedCourseId = courseIdMap[block.cursoId];
        if (!mappedCourseId) return;
        const sourceCourse = courses.find((course) => course.id === block.cursoId);
        newSchedules.push({
          id: createId('ctx'),
          dias: [...(block.dias || [])],
          desde: block.desde,
          hasta: block.hasta,
          escuela: block.escuela || sourceCourse?.escuela || '',
          cursoId: mappedCourseId,
          materiaId: block.materiaId,
          cicloLectivo: targetCiclo,
          updatedAt: nowIso(),
        });
      });
  }

  return {
    courses: newCourses,
    teacherContext: newSchedules,
    courseIdMap,
    skipped,
    summary: {
      coursesCreated: newCourses.length,
      schedulesCreated: newSchedules.length,
      sourceCiclo,
      targetCiclo,
    },
  };
}

export function formatCicloLabel(ciclo: number) {
  return `Ciclo ${ciclo}`;
}
