export function currentCalendarYear(date = new Date()) {
  return date.getFullYear();
}

export function parseCicloLectivoParam(value: string | null, fallback = currentCalendarYear()) {
  const ciclo = Number(value);
  return Number.isFinite(ciclo) && ciclo > 0 ? ciclo : fallback;
}

/** Restricts rows joined to cursos by the active academic year. */
export function cicloLectivoCourseFilter(cursosAlias = 'cursos') {
  return `AND ${cursosAlias}.ciclo_lectivo = @ciclo_lectivo`;
}

/** For optional course links: institutional events without curso remain visible. */
export function cicloLectivoOptionalCourseFilter(
  cursosAlias = 'cursos',
  baseAlias = 'base',
  courseIdColumn = 'curso_id',
) {
  return `AND (${baseAlias}.${courseIdColumn} IS NULL OR ${cursosAlias}.ciclo_lectivo = @ciclo_lectivo)`;
}
