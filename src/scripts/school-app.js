import { initOnboarding } from './onboarding-ui.js';
import { initProductTour } from './product-tour.js';
import { initGuestSession } from './guest-session.js';
import { initSyncUi } from './sync-ui.js';
import { initToolsView, navigateToToolsSection, initSimpleExcelImport } from './tools-ui.js';
import { countPendingOperations, getOperationStatusCounts, queueOfflineOperation, resetOfflineDatabaseOnce, saveAttendanceOffline } from './offline-db.ts';
import { hydrateLocalStorageFromServer, startAutoSync, syncPendingOperations } from './sync-client.ts';
import { initMobileNav, openMenu, closeMenu } from './ui-nav.js';
import { initSpaRouter, registerSpaViewRefresh, showSpaView } from './spa-router.ts';
import { initSchoolCycleUi } from './school-cycle-ui.js';
import {
  clearFieldErrors,
  focusFirstInvalid,
  setFieldError,
  showAppToast,
} from './app-feedback.js';
import { initTeacherFeatures } from './seguimiento-ui.js';
import { readTeacherPreferences } from '../lib/teacher-preferences.ts';
import {
  coursesInCiclo,
  currentCalendarYear,
  resolveCourseCiclo,
  subjectsForCourseDisplay,
} from '../lib/school-cycle.ts';
import {
  el,
  emptyState,
  fillSelectOptions,
  fillStaticSelectOptions,
  renderMetrics,
  renderPanelMetrics,
  renderTable,
  renderTags,
  replaceContent,
  setTrustedHtml,
  tag,
} from './dom-utils.js';

const currentUser = window.__AULA_CLARA_USER__ || null;
const panelRefreshers = [];
let appReady = false;
let toolsEntregasApi = { refresh: async () => {}, openForActividad: () => {}, setContext: () => {} };
let knownHasActivity = false;

function onPanelRefresh(fn) {
  panelRefreshers.push(fn);
}

function refreshAllPanels() {
  panelRefreshers.forEach((fn) => {
    try {
      fn();
    } catch (error) {
      console.error('[aula-clara] panel refresh failed', error);
    }
  });
}

function notifyDataChanged(detail = {}) {
  refreshAllPanels();
  window.dispatchEvent(new CustomEvent('aula-clara:local-data-changed', { detail }));
}

async function persistAndRefresh(entity, action, payload, refreshFn) {
  refreshFn?.();
  notifyDataChanged();
  try {
    await queue(entity, action, payload);
  } catch (error) {
    console.error('[aula-clara] sync queue failed', error);
  } finally {
    refreshFn?.();
    notifyDataChanged();
  }
}

const KEYS = {
  students: 'aula_clara_students',
  courses: 'aula_clara_courses',
  schools: 'aula_clara_schools',
  subjects: 'aula_clara_subjects',
  attendance: 'aula_clara_attendance',
  grades: 'aula_clara_grades',
  dashboardFilters: 'aula_clara_dashboard_filters',
  teacherContext: 'aula_clara_teacher_context',
  theme: 'aula_clara_theme',
};

const DEFAULTS = {
  [KEYS.courses]: [
    { id: 'curso-6-1-manana', nombre: '6to 1ra', escuela: 'Escuela Tecnica 1', turno: 'Manana', cicloLectivo: 2026, subjectIds: ['programacion', 'matematica'] },
    { id: 'curso-5-2-tarde', nombre: '5to 2da', escuela: 'Escuela Tecnica 1', turno: 'Tarde', cicloLectivo: 2026, subjectIds: ['literatura'] },
  ],
  [KEYS.schools]: [
    { id: 'escuela-tecnica-1', nombre: 'Escuela Tecnica 1', activo: true },
  ],
  [KEYS.subjects]: [
    { id: 'matematica', nombre: 'Matematica', activo: true },
    { id: 'programacion', nombre: 'Programacion', activo: true },
    { id: 'literatura', nombre: 'Literatura', activo: true },
  ],
  [KEYS.students]: [
    { id: 'al-1', nombre: 'Martina Ruiz', dni: '44111222', cursoId: 'curso-6-1-manana', tutor: 'Laura Ruiz', subjectIds: ['programacion', 'matematica'], activo: true },
    { id: 'al-2', nombre: 'Tomas Pereyra', dni: '45222333', cursoId: 'curso-6-1-manana', tutor: 'Ruben Pereyra', subjectIds: ['programacion', 'matematica'], activo: true },
    { id: 'al-3', nombre: 'Sofia Molina', dni: '46333444', cursoId: 'curso-5-2-tarde', tutor: 'Ana Molina', subjectIds: ['literatura'], activo: true },
  ],
  [KEYS.attendance]: [
    { id: 'asis-1', studentId: 'al-2', subjectId: 'programacion', fecha: '2026-03-10', estado: 'ausente', updatedAt: new Date().toISOString() },
    { id: 'asis-2', studentId: 'al-2', subjectId: 'programacion', fecha: '2026-03-12', estado: 'ausente', updatedAt: new Date().toISOString() },
    { id: 'asis-3', studentId: 'al-2', subjectId: 'programacion', fecha: '2026-03-14', estado: 'presente', updatedAt: new Date().toISOString() },
    { id: 'asis-4', studentId: 'al-2', subjectId: 'programacion', fecha: '2026-03-17', estado: 'ausente', updatedAt: new Date().toISOString() },
    { id: 'asis-5', studentId: 'al-1', subjectId: 'programacion', fecha: '2026-03-10', estado: 'presente', updatedAt: new Date().toISOString() },
    { id: 'asis-6', studentId: 'al-1', subjectId: 'programacion', fecha: '2026-03-12', estado: 'presente', updatedAt: new Date().toISOString() },
    { id: 'asis-7', studentId: 'al-1', subjectId: 'programacion', fecha: '2026-03-14', estado: 'presente', updatedAt: new Date().toISOString() },
    { id: 'asis-8', studentId: 'al-1', subjectId: 'programacion', fecha: '2026-03-17', estado: 'presente', updatedAt: new Date().toISOString() },
  ],
  [KEYS.grades]: [
    { id: 'nota-1', studentId: 'al-1', subjectId: 'programacion', titulo: 'TP HTML', tipoEvaluacion: 'TP', valor: 8, peso: 60, fecha: today(), fechaEntrega: '', updatedAt: new Date().toISOString() },
    { id: 'nota-2', studentId: 'al-2', subjectId: 'programacion', titulo: 'Integrador', tipoEvaluacion: 'Integrador', valor: 5, peso: 100, fecha: today(), fechaEntrega: '', updatedAt: new Date().toISOString() },
  ],
  [KEYS.teacherContext]: [],
};

function emptyValue(key) {
  return key === KEYS.dashboardFilters ? {} : [];
}

function read(key) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(key)) || 'null');
    if (stored !== null) return stored;
    if (currentUser?.id) return emptyValue(key);
    return DEFAULTS[key] ?? [];
  } catch {
    if (currentUser?.id) return emptyValue(key);
    return DEFAULTS[key] ?? [];
  }
}

function write(key, value) {
  localStorage.setItem(storageKey(key), JSON.stringify(value));
}

function seed() {
  Object.entries(DEFAULTS).forEach(([key, value]) => {
    if (localStorage.getItem(storageKey(key))) return;
    write(key, currentUser?.id ? emptyValue(key) : value);
  });
}

function storageKey(key) {
  return currentUser?.id ? `${key}:${currentUser.id}` : key;
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function urlContext() {
  return new URLSearchParams(window.location.search);
}

function applySelectFromUrl(select, paramName) {
  const value = urlContext().get(paramName);
  if (select && value) select.value = value;
}

function contextUrl(path, context = {}) {
  const params = new URLSearchParams();
  Object.entries(context).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function activeStudents() {
  return read(KEYS.students).filter((student) => student.activo !== false);
}

function activeSubjects() {
  return read(KEYS.subjects).filter((subject) => subject.activo !== false);
}

function activeCicloLectivo() {
  const filters = read(KEYS.dashboardFilters) || {};
  const ciclo = Number(filters.cicloLectivo);
  return Number.isFinite(ciclo) && ciclo > 0 ? ciclo : currentCalendarYear();
}

function visibleCourses(escuela = '') {
  return coursesInCiclo(read(KEYS.courses), activeCicloLectivo(), escuela);
}

function visibleCourseIds(escuela = '') {
  return new Set(visibleCourses(escuela).map((course) => course.id));
}

function studentsInCiclo(escuela = '', cursoId = '') {
  const allowed = visibleCourseIds(escuela);
  return activeStudents().filter((student) => {
    if (!allowed.has(student.cursoId)) return false;
    if (cursoId && student.cursoId !== cursoId) return false;
    return true;
  });
}

function courseSubjectsForDisplay(course) {
  const subjectIds = subjectsForCourseDisplay(
    course,
    activeSubjects().map((subject) => subject.id),
    read(KEYS.teacherContext),
  );
  const subjects = activeSubjects();
  return subjectIds.length
    ? subjects.filter((subject) => subjectIds.includes(subject.id))
    : subjects;
}

function activeSchools() {
  ensureSchoolsFromCourses();
  return read(KEYS.schools).filter((school) => school.activo !== false);
}

function ensureSchoolsFromCourses() {
  const schools = read(KEYS.schools);
  const existing = new Set(schools.map((school) => String(school.nombre || '').toLowerCase()));
  const fromCourses = [...new Set(read(KEYS.courses).map((course) => course.escuela).filter(Boolean))];
  const toAdd = fromCourses.filter((nombre) => !existing.has(nombre.toLowerCase()));
  if (!toAdd.length) return;
  write(KEYS.schools, [
    ...schools,
    ...toAdd.map((nombre) => ({ id: uid('esc'), nombre, activo: true, updatedAt: nowIso() })),
  ]);
}

function schoolNamesForSelect() {
  ensureSchoolsFromCourses();
  const names = new Set(visibleCourses().map((course) => course.escuela).filter(Boolean));
  activeSchools().forEach((school) => {
    const hasCourse = read(KEYS.courses).some((course) => course.escuela === school.nombre);
    if (!hasCourse) names.add(school.nombre);
  });
  return [...names].sort((a, b) => a.localeCompare(b, 'es'));
}

function fillSchoolSelect(select, placeholder, selected = '') {
  if (!select) return;
  fillSelect(select, schoolNamesForSelect().map((nombre) => ({ id: nombre, nombre })), placeholder);
  if (selected) select.value = selected;
}

async function upsertSchoolByName(name) {
  const schoolName = String(name || '').trim();
  if (!schoolName) return null;
  ensureSchoolsFromCourses();
  const existing = activeSchools().find((school) => school.nombre.toLowerCase() === schoolName.toLowerCase());
  const schoolPayload = existing || { id: uid('esc'), nombre: schoolName, activo: true, updatedAt: nowIso() };
  if (!existing) {
    write(KEYS.schools, [...read(KEYS.schools), schoolPayload]);
  }
  notifySchoolsChanged({ selected: schoolPayload.nombre });
  if (currentUser?.id) {
    void queue('school', 'upsert', schoolPayload);
  }
  return schoolPayload;
}

function notifySchoolsChanged(detail = {}) {
  window.dispatchEvent(new CustomEvent('aula-clara:schools-changed', { detail }));
  notifyDataChanged({ scope: 'schools', ...detail });
}

function renderSchoolTags(container) {
  if (!container) return;
  const schools = activeSchools();
  renderTags(container, schools, (school) => school.nombre, 'Sin escuelas cargadas');
}

function courseById(id) {
  return read(KEYS.courses).find((course) => course.id === id);
}

function subjectById(id) {
  return read(KEYS.subjects).find((subject) => subject.id === id);
}

function fillSelect(select, items, placeholder, valueKey = 'id', labeler = (item) => item.nombre) {
  fillSelectOptions(select, items, placeholder, valueKey, labeler);
}

function gradesForStudent(studentId, subjectId = '') {
  return read(KEYS.grades).filter((grade) =>
    grade.studentId === studentId && (!subjectId || grade.subjectId === subjectId)
  );
}

function average(grades) {
  const numericGrades = grades.filter((grade) => grade.valor !== null && grade.valor !== '' && Number.isFinite(Number(grade.valor)));
  if (!numericGrades.length) return null;
  const weight = numericGrades.reduce((sum, grade) => sum + Number(grade.peso || 100), 0);
  if (!weight) return numericGrades.reduce((sum, grade) => sum + Number(grade.valor), 0) / numericGrades.length;
  return numericGrades.reduce((sum, grade) => sum + Number(grade.valor) * Number(grade.peso || 100), 0) / weight;
}

function courseLabel(course) {
  if (!course) return 'Sin curso';
  const ciclo = resolveCourseCiclo(course);
  if (ciclo !== activeCicloLectivo()) {
    return `${course.nombre} - ${course.turno} (${ciclo})`;
  }
  return `${course.nombre} - ${course.turno}`;
}

function studentSubjectIds(student) {
  return Array.isArray(student.subjectIds) ? student.subjectIds : [];
}

function studentHasSubject(student, subjectId = '') {
  if (!subjectId) return true;
  const ids = studentSubjectIds(student);
  return ids.length === 0 || ids.includes(subjectId);
}

function subjectsForStudent(student) {
  const subjects = activeSubjects();
  const ids = studentSubjectIds(student);
  return ids.length ? subjects.filter((subject) => ids.includes(subject.id)) : subjects;
}

function importanceByType(type = '') {
  const normalized = String(type).toLowerCase();
  if (normalized.includes('integrador')) return 100;
  if (normalized.includes('evaluacion')) return 80;
  if (normalized.includes('oral')) return 60;
  return 60;
}

function importanceLabel(weight = 100) {
  const numeric = Number(weight || 100);
  if (numeric >= 90) return 'Alta';
  if (numeric >= 55) return 'Media';
  return 'Baja';
}

function gradeLabel(grade) {
  if (grade.calificacionTexto) return grade.calificacionTexto;
  if (grade.valor === null || grade.valor === '' || grade.valor === undefined) return '-';
  return Number(grade.valor).toFixed(1);
}

const ATTENDANCE_PASS_THRESHOLD = 75;
const GRADE_PASS_THRESHOLD = 6;

function attendancePassThreshold() {
  return readTeacherPreferences().attendanceThreshold || ATTENDANCE_PASS_THRESHOLD;
}

function studentById(id) {
  return read(KEYS.students).find((student) => student.id === id);
}

function inferGradePeriod(grade) {
  if (grade.periodo) return grade.periodo;
  const meta = `${grade.tipoEvaluacion || ''} ${grade.titulo || ''}`.toLowerCase();
  if (/recuperatorio|recup/.test(meta)) return 'recuperatorio';
  if (/previa/.test(meta)) return 'previa';
  if (grade.fecha) {
    const month = new Date(`${grade.fecha}T12:00:00`).getMonth() + 1;
    if (month >= 3 && month <= 6) return '1c';
    if (month >= 7 && month <= 11) return '2c';
  }
  return '1c';
}

function defaultGradePeriod() {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 6) return '1c';
  if (month >= 7 && month <= 11) return '2c';
  return '2c';
}

function periodLabel(period) {
  const labels = {
    '1c': '1er cuatrimestre',
    '2c': '2do cuatrimestre',
    anual: 'Anual',
    recuperatorio: 'Recuperatorio',
    previa: 'Previa',
  };
  return labels[period] || period;
}

function gradesForPeriod(grades, period) {
  return grades.filter((grade) => {
    const gradePeriod = inferGradePeriod(grade);
    if (period === 'anual') return gradePeriod === '1c' || gradePeriod === '2c' || gradePeriod === 'anual';
    return gradePeriod === period;
  });
}

function enrichAttendanceRecords(filters = {}) {
  const students = studentsInCiclo(filters.escuela || '');
  const studentMap = new Map(students.map((student) => [student.id, student]));
  let records = read(KEYS.attendance).map((item) => {
    const student = studentMap.get(item.studentId);
    if (!student) return null;
    const course = courseById(student.cursoId);
    const subject = subjectById(item.subjectId);
    return {
      ...item,
      student,
      course,
      subject,
      escuela: course?.escuela || '',
      cursoNombre: course?.nombre || '',
      cursoTurno: course?.turno || '',
      materiaNombre: subject?.nombre || '',
    };
  }).filter(Boolean);

  if (filters.escuela) records = records.filter((record) => record.escuela === filters.escuela);
  if (filters.curso) records = records.filter((record) => record.student.cursoId === filters.curso);
  if (filters.materia) records = records.filter((record) => record.subjectId === filters.materia);
  if (filters.desde) records = records.filter((record) => record.fecha >= filters.desde);
  if (filters.hasta) records = records.filter((record) => record.fecha <= filters.hasta);

  records.sort((a, b) => {
    const bySchool = a.escuela.localeCompare(b.escuela, 'es');
    if (bySchool) return bySchool;
    const byCourse = a.cursoNombre.localeCompare(b.cursoNombre, 'es');
    if (byCourse) return byCourse;
    const byDate = a.fecha.localeCompare(b.fecha);
    if (byDate) return byDate;
    return a.materiaNombre.localeCompare(b.materiaNombre, 'es');
  });

  return records;
}

function attendanceAveragesByStudent(filters = {}) {
  const records = enrichAttendanceRecords(filters);
  const groups = new Map();

  records.forEach((record) => {
    const key = `${record.studentId}:${record.subjectId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        student: record.student,
        subject: record.subject,
        course: record.course,
        present: 0,
        total: 0,
      });
    }
    const group = groups.get(key);
    group.total += 1;
    if (record.estado === 'presente') group.present += 1;
  });

  return [...groups.values()]
    .map((group) => {
      const rate = group.total ? (group.present / group.total) * 100 : null;
      return {
        ...group,
        rate,
        acredita: rate !== null && rate >= attendancePassThreshold(),
      };
    })
    .sort((a, b) => {
      const byStudent = a.student.nombre.localeCompare(b.student.nombre, 'es');
      if (byStudent) return byStudent;
      return (a.subject?.nombre || '').localeCompare(b.subject?.nombre || '', 'es');
    });
}

function renderAttendanceHistory(root) {
  const summary = root.querySelector('[data-attendance-history-summary]');
  const table = root.querySelector('[data-attendance-history-table]');
  const averages = root.querySelector('[data-attendance-history-averages]');
  if (!table) return;

  const filters = {
    escuela: root.querySelector('[data-history-filter-school]')?.value || '',
    curso: root.querySelector('[data-history-filter-course]')?.value || '',
    materia: root.querySelector('[data-history-filter-subject]')?.value || '',
    desde: root.querySelector('[data-history-filter-from]')?.value || '',
    hasta: root.querySelector('[data-history-filter-to]')?.value || '',
  };

  const records = enrichAttendanceRecords(filters);
  const studentAverages = attendanceAveragesByStudent(filters);
  const presentCount = records.filter((record) => record.estado === 'presente').length;
  const acreditados = studentAverages.filter((item) => item.acredita).length;

  if (summary) {
    renderMetrics(summary, [
      { value: records.length, label: 'Registros' },
      { value: presentCount, label: 'Presentes' },
      { value: studentAverages.length, label: 'Alumnos evaluados' },
      { value: acreditados, label: `Acreditan (≥${attendancePassThreshold()}%)` },
    ]);
  }

  renderTable(
    table,
    ['Colegio', 'Curso', 'Fecha', 'Materia', 'Alumno', 'Estado'],
    records.map((record) => [
      record.escuela || '-',
      `${record.cursoNombre} ${record.cursoTurno}`,
      record.fecha,
      record.materiaNombre || '-',
      el('strong', {}, record.student.nombre),
      tag(record.estado === 'presente' ? 'Presente' : 'Ausente', `tag ${record.estado === 'presente' ? 'ok' : 'danger'}`),
    ]),
    emptyState('Sin registros de asistencia', 'Tomá asistencia del curso de arriba.', {
      ctaLabel: 'Tomar asistencia',
      spaNav: 'asistencia',
    }),
  );

  if (averages) {
    renderTable(
      averages,
      ['Alumno', 'Curso', 'Materia', 'Presentes', 'Total', '% Asistencia', 'Acreditación'],
      studentAverages.map((item) => [
        el('strong', {}, item.student.nombre),
        `${item.course?.nombre || '-'} ${item.course?.turno || ''}`,
        item.subject?.nombre || '-',
        item.present,
        item.total,
        item.rate === null ? '-' : `${item.rate.toFixed(0)}%`,
        tag(item.acredita ? 'Acredita' : 'No acredita', `tag ${item.acredita ? 'ok' : 'danger'}`),
      ]),
      emptyState('Sin promedios calculables', 'Seleccioná otro filtro o tomá asistencia para ver promedios.'),
    );
  }
}

function renderGradesDetail(root) {
  const summary = root.querySelector('[data-grades-detail-summary]');
  const table = root.querySelector('[data-grades-detail-table]');
  const averages = root.querySelector('[data-grades-detail-averages]');
  if (!table) return;

  const courseId = root.querySelector('[data-detail-course-filter]')?.value || '';
  const subjectId = root.querySelector('[data-detail-subject-filter]')?.value || '';
  const period = root.querySelector('[data-detail-period-filter]')?.value || 'anual';

  const students = studentsInCiclo('', courseId).filter((student) =>
    studentHasSubject(student, subjectId)
  );

  const rows = [];
  students.forEach((student) => {
    const grades = gradesForPeriod(gradesForStudent(student.id, subjectId), period);
    grades.forEach((grade) => {
      rows.push({ student, grade, course: courseById(student.cursoId) });
    });
  });

  rows.sort((a, b) => {
    const byStudent = a.student.nombre.localeCompare(b.student.nombre, 'es');
    if (byStudent) return byStudent;
    return String(b.grade.fecha || '').localeCompare(String(a.grade.fecha || ''));
  });

  const averageRows = students.map((student) => {
    const grades = gradesForPeriod(gradesForStudent(student.id, subjectId), period);
    const avg = average(grades);
    return {
      student,
      course: courseById(student.cursoId),
      subject: subjectById(subjectId),
      grades,
      avg,
      aprueba: avg !== null && avg >= GRADE_PASS_THRESHOLD,
    };
  }).filter((item) => item.grades.length > 0);

  const aprobados = averageRows.filter((item) => item.aprueba).length;

  if (summary) {
    renderMetrics(summary, [
      { value: periodLabel(period), label: 'Período' },
      { value: rows.length, label: 'Calificaciones' },
      { value: averageRows.length, label: 'Alumnos evaluados' },
      { value: aprobados, label: `Aprobados (≥${GRADE_PASS_THRESHOLD})` },
    ]);
  }

  renderTable(
    table,
    ['Alumno', 'Curso', 'Actividad', 'Tipo', 'Fecha', 'Nota', 'Motivo', 'Período'],
    rows.map(({ student, grade, course }) => [
      el('strong', {}, student.nombre),
      `${course?.nombre || '-'} ${course?.turno || ''}`,
      grade.titulo,
      grade.tipoEvaluacion || 'Eval.',
      grade.fecha || '-',
      gradeLabel(grade),
      grade.motivo || '-',
      periodLabel(inferGradePeriod(grade)),
    ]),
    emptyState('Sin calificaciones en este período', 'Cargá notas o cambiá el filtro de período.'),
  );

  if (averages) {
    renderTable(
      averages,
      ['Alumno', 'Curso', 'Materia', 'Evaluaciones', 'Promedio', 'Estado'],
      averageRows.map((item) => [
        el('strong', {}, item.student.nombre),
        `${item.course?.nombre || '-'} ${item.course?.turno || ''}`,
        item.subject?.nombre || '-',
        item.grades.length,
        item.avg === null ? '-' : item.avg.toFixed(1),
        tag(item.aprueba ? 'Aprueba' : 'No aprueba', `tag ${item.aprueba ? 'ok' : 'danger'}`),
      ]),
      emptyState('Sin promedios calculables', 'No hay calificaciones numéricas en el período seleccionado.'),
    );
  }
}

function weekdayLabel(day) {
  return ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'][Number(day)] || '';
}

function currentSuggestedContext() {
  const now = new Date();
  const todayDay = String(now.getDay());
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parseTime = (value) => {
    const [hours, mins] = String(value || '').split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(mins) ? hours * 60 + mins : null;
  };

  return read(KEYS.teacherContext).find((item) => {
    const itemCiclo = item.cicloLectivo ?? resolveCourseCiclo(courseById(item.cursoId));
    if (itemCiclo !== activeCicloLectivo()) return false;
    const start = parseTime(item.desde);
    const end = parseTime(item.hasta);
    const days = Array.isArray(item.dias) ? item.dias.map(String) : [];
    return days.includes(todayDay) && start !== null && end !== null && minutes >= start && minutes <= end;
  }) || null;
}

function getTeachingContext() {
  const filters = read(KEYS.dashboardFilters) || {};
  const course = courseById(filters.curso);
  return {
    escuela: filters.escuela || course?.escuela || '',
    turno: course?.turno || '',
    cursoId: filters.curso || '',
    materiaId: filters.materia || '',
    course,
    subject: subjectById(filters.materia),
  };
}

function describeTeachingContext(ctx = getTeachingContext()) {
  if (!ctx.cursoId && !ctx.materiaId) return 'Elegí curso y materia';
  const course = ctx.course || courseById(ctx.cursoId);
  const subject = ctx.subject || subjectById(ctx.materiaId);
  return [ctx.escuela || course?.escuela, course?.nombre, subject?.nombre].filter(Boolean).join(' · ') || 'Elegí curso y materia';
}

function teachingContextIsReady(ctx = getTeachingContext()) {
  return Boolean(ctx.cursoId && ctx.materiaId);
}

function openTeachingContextPicker() {
  const root = document.querySelector('[data-global-teaching-context]');
  const form = root?.querySelector('[data-gtc-form]');
  if (!root || !form) return;
  form.classList.remove('is-hidden');
  form.hidden = false;
  refreshGlobalTeachingContextUi({ keepOpen: true });
  root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  root.querySelector('[data-gtc-course]')?.focus?.();
}

function syncContextGateBanners() {
  const ready = teachingContextIsReady();
  const gtc = document.querySelector('[data-global-teaching-context]');
  gtc?.classList.toggle('gtc--needs-context', !ready);

  const gtcGate = document.querySelector('[data-gtc-gate]');
  if (gtcGate) {
    gtcGate.classList.toggle('is-hidden', ready);
    gtcGate.hidden = ready;
  }

  const hint = document.querySelector('[data-gtc-hint]');
  if (hint) {
    hint.classList.toggle('is-hidden', !ready);
    hint.hidden = !ready;
  }

  document.querySelectorAll('[data-context-gate]').forEach((gate) => {
    if (gate.hasAttribute('data-gtc-gate')) return;
    gate.classList.toggle('is-hidden', ready);
    gate.hidden = ready;
  });
}

function setTeachingContext({ escuela, cursoId, materiaId } = {}, { notify = true, keepOpen = false } = {}) {
  const course = courseById(cursoId);
  const next = {
    ...(read(KEYS.dashboardFilters) || {}),
    escuela: escuela || course?.escuela || '',
    curso: cursoId || '',
    materia: materiaId || '',
    cicloLectivo: activeCicloLectivo(),
  };
  write(KEYS.dashboardFilters, next);
  refreshGlobalTeachingContextUi({ keepOpen });
  if (notify) {
    window.dispatchEvent(new CustomEvent('aula-clara:teaching-context-changed', { detail: getTeachingContext() }));
  }
  return getTeachingContext();
}

function applyTeachingContextTo(selects = {}) {
  const ctx = getTeachingContext();
  if (selects.school && ctx.escuela) selects.school.value = ctx.escuela;
  if (selects.course && ctx.cursoId) selects.course.value = ctx.cursoId;
  if (selects.subject && ctx.materiaId) selects.subject.value = ctx.materiaId;
  if (selects.shift && ctx.turno) selects.shift.value = ctx.turno;
  return ctx;
}

function refreshGlobalTeachingContextUi({ keepOpen = false } = {}) {
  const root = document.querySelector('[data-global-teaching-context]');
  if (!root) return;
  const summary = root.querySelector('[data-gtc-summary]');
  const form = root.querySelector('[data-gtc-form]');
  const schoolSelect = root.querySelector('[data-gtc-school]');
  const courseSelect = root.querySelector('[data-gtc-course]');
  const subjectSelect = root.querySelector('[data-gtc-subject]');
  const ctx = getTeachingContext();
  const ready = teachingContextIsReady(ctx);

  if (summary) {
    summary.textContent = ready
      ? describeTeachingContext(ctx)
      : (ctx.cursoId ? 'Falta elegir la materia' : 'Elegí curso y materia');
  }

  const schools = schoolNamesForSelect();
  if (schoolSelect) {
    fillSelect(schoolSelect, schools.map((school) => ({ id: school, nombre: school })), 'Escuela');
    schoolSelect.value = ctx.escuela || '';
  }
  if (courseSelect) {
    fillSelect(courseSelect, visibleCourses(schoolSelect?.value || ''), 'Curso', 'id', courseLabel);
    courseSelect.value = ctx.cursoId || '';
  }
  if (subjectSelect) {
    fillSelect(subjectSelect, activeSubjects(), 'Materia');
    subjectSelect.value = ctx.materiaId || '';
  }

  if (!keepOpen && form) {
    form.classList.add('is-hidden');
    form.hidden = true;
  }

  document.querySelectorAll('[data-activity-context-hint]').forEach((hint) => {
    hint.textContent = ready
      ? `Trabajando en: ${describeTeachingContext(ctx)}`
      : 'Elegí curso y materia en “Curso actual” arriba para continuar.';
    hint.classList.toggle('activity-context-hint--warn', !ready);
  });

  document.querySelectorAll('[data-grade-context-text]').forEach((node) => {
    node.textContent = ready
      ? describeTeachingContext(ctx)
      : 'Elegí curso y materia en Curso actual (encabezado).';
  });

  syncContextGateBanners();
  refreshScheduleSuggestion();
}

function initGlobalTeachingContext() {
  const root = document.querySelector('[data-global-teaching-context]');
  if (!root) return;

  const form = root.querySelector('[data-gtc-form]');
  const toggle = root.querySelector('[data-gtc-toggle]');
  const schoolSelect = root.querySelector('[data-gtc-school]');
  const courseSelect = root.querySelector('[data-gtc-course]');

  const ensureDefaults = () => {
    const ctx = getTeachingContext();
    if (ctx.cursoId) return;
    const suggested = currentSuggestedContext();
    if (suggested?.cursoId) {
      setTeachingContext({
        escuela: suggested.escuela,
        cursoId: suggested.cursoId,
        materiaId: suggested.materiaId,
      }, { notify: false });
      return;
    }
    const firstCourse = visibleCourses()[0];
    if (firstCourse) {
      const subjects = courseSubjectsForDisplay(firstCourse);
      setTeachingContext({
        escuela: firstCourse.escuela,
        cursoId: firstCourse.id,
        materiaId: subjects[0]?.id || activeSubjects()[0]?.id || '',
      }, { notify: false });
    }
  };

  ensureDefaults();
  refreshGlobalTeachingContextUi();

  toggle?.addEventListener('click', () => {
    if (!form) return;
    const open = form.classList.contains('is-hidden');
    form.classList.toggle('is-hidden', !open);
    form.hidden = !open;
    if (open) refreshGlobalTeachingContextUi({ keepOpen: true });
  });

  document.addEventListener('click', (event) => {
    const trigger = event.target?.closest?.('[data-gtc-open]');
    if (!trigger) return;
    openTeachingContextPicker();
  });

  schoolSelect?.addEventListener('change', () => {
    fillSelect(courseSelect, visibleCourses(schoolSelect.value || ''), 'Curso', 'id', courseLabel);
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.curso || !data.materia) {
      showAppToast('Elegí curso y materia.', 'warning');
      return;
    }
    setTeachingContext({
      escuela: data.escuela,
      cursoId: data.curso,
      materiaId: data.materia,
    });
    showAppToast('Curso actual actualizado.', 'ok');
  });

  window.addEventListener('aula-clara:ciclo-changed', () => {
    ensureDefaults();
    refreshGlobalTeachingContextUi();
  });
  window.addEventListener('aula-clara:schools-changed', () => {
    refreshGlobalTeachingContextUi();
  });
  onPanelRefresh(() => refreshGlobalTeachingContextUi());
}

function applySuggestedContextTo(selects = {}, options = {}) {
  const hasUrlContext = ['curso', 'materia'].some((param) => urlContext().has(param));
  const shouldApply = options.force || !hasUrlContext;
  if (!shouldApply) return currentSuggestedContext();

  const teaching = getTeachingContext();
  if (teaching.cursoId || teaching.materiaId) {
    if (selects.school && teaching.escuela) selects.school.value = teaching.escuela;
    if (selects.course && teaching.cursoId) selects.course.value = teaching.cursoId;
    if (selects.subject && teaching.materiaId) selects.subject.value = teaching.materiaId;
    if (selects.shift && teaching.turno) selects.shift.value = teaching.turno;
    return teaching;
  }

  const context = currentSuggestedContext();
  if (!context) return null;
  if (selects.school && !selects.school.value && context.escuela) selects.school.value = context.escuela;
  if (selects.course && !selects.course.value && context.cursoId) selects.course.value = context.cursoId;
  if (selects.subject && !selects.subject.value && context.materiaId) selects.subject.value = context.materiaId;
  return context;
}

function describeContext(context) {
  if (!context) return 'Sin sugerencia de horario ahora.';
  const course = courseById(context.cursoId);
  const subject = subjectById(context.materiaId);
  return [course?.nombre || 'Curso', subject?.nombre || 'Materia', context.desde && context.hasta ? `${context.desde}–${context.hasta}` : '']
    .filter(Boolean)
    .join(' · ');
}

function refreshScheduleSuggestion() {
  const box = document.querySelector('[data-schedule-suggestion]');
  const label = document.querySelector('[data-schedule-suggestion-label]');
  if (!box) return;

  const suggested = currentSuggestedContext();
  const current = getTeachingContext();
  const matchesCurrent = Boolean(
    suggested
    && suggested.cursoId === current.cursoId
    && suggested.materiaId === current.materiaId,
  );
  const show = Boolean(suggested && !matchesCurrent);

  if (label) label.textContent = describeContext(suggested);
  box.classList.toggle('is-hidden', !show);
  box.hidden = !show;
}

function initScheduleSuggestion() {
  document.querySelector('[data-schedule-suggestion-apply]')?.addEventListener('click', () => {
    const suggested = currentSuggestedContext();
    if (!suggested?.cursoId) {
      showAppToast('No hay sugerencia de horario para este momento.', 'warning');
      return;
    }
    setTeachingContext({
      escuela: suggested.escuela,
      cursoId: suggested.cursoId,
      materiaId: suggested.materiaId,
    });
    showAppToast('Curso actual actualizado según tu horario.', 'ok');
    refreshScheduleSuggestion();
  });

  window.addEventListener('aula-clara:teaching-context-changed', refreshScheduleSuggestion);
  onPanelRefresh(refreshScheduleSuggestion);
  refreshScheduleSuggestion();
}

function attendanceRate(studentId, subjectId = '') {
  const items = read(KEYS.attendance).filter((item) =>
    item.studentId === studentId && (!subjectId || item.subjectId === subjectId)
  );
  if (!items.length) return null;
  const present = items.filter((item) => item.estado === 'presente').length;
  return (present / items.length) * 100;
}

function queue(entity, action, payload) {
  if (!currentUser?.id) {
    window.location.href = '/login';
    return Promise.resolve(null);
  }
  return queueOfflineOperation({ entity, action, payload: { ...payload, docenteId: currentUser.id, updatedAt: payload.updatedAt || nowIso() } });
}

function initTheme() {
  const saved = localStorage.getItem(KEYS.theme) || 'light';
  document.documentElement.dataset.theme = saved;
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.textContent = saved === 'dark' ? 'Modo claro' : 'Modo oscuro';
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem(KEYS.theme, next);
      document.querySelectorAll('[data-theme-toggle]').forEach((item) => {
        item.textContent = next === 'dark' ? 'Modo claro' : 'Modo oscuro';
      });
    });
  });
}

// Mobile nav handled in ui-nav.js

function enhanceResponsiveTables(root = document) {
  const nestedTables = root.querySelectorAll ? [...root.querySelectorAll('.table-wrap table')] : [];
  const tables = [
    ...(root.matches?.('.table-wrap table') ? [root] : []),
    ...nestedTables,
  ];

  tables.forEach((table) => {
    const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
    if (!headers.length) return;

    table.querySelectorAll('tbody tr').forEach((row) => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName.toLowerCase() !== 'td') return;
        if (headers[index]) cell.setAttribute('data-label', headers[index]);
      });
    });
  });
}

function initResponsiveTables() {
  enhanceResponsiveTables();

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceResponsiveTables(node);
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function updatePanelTodayTitle() {
  const title = document.querySelector('[data-panel-today-title]');
  if (!title) return;
  const ctx = getTeachingContext();
  title.textContent = ctx.cursoId
    ? `Hoy: ${describeTeachingContext(ctx)}`
    : 'Hoy: elegí curso arriba';
}

function initDashboard() {
  const root = document.querySelector('[data-dashboard]');
  if (!root) return;

  updatePanelTodayTitle();
  renderDashboard(root);

  window.addEventListener('aula-clara:teaching-context-changed', () => {
    updatePanelTodayTitle();
    renderDashboard(root);
  });
  window.addEventListener('aula-clara:ciclo-changed', () => {
    updatePanelTodayTitle();
    renderDashboard(root);
  });
  onPanelRefresh(() => {
    updatePanelTodayTitle();
    renderDashboard(root);
  });
}

function renderDashboard(root) {
  const filters = read(KEYS.dashboardFilters) || {};
  const courses = visibleCourses(filters.escuela).filter((course) =>
    (!filters.curso || course.id === filters.curso)
  );
  const students = studentsInCiclo(filters.escuela, filters.curso || '');
  const studentIds = new Set(students.map((student) => student.id));
  const attendance = read(KEYS.attendance).filter((item) =>
    studentIds.has(item.studentId) && (!filters.materia || item.subjectId === filters.materia)
  );
  const grades = read(KEYS.grades).filter((grade) =>
    studentIds.has(grade.studentId) && (!filters.materia || grade.subjectId === filters.materia)
  );
  const avg = average(grades);
  const present = attendance.length ? (attendance.filter((item) => item.estado === 'presente').length / attendance.length) * 100 : null;
  const risk = students.filter((student) => {
    const studentAverage = average(gradesForStudent(student.id, filters.materia));
    const studentAttendance = attendanceRate(student.id, filters.materia);
    return (studentAverage !== null && studentAverage < 6) || (studentAttendance !== null && studentAttendance < attendancePassThreshold());
  }).length;

  renderMetrics(root, [
    { value: students.length, label: 'Alumnos' },
    { value: courses.length, label: 'Cursos' },
    { value: avg === null ? '-' : avg.toFixed(1), label: 'Promedio' },
    { value: present === null ? '-' : `${present.toFixed(0)}%`, label: 'Asistencia' },
  ]);

  const alerts = document.querySelector('[data-alerts]');
  if (alerts) {
    replaceContent(alerts, risk === 0
      ? emptyState('Sin alertas en este contexto', 'El filtro actual no muestra riesgo académico o de asistencia.')
      : emptyState(`${risk} alumnos requieren seguimiento`, 'El cálculo respeta escuela, curso y materia seleccionados.'));
  }
}

function initTeacherContext() {
  const root = document.querySelector('[data-teacher-context]');
  if (!root) return;

  const form = root.querySelector('[data-context-form]');
  const list = root.querySelector('[data-context-list]');
  const schoolSelect = form.escuela;
  const courseSelect = form.cursoId;
  const subjectSelect = form.materiaId;
  const schools = schoolNamesForSelect();

  fillSelect(schoolSelect, schools.map((school) => ({ id: school, nombre: school })), 'Escuela');
  fillSelect(courseSelect, visibleCourses(), 'Curso', 'id', courseLabel);
  fillSelect(subjectSelect, activeSubjects(), 'Materia');

  window.addEventListener('aula-clara:schools-changed', (event) => {
    fillSchoolSelect(schoolSelect, 'Escuela', event.detail?.selected || schoolSelect?.value || '');
    fillSelect(courseSelect, visibleCourses(schoolSelect?.value || ''), 'Curso', 'id', courseLabel);
  });

  schoolSelect?.addEventListener('change', () => {
    fillSelect(courseSelect, visibleCourses(schoolSelect.value || ''), 'Curso', 'id', courseLabel);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const data = new FormData(form);
    const dias = data.getAll('dias').map(String);
    if (!dias.length) {
      const daysError = form.querySelector('[data-context-days-error]');
      if (daysError) {
        daysError.hidden = false;
        daysError.textContent = 'Elegí al menos un día.';
      }
      form.querySelector('.day-picker')?.classList.add('is-invalid');
      showAppToast('Elegí al menos un día.', 'warning');
      return;
    }

    const item = {
      id: uid('ctx'),
      dias,
      desde: String(data.get('desde') || ''),
      hasta: String(data.get('hasta') || ''),
      escuela: String(data.get('escuela') || ''),
      cursoId: String(data.get('cursoId') || ''),
      materiaId: String(data.get('materiaId') || ''),
      cicloLectivo: activeCicloLectivo(),
      updatedAt: nowIso(),
    };
    write(KEYS.teacherContext, [...read(KEYS.teacherContext), item]);
    form.reset();
    renderTeacherContextList(list);
    refreshScheduleSuggestion();
    showAppToast('Bloque de horario guardado. Se usará solo como sugerencia.', 'ok');
  });

  list.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-delete-context]');
    if (!remove) return;
    const blockId = remove.dataset.deleteContext;
    const previous = read(KEYS.teacherContext).find((item) => item.id === blockId);
    if (!previous) return;
    write(KEYS.teacherContext, read(KEYS.teacherContext).filter((item) => item.id !== blockId));
    renderTeacherContextList(list);
    refreshScheduleSuggestion();
    showAppToast('Bloque de horario eliminado.', 'ok', {
      actionLabel: 'Deshacer',
      onAction: () => {
        write(KEYS.teacherContext, [...read(KEYS.teacherContext), previous]);
        renderTeacherContextList(list);
        refreshScheduleSuggestion();
        showAppToast('Bloque restaurado.', 'ok');
      },
    });
  });

  renderTeacherContextList(list);
  onPanelRefresh(() => {
    fillSelect(schoolSelect, schoolNamesForSelect().map((school) => ({ id: school, nombre: school })), 'Escuela');
    fillSelect(courseSelect, visibleCourses(), 'Curso', 'id', courseLabel);
    fillSelect(subjectSelect, activeSubjects(), 'Materia');
    renderTeacherContextList(list);
    refreshScheduleSuggestion();
  });
}

function renderTeacherContextList(list) {
  const items = read(KEYS.teacherContext).filter((item) => {
    const itemCiclo = item.cicloLectivo ?? resolveCourseCiclo(courseById(item.cursoId));
    return itemCiclo === activeCicloLectivo();
  });
  if (!items.length) {
    replaceContent(list, emptyState('Sin bloques', 'Opcional: agregá horarios para sugerir el curso del día.', {
      ctaLabel: 'Ir al Panel',
      spaNav: 'panel',
    }));
    return;
  }

  replaceContent(list, ...items.map((item) => {
    const course = courseById(item.cursoId);
    const subject = subjectById(item.materiaId);
    return el('article', { className: 'course-row' },
      el('div', {},
        el('strong', {}, subject?.nombre || 'Materia'),
        el('small', {}, `${item.dias.map(weekdayLabel).join(', ')} - ${item.desde} a ${item.hasta} - ${course?.nombre || 'Curso'} - ${item.escuela || course?.escuela || ''}`),
      ),
      el('div', { className: 'row-actions' },
        el('button', { className: 'btn btn-ghost', dataset: { deleteContext: item.id } }, 'Quitar'),
      ),
    );
  }));
}

async function upsertSubjectByName(name) {
  const newSubjectName = String(name || '').trim();
  if (!newSubjectName) return null;
  const existing = activeSubjects().find((subject) => subject.nombre.toLowerCase() === newSubjectName.toLowerCase());
  const subjectPayload = existing || { id: uid('mat'), nombre: newSubjectName, activo: true, updatedAt: nowIso() };
  if (!existing) {
    write(KEYS.subjects, [...read(KEYS.subjects), subjectPayload]);
    notifyDataChanged({ scope: 'subjects' });
    try {
      await queue('subject', 'upsert', subjectPayload);
    } catch (error) {
      console.error('[aula-clara] subject sync failed', error);
    }
  }
  return subjectPayload;
}

function initStudents() {
  const root = document.querySelector('[data-students]');
  const form = root?.querySelector('[data-student-form]');
  const list = root?.querySelector('[data-student-list]');
  const schoolSelect = form?.querySelector('[name="escuela"]');
  const courseSelect = form?.querySelector('[name="cursoId"]');
  const subjectContainer = document.querySelector('[data-student-subjects]');
  const newSubjectInput = form?.querySelector('[data-student-new-subject]');
  const addSubjectButton = form?.querySelector('[data-student-add-subject]');
  const profileDialog = root?.querySelector('[data-student-profile-dialog]');
  const profileForm = profileDialog?.querySelector('[data-student-profile-form]');
  const profileTitle = profileDialog?.querySelector('[data-student-profile-title]');
  const profileSchoolSelect = profileForm?.querySelector('[name="escuela"]');
  const profileCourseSelect = profileForm?.querySelector('[name="cursoId"]');
  const profileSubjectContainer = profileForm?.querySelector('[data-student-profile-subjects]');
  const profileNewSubjectInput = profileForm?.querySelector('[data-student-profile-new-subject]');
  const profileAddSubjectButton = profileForm?.querySelector('[data-student-profile-add-subject]');
  const profileCloseButton = profileDialog?.querySelector('[data-student-profile-close]');
  if (!form || !list) return;

  const modeInputs = root.querySelectorAll('[data-student-mode-input]');
  const modePanels = root.querySelectorAll('[data-student-mode-panel]');

  const setStudentMode = (mode) => {
    const value = mode === 'excel' ? 'excel' : 'manual';
    modeInputs.forEach((input) => {
      input.checked = input.value === value;
    });
    modePanels.forEach((panel) => {
      panel.classList.toggle('is-hidden', panel.getAttribute('data-student-mode-panel') !== value);
    });
  };

  const refreshCourseOptions = (school = '', selectedCourseId = '') => {
    const courses = visibleCourses(school);
    const previousValue = selectedCourseId || courseSelect?.value || '';
    fillSelect(courseSelect, courses, school ? 'Seleccionar curso' : 'Elegí una escuela primero', 'id', courseLabel);
    if (previousValue && courses.some((course) => course.id === previousValue)) {
      courseSelect.value = previousValue;
    } else if (courses.length === 1) {
      courseSelect.value = courses[0].id;
    }
    if (courseSelect) courseSelect.disabled = !school || courses.length === 0;
  };

  const refreshSchoolOptions = (selectedSchool = '', selectedCourseId = '') => {
    fillSchoolSelect(schoolSelect, 'Seleccionar escuela', selectedSchool);
    refreshCourseOptions(schoolSelect?.value || '', selectedCourseId);
  };

  const refreshProfileCourseOptions = (school = '', selectedCourseId = '') => {
    if (!profileCourseSelect) return;
    const courses = visibleCourses(school);
    const previousValue = selectedCourseId || profileCourseSelect.value || '';
    fillSelect(profileCourseSelect, courses, school ? 'Seleccionar curso' : 'Elegí una escuela primero', 'id', courseLabel);
    if (previousValue && courses.some((course) => course.id === previousValue)) {
      profileCourseSelect.value = previousValue;
    } else if (courses.length === 1) {
      profileCourseSelect.value = courses[0].id;
    }
    profileCourseSelect.disabled = !school || courses.length === 0;
  };

  const refreshProfileSchoolOptions = (selectedSchool = '', selectedCourseId = '') => {
    if (!profileSchoolSelect) return;
    fillSchoolSelect(profileSchoolSelect, 'Seleccionar escuela', selectedSchool);
    refreshProfileCourseOptions(profileSchoolSelect.value || '', selectedCourseId);
  };

  const refreshStudentPanel = () => {
    refreshSchoolOptions();
    renderStudentSubjectPicker(subjectContainer);
    renderStudents(list);
  };

  const fillProfileForm = (student) => {
    if (!profileForm || !student) return;
    clearFieldErrors(profileForm);
    profileForm.studentId.value = student.id;
    profileForm.nombre.value = student.nombre || '';
    profileForm.dni.value = student.dni || '';
    profileForm.tutor.value = student.tutor || '';
    if (profileForm.activo) profileForm.activo.checked = student.activo !== false;
    const course = courseById(student.cursoId);
    refreshProfileSchoolOptions(course?.escuela || '', student.cursoId);
    if (profileCourseSelect) profileCourseSelect.value = student.cursoId || '';
    renderStudentSubjectPicker(profileSubjectContainer, studentSubjectIds(student));
    if (profileTitle) profileTitle.textContent = student.nombre || 'Perfil del alumno';
  };

  const openStudentProfile = (studentId) => {
    if (!profileDialog || !profileForm) return;
    const student = read(KEYS.students).find((item) => item.id === studentId);
    if (!student) {
      showAppToast('No se encontró el alumno.', 'error');
      return;
    }
    fillProfileForm(student);
    if (typeof profileDialog.showModal === 'function') profileDialog.showModal();
  };

  const closeStudentProfile = () => {
    if (!profileDialog) return;
    if (typeof profileDialog.close === 'function') profileDialog.close();
  };

  schoolSelect?.addEventListener('change', () => {
    refreshCourseOptions(schoolSelect.value);
  });

  profileSchoolSelect?.addEventListener('change', () => {
    refreshProfileCourseOptions(profileSchoolSelect.value);
  });

  window.addEventListener('aula-clara:schools-changed', (event) => {
    const selected = event.detail?.selected || schoolSelect?.value || '';
    refreshSchoolOptions(selected);
    refreshProfileSchoolOptions(event.detail?.selected || profileSchoolSelect?.value || '');
  });

  refreshSchoolOptions();
  renderStudentSubjectPicker(subjectContainer);

  const activateStudentMode = (mode) => {
    setStudentMode(mode);
    if (mode !== 'excel') {
      refreshSchoolOptions();
      renderStudentSubjectPicker(subjectContainer);
    }
  };

  modeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) activateStudentMode(input.value);
    });
  });

  root.querySelectorAll('[data-student-mode-trigger]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-student-mode-trigger') || 'excel';
      activateStudentMode(mode);
      const excelPanel = root.querySelector('[data-student-mode-panel="excel"]');
      excelPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  activateStudentMode('manual');

  const addSubjectFromInput = async () => {
    const subjectPayload = await upsertSubjectByName(newSubjectInput?.value);
    if (!subjectPayload) {
      newSubjectInput?.focus();
      return;
    }
    const currentSelected = Array.from(form.querySelectorAll('[name="subjectIds"]')).map((input) => input.value);
    if (!currentSelected.includes(subjectPayload.id)) currentSelected.push(subjectPayload.id);
    renderStudentSubjectPicker(subjectContainer, currentSelected);
    if (newSubjectInput) newSubjectInput.value = '';
  };

  addSubjectButton?.addEventListener('click', () => { addSubjectFromInput(); });
  newSubjectInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addSubjectFromInput();
    }
  });

  const addProfileSubjectFromInput = async () => {
    if (!profileForm) return;
    const subjectPayload = await upsertSubjectByName(profileNewSubjectInput?.value);
    if (!subjectPayload) {
      profileNewSubjectInput?.focus();
      return;
    }
    const currentSelected = Array.from(profileForm.querySelectorAll('[name="subjectIds"]')).map((input) => input.value);
    if (!currentSelected.includes(subjectPayload.id)) currentSelected.push(subjectPayload.id);
    renderStudentSubjectPicker(profileSubjectContainer, currentSelected);
    if (profileNewSubjectInput) profileNewSubjectInput.value = '';
  };

  profileAddSubjectButton?.addEventListener('click', () => { addProfileSubjectFromInput(); });
  profileNewSubjectInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addProfileSubjectFromInput();
    }
  });

  profileCloseButton?.addEventListener('click', () => {
    closeStudentProfile();
  });

  profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(profileForm);
    const data = Object.fromEntries(new FormData(profileForm));
    const studentId = String(data.studentId || '').trim();
    if (!studentId) {
      showAppToast('No se pudo identificar al alumno.', 'error');
      return;
    }
    const students = read(KEYS.students);
    const selectedSubjects = Array.from(profileForm.querySelectorAll('[name="subjectIds"]')).map((input) => input.value);
    const pendingSubject = await upsertSubjectByName(data.nuevaMateria);
    if (pendingSubject) selectedSubjects.push(pendingSubject.id);
    const course = courseById(data.cursoId);
    if (!String(data.nombre || '').trim()) {
      setFieldError(profileForm.nombre, 'Ingresá el nombre completo.');
      focusFirstInvalid(profileForm);
      return;
    }
    if (!data.escuela) {
      setFieldError(profileForm.escuela, 'Elegí una escuela.');
      focusFirstInvalid(profileForm);
      return;
    }
    if (!data.cursoId) {
      setFieldError(profileForm.cursoId, 'Elegí un curso.');
      focusFirstInvalid(profileForm);
      return;
    }
    if (course && course.escuela !== data.escuela) {
      setFieldError(profileForm.cursoId, 'El curso no pertenece a la escuela elegida.');
      focusFirstInvalid(profileForm);
      return;
    }
    const payload = {
      id: studentId,
      nombre: data.nombre.trim(),
      dni: String(data.dni || '').trim(),
      cursoId: data.cursoId,
      tutor: String(data.tutor || '').trim(),
      subjectIds: [...new Set(selectedSubjects)],
      activo: Boolean(profileForm.activo?.checked),
      updatedAt: nowIso(),
    };
    const next = students.map((student) => student.id === studentId ? payload : student);
    write(KEYS.students, next);
    await persistAndRefresh('student', 'upsert', payload, refreshStudentPanel);
    closeStudentProfile();
    showAppToast(payload.activo ? 'Perfil actualizado.' : 'Alumno desactivado.', 'ok');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const data = Object.fromEntries(new FormData(form));
    const students = read(KEYS.students);
    const selectedSubjects = Array.from(form.querySelectorAll('[name="subjectIds"]')).map((input) => input.value);
    const pendingSubject = await upsertSubjectByName(data.nuevaMateria);
    if (pendingSubject) selectedSubjects.push(pendingSubject.id);
    const course = courseById(data.cursoId);
    if (!String(data.nombre || '').trim()) {
      setFieldError(form.nombre, 'Ingresá el nombre completo.');
      focusFirstInvalid(form);
      return;
    }
    if (!data.escuela) {
      setFieldError(form.escuela, 'Elegí una escuela.');
      focusFirstInvalid(form);
      return;
    }
    if (!data.cursoId) {
      setFieldError(form.cursoId, 'Elegí un curso.');
      focusFirstInvalid(form);
      return;
    }
    if (course && course.escuela !== data.escuela) {
      setFieldError(form.cursoId, 'El curso no pertenece a la escuela elegida.');
      focusFirstInvalid(form);
      return;
    }
    const payload = {
      id: uid('al'),
      nombre: data.nombre.trim(),
      dni: String(data.dni || '').trim(),
      cursoId: data.cursoId,
      tutor: String(data.tutor || '').trim(),
      subjectIds: [...new Set(selectedSubjects)],
      activo: true,
      updatedAt: nowIso(),
    };
    write(KEYS.students, [...students, payload]);
    form.reset();
    await persistAndRefresh('student', 'upsert', payload, refreshStudentPanel);
    showAppToast('Alumno guardado.', 'ok');
  });

  list.addEventListener('click', async (event) => {
    const openProfile = event.target.closest('[data-open-student-profile], [data-edit-student]');
    const remove = event.target.closest('[data-delete-student]');
    const students = read(KEYS.students);

    if (openProfile) {
      const studentId = openProfile.dataset.openStudentProfile || openProfile.dataset.editStudent;
      if (studentId) openStudentProfile(studentId);
      return;
    }

    if (remove) {
      const id = remove.dataset.deleteStudent;
      const previous = students.find((student) => student.id === id);
      if (!previous) return;
      const next = students.map((student) => student.id === id ? { ...student, activo: false, updatedAt: nowIso() } : student);
      write(KEYS.students, next);
      await persistAndRefresh('student', 'delete', { id, updatedAt: nowIso() }, () => renderStudents(list));
      showAppToast('Alumno desactivado.', 'ok', {
        actionLabel: 'Deshacer',
        onAction: async () => {
          const restored = read(KEYS.students).map((student) =>
            student.id === id ? { ...previous, activo: true, updatedAt: nowIso() } : student
          );
          write(KEYS.students, restored);
          await persistAndRefresh('student', 'upsert', {
            ...previous,
            activo: true,
            updatedAt: nowIso(),
          }, () => renderStudents(list));
          showAppToast('Alumno restaurado.', 'ok');
        },
      });
    }
  });

  renderStudents(list);
  onPanelRefresh(() => {
    refreshSchoolOptions();
    renderStudents(list);
  });
}

function renderStudentSubjectPicker(container, selectedIds = []) {
  if (!container) return;

  const subjects = activeSubjects();
  const selected = new Set(selectedIds);
  const availableSubjects = subjects.filter((subject) => !selected.has(subject.id));

  replaceContent(container,
    el('label', { className: 'subject-search-label' },
      el('span', {}, 'Buscar materia'),
      el('input', { type: 'search', attrs: { 'data-subject-filter': '', placeholder: 'Ej: Matemática, Programación', autocomplete: 'off' } }),
    ),
    el('div', { className: 'selected-subjects', attrs: { 'data-selected-subjects': '' } },
      ...subjects.filter((subject) => selected.has(subject.id)).map((subject) =>
        el('span', { className: 'subject-chip', dataset: { subjectId: subject.id } },
          subject.nombre,
          el('button', { type: 'button', attrs: { 'aria-label': `Eliminar ${subject.nombre}`, 'data-remove-subject': '' } }, '×'),
          el('input', { type: 'hidden', name: 'subjectIds', value: subject.id }),
        ),
      ),
    ),
    el('div', { className: 'subject-suggestions', attrs: { 'data-subject-suggestions': '' } },
      availableSubjects.length
        ? availableSubjects.map((subject) =>
          el('button', { type: 'button', className: 'subject-suggestion', dataset: { addSubject: subject.id } }, subject.nombre),
        )
        : el('p', { className: 'muted' }, 'No hay materias disponibles para seleccionar.'),
    ),
  );

  const filterInput = container.querySelector('[data-subject-filter]');
  const suggestions = container.querySelector('[data-subject-suggestions]');

  const updateSuggestions = (query = '') => {
    const value = String(query).trim().toLowerCase();
    const filtered = availableSubjects.filter((subject) => subject.nombre.toLowerCase().includes(value));
    replaceContent(suggestions,
      filtered.length
        ? filtered.map((subject) =>
          el('button', { type: 'button', className: 'subject-suggestion', dataset: { addSubject: subject.id } }, subject.nombre),
        )
        : el('p', { className: 'muted' }, 'No se encontraron materias con ese nombre.'),
    );
  };

  if (filterInput) {
    filterInput.addEventListener('input', () => updateSuggestions(filterInput.value));
  }

  suggestions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-subject]');
    if (!button) return;
    const subjectId = button.dataset.addSubject;
    if (!subjectId) return;
    renderStudentSubjectPicker(container, [...selected, subjectId]);
  });

  container.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-subject]');
    if (!remove) return;
    const chip = remove.closest('[data-subject-id]');
    if (!chip) return;
    const subjectId = chip.dataset.subjectId;
    renderStudentSubjectPicker(container, selectedIds.filter((id) => id !== subjectId));
  });
}

function renderStudents(list) {
  const students = studentsInCiclo();
  if (!students.length) {
    replaceContent(list, emptyState('No hay alumnos en este ciclo', `Registrá alumnos del ciclo ${activeCicloLectivo()}.`, {
      ctaLabel: 'Cargar alumno',
      spaNav: 'registro',
    }));
    return;
  }
  replaceContent(list, ...students.map((student) => {
    const course = courseById(student.cursoId);
    const avg = average(gradesForStudent(student.id));
    const subjects = subjectsForStudent(student).map((subject) => subject.nombre).join(', ') || 'Sin materias';
    return el('article', { className: 'student-row' },
      el('div', {},
        el('strong', {}, student.nombre),
        el('small', {}, `${course?.escuela || 'Sin escuela'} · ${course?.nombre || 'Sin curso'} - ${course?.turno || ''} · ${subjects}`),
        el('small', {}, student.tutor ? `Contacto: ${student.tutor}` : 'Sin contacto cargado'),
        el('small', {}, `DNI ${student.dni || '-'} · ${course?.nombre || 'Sin curso'} · ${course?.turno || ''}`),
      ),
      el('div', { className: 'row-actions' },
        tag(`Promedio ${avg === null ? '-' : avg.toFixed(1)}`, `tag ${avg !== null && avg < 6 ? 'danger' : 'ok'}`),
        el('button', { className: 'btn btn-ghost', dataset: { openStudentProfile: student.id } }, 'Ver perfil'),
        el('button', { className: 'btn btn-ghost', dataset: { editStudent: student.id } }, 'Editar'),
        el('button', { className: 'btn btn-danger', dataset: { deleteStudent: student.id } }, 'Eliminar'),
      ),
    );
  }));
}

function attendanceDraftKey(studentId, subjectId, date) {
  return `${studentId}|${subjectId}|${date}`;
}

function initAttendance() {
  const root = document.querySelector('[data-attendance]');
  if (!root) return;
  const courseSelect = root.querySelector('[data-filter-course]');
  const subjectSelect = root.querySelector('[data-filter-subject]');
  const dateInput = root.querySelector('[data-attendance-date]');
  const list = root.querySelector('[data-attendance-list]');
  const saveBar = root.querySelector('[data-attendance-save-bar]');
  const saveHint = root.querySelector('[data-attendance-save-hint]');
  const saveButton = root.querySelector('[data-attendance-save]');
  const historySchool = root.querySelector('[data-history-filter-school]');
  const historyCourse = root.querySelector('[data-history-filter-course]');
  const historySubject = root.querySelector('[data-history-filter-subject]');
  const historyFrom = root.querySelector('[data-history-filter-from]');
  const historyTo = root.querySelector('[data-history-filter-to]');
  const draftAttendance = new Map();

  const attendanceContext = () => ({
    date: dateInput.value,
    subjectId: subjectSelect.value,
    courseId: courseSelect.value,
  });

  const savedAttendanceState = (studentId, date, subjectId, records = read(KEYS.attendance)) =>
    records.find((item) => item.studentId === studentId && item.fecha === date && item.subjectId === subjectId)?.estado || '';

  const displayedAttendanceState = (studentId, date, subjectId) => {
    const key = attendanceDraftKey(studentId, subjectId, date);
    if (draftAttendance.has(key)) return draftAttendance.get(key);
    return savedAttendanceState(studentId, date, subjectId);
  };

  const isAttendanceDirty = (studentId, date, subjectId) => {
    const key = attendanceDraftKey(studentId, subjectId, date);
    if (!draftAttendance.has(key)) return false;
    return draftAttendance.get(key) !== savedAttendanceState(studentId, date, subjectId);
  };

  const hasUnsavedAttendance = (date = dateInput.value, subjectId = subjectSelect.value) => {
    for (const [key, state] of draftAttendance) {
      const [studentId, sid, recordDate] = key.split('|');
      if (sid !== subjectId || recordDate !== date) continue;
      if (state !== savedAttendanceState(studentId, recordDate, sid)) return true;
    }
    return false;
  };

  const updateAttendanceSaveUi = () => {
    const pending = hasUnsavedAttendance();
    list?.classList.toggle('attendance-list--pending', pending);
    saveBar?.classList.toggle('is-pending', pending);
    saveHint?.classList.toggle('is-hidden', !pending);
    if (saveButton) {
      saveButton.disabled = !pending;
      saveButton.textContent = pending ? 'Guardar asistencias' : 'Asistencias guardadas';
    }
  };

  const confirmDiscardAttendanceDraft = () => {
    if (!hasUnsavedAttendance()) return true;
    return confirm('Hay asistencias sin guardar para esta fecha y materia. ¿Descartar los cambios?');
  };

  const clearDraftForContext = (date, subjectId) => {
    for (const key of [...draftAttendance.keys()]) {
      const [, sid, recordDate] = key.split('|');
      if (sid === subjectId && recordDate === date) draftAttendance.delete(key);
    }
  };

  const syncHistoryFiltersFromTake = () => {
    const course = courseById(courseSelect?.value);
    if (historySchool && course?.escuela) historySchool.value = course.escuela;
    if (historyCourse && courseSelect?.value) historyCourse.value = courseSelect.value;
    if (historySubject && subjectSelect?.value) historySubject.value = subjectSelect.value;
  };

  dateInput.value = today();
  fillSelect(courseSelect, visibleCourses(), 'Todos los cursos', 'id', courseLabel);
  fillSelect(subjectSelect, activeSubjects(), 'Materia');
  applySelectFromUrl(courseSelect, 'curso');
  applySelectFromUrl(subjectSelect, 'materia');

  const schools = schoolNamesForSelect();
  fillSelect(historySchool, schools.map((school) => ({ id: school, nombre: school })), 'Todas las escuelas');
  fillSelect(historyCourse, visibleCourses(), 'Todos los cursos', 'id', courseLabel);
  fillSelect(historySubject, activeSubjects(), 'Todas las materias');

  applyTeachingContextTo({ course: courseSelect, subject: subjectSelect });
  applySuggestedContextTo({ course: courseSelect, subject: subjectSelect });
  if (!subjectSelect.value && activeSubjects()[0]) subjectSelect.value = activeSubjects()[0].id;
  syncHistoryFiltersFromTake();

  const renderHistory = () => renderAttendanceHistory(root);
  [historySchool, historyCourse, historySubject, historyFrom, historyTo].forEach((control) => {
    control?.addEventListener('change', renderHistory);
  });

  let lastAttendanceContext = attendanceContext();

  const handleAttendanceFilterChange = (control) => {
    control.addEventListener('change', () => {
      if (hasUnsavedAttendance(lastAttendanceContext.date, lastAttendanceContext.subjectId) && !confirmDiscardAttendanceDraft()) {
        dateInput.value = lastAttendanceContext.date;
        subjectSelect.value = lastAttendanceContext.subjectId;
        courseSelect.value = lastAttendanceContext.courseId;
        return;
      }
      clearDraftForContext(lastAttendanceContext.date, lastAttendanceContext.subjectId);
      lastAttendanceContext = attendanceContext();
      if (control === courseSelect || control === subjectSelect) {
        const course = courseById(courseSelect.value);
        setTeachingContext({
          escuela: course?.escuela || '',
          cursoId: courseSelect.value,
          materiaId: subjectSelect.value,
        }, { notify: false });
        refreshGlobalTeachingContextUi();
        syncHistoryFiltersFromTake();
        renderHistory();
      }
      renderAttendance();
    });
  };

  window.addEventListener('aula-clara:teaching-context-changed', () => {
    applyTeachingContextTo({ course: courseSelect, subject: subjectSelect });
    lastAttendanceContext = attendanceContext();
    syncHistoryFiltersFromTake();
    renderAttendance();
    renderHistory();
  });

  [courseSelect, subjectSelect, dateInput].forEach(handleAttendanceFilterChange);

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-attendance-state]');
    if (!button) return;
    const { date, subjectId } = attendanceContext();
    const subjectError = root.querySelector('[data-attendance-subject-error]');
    if (!subjectId) {
      clearFieldErrors(root.querySelector('[data-attendance-take-view]') || root);
      setFieldError(subjectSelect, 'Elegí una materia antes de marcar asistencia.');
      if (subjectError) {
        subjectError.hidden = false;
        subjectError.textContent = 'Elegí una materia.';
      }
      showAppToast('Elegí una materia antes de marcar asistencia.', 'warning');
      subjectSelect?.focus();
      return;
    }
    if (subjectError) {
      subjectError.hidden = true;
      subjectError.textContent = '';
    }
    subjectSelect?.classList.remove('is-invalid');
    const key = attendanceDraftKey(button.dataset.studentId, subjectId, date);
    const nextState = button.dataset.attendanceState;
    if (nextState === savedAttendanceState(button.dataset.studentId, date, subjectId)) {
      draftAttendance.delete(key);
    } else {
      draftAttendance.set(key, nextState);
    }
    renderAttendance();
  });

  saveButton?.addEventListener('click', async () => {
    if (!hasUnsavedAttendance()) return;
    saveButton.disabled = true;
    saveButton.textContent = 'Guardando...';
    try {
      await commitAttendanceDraft(draftAttendance, attendanceContext());
      notifyDataChanged({ scope: 'attendance' });
      showAppToast('Asistencias guardadas.', 'ok');
    } catch (error) {
      console.error('[aula-clara] attendance save failed', error);
      showAppToast('No se pudieron guardar las asistencias. Intentá de nuevo.', 'error');
    } finally {
      renderAttendance();
    }
  });

  function renderAttendance() {
    const students = studentsInCiclo('', courseSelect.value).filter((student) =>
      studentHasSubject(student, subjectSelect.value)
    )
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const { date, subjectId } = attendanceContext();
    const records = read(KEYS.attendance);
    const present = students.filter((student) => displayedAttendanceState(student.id, date, subjectId) === 'presente').length;
    const absent = students.filter((student) => displayedAttendanceState(student.id, date, subjectId) === 'ausente').length;

    const summaryNode = root.querySelector('[data-attendance-summary]');
    renderMetrics(summaryNode, [
      { value: students.length, label: 'Alumnos' },
      { value: present, label: 'Presentes' },
      { value: absent, label: 'Ausentes' },
    ]);

    if (!students.length) {
      replaceContent(list, emptyState('No hay alumnos para estos filtros', 'Cargá alumnos o cambiá el curso de arriba.', {
        ctaLabel: 'Ir a Alumnos',
        spaNav: 'registro',
      }));
      updateAttendanceSaveUi();
      return;
    }

    replaceContent(list, ...students.map((student) => {
      const current = displayedAttendanceState(student.id, date, subjectId);
      const dirty = isAttendanceDirty(student.id, date, subjectId);
      const course = courseById(student.cursoId);
      return el('article', {
        className: `student-row${dirty ? ' attendance-row--dirty' : ''}`,
      },
        el('div', {},
          el('strong', {}, student.nombre),
          el('small', {}, `${course?.nombre || ''} · ${subjectById(subjectId)?.nombre || 'Materia'}`),
        ),
        el('div', { className: 'attendance-options' },
          el('button', {
            type: 'button',
            dataset: { studentId: student.id, attendanceState: 'presente' },
            className: current === 'presente' ? 'active-present' : '',
          }, 'Presente'),
          el('button', {
            type: 'button',
            dataset: { studentId: student.id, attendanceState: 'ausente' },
            className: current === 'ausente' ? 'active-absent' : '',
          }, 'Ausente'),
        ),
      );
    }));
    updateAttendanceSaveUi();
  }

  renderAttendance();
  renderHistory();
  onPanelRefresh(() => {
    fillSelect(courseSelect, visibleCourses(), 'Todos los cursos', 'id', courseLabel);
    fillSelect(subjectSelect, activeSubjects(), 'Materia');
    fillSelect(historyCourse, visibleCourses(), 'Todos los cursos', 'id', courseLabel);
    fillSelect(historySubject, activeSubjects(), 'Todas las materias');
    syncHistoryFiltersFromTake();
    renderAttendance();
    renderHistory();
  });
}

async function commitAttendanceDraft(draftAttendance, context) {
  if (!currentUser?.id) {
    window.location.href = '/login';
    return;
  }

  const { date, subjectId } = context;
  if (!date || !subjectId) {
    throw new Error('Faltan fecha o materia para guardar asistencia.');
  }

  let records = read(KEYS.attendance);
  const dirtyEntries = [];

  for (const [key, state] of draftAttendance) {
    const [studentId, sid, recordDate] = key.split('|');
    if (sid !== subjectId || recordDate !== date) continue;
    const saved = records.find((item) =>
      item.studentId === studentId && item.fecha === recordDate && item.subjectId === sid
    )?.estado || '';
    if (state === saved) continue;
    dirtyEntries.push({ studentId, subjectId: sid, date: recordDate, state, key });
  }

  if (!dirtyEntries.length) return;

  for (const entry of dirtyEntries) {
    records = records.filter((item) => !(
      item.studentId === entry.studentId &&
      item.fecha === entry.date &&
      item.subjectId === entry.subjectId
    ));
    const id = `attendance:${currentUser.id}:${entry.studentId}:${entry.subjectId}:${entry.date}`;
    const updatedAt = nowIso();
    records.push({
      id,
      studentId: entry.studentId,
      subjectId: entry.subjectId,
      fecha: entry.date,
      estado: entry.state,
      updatedAt,
    });
    await saveAttendanceOffline({
      docenteId: currentUser.id,
      studentId: entry.studentId,
      subjectId: entry.subjectId,
      fecha: entry.date,
      estado: entry.state,
    });
    draftAttendance.delete(entry.key);
  }

  write(KEYS.attendance, records);
}

async function saveAttendance(studentId, state, date, subjectId) {
  if (!currentUser?.id) return window.location.href = '/login';
  const records = read(KEYS.attendance).filter((item) => !(item.studentId === studentId && item.fecha === date && item.subjectId === subjectId));
  const id = `attendance:${currentUser.id}:${studentId}:${subjectId}:${date}`;
  const updatedAt = nowIso();
  records.push({ id, studentId, subjectId, fecha: date, estado: state, updatedAt });
  write(KEYS.attendance, records);
  await saveAttendanceOffline({ docenteId: currentUser.id, studentId, subjectId, fecha: date, estado: state });
}

function gradeTextOptions(mode = 'conceptual') {
  return mode === 'trayectoria' ? ['TEP', 'TED', 'TEA'] : ['Bien', 'Regular', 'Mal'];
}

function gradeEvaluationMeta(metaForm, subjectId = '') {
  if (!metaForm) return null;
  const data = Object.fromEntries(new FormData(metaForm));
  return {
    subjectId: subjectId || data.subjectId || '',
    titulo: String(data.titulo || '').trim(),
    tipoEvaluacion: data.tipoEvaluacion || 'TP',
    peso: Number(data.peso || 100),
    fecha: data.fecha || today(),
    fechaEntrega: data.fechaEntrega || '',
    periodo: data.periodo || defaultGradePeriod(),
    modoCalificacion: data.modoCalificacion || 'numerica',
  };
}

function savedGradeForEvaluation(studentId, subjectId, titulo, periodo) {
  const normalizedTitle = String(titulo || '').trim();
  if (!studentId || !subjectId || !normalizedTitle) return null;
  return read(KEYS.grades).find((grade) =>
    grade.studentId === studentId &&
    grade.subjectId === subjectId &&
    String(grade.titulo || '').trim() === normalizedTitle &&
    (grade.periodo || inferGradePeriod(grade)) === periodo
  ) || null;
}

function gradeDraftKey(studentId, subjectId, titulo, periodo) {
  return `${studentId}|${subjectId}|${String(titulo || '').trim().toLowerCase()}|${periodo}`;
}

function gradeDraftHasValue(entry, mode = 'numerica') {
  if (!entry) return false;
  if (mode === 'numerica') return entry.valor !== '' && entry.valor !== null && entry.valor !== undefined;
  return Boolean(entry.calificacionTexto);
}

function gradeEntryLabel(entry, mode = 'numerica') {
  if (!gradeDraftHasValue(entry, mode)) return '-';
  if (mode === 'numerica') return Number(entry.valor).toFixed(1);
  return entry.calificacionTexto;
}

function coursesForGradeFilters(schoolName = '') {
  return visibleCourses(schoolName);
}

async function commitGradesDraft(draftGrades, meta) {
  if (!currentUser?.id) {
    window.location.href = '/login';
    return;
  }
  if (!meta?.subjectId) throw new Error('Elegí una materia para guardar las calificaciones.');
  if (!meta.titulo) throw new Error('Completá el título de la evaluación.');

  const dirtyEntries = [];
  for (const [key, entry] of draftGrades) {
    const [studentId, subjectId, , periodo] = key.split('|');
    if (subjectId !== meta.subjectId || periodo !== meta.periodo) continue;
    if (!gradeDraftHasValue(entry, meta.modoCalificacion)) continue;

    const saved = savedGradeForEvaluation(studentId, subjectId, meta.titulo, periodo);
    const savedValue = saved
      ? (meta.modoCalificacion === 'numerica'
        ? String(saved.valor ?? '')
        : String(saved.calificacionTexto || ''))
      : '';
    const draftValue = meta.modoCalificacion === 'numerica'
      ? String(entry.valor ?? '')
      : String(entry.calificacionTexto || '');
    const savedMotivo = String(saved?.motivo || '');
    const draftMotivo = String(entry.motivo || '');
    if (savedValue === draftValue && savedMotivo === draftMotivo) continue;

    dirtyEntries.push({ studentId, key, entry, savedId: saved?.id });
  }

  if (!dirtyEntries.length) return;

  let grades = read(KEYS.grades);
  for (const item of dirtyEntries) {
    const isNumeric = meta.modoCalificacion === 'numerica';
    const valor = isNumeric ? Number(item.entry.valor) : null;
    if (isNumeric && (Number.isNaN(valor) || valor < 1 || valor > 10)) {
      throw new Error('Las notas numéricas deben estar entre 1 y 10.');
    }

    const payload = {
      id: item.savedId || uid('nota'),
      studentId: item.studentId,
      subjectId: meta.subjectId,
      titulo: meta.titulo,
      tipoEvaluacion: meta.tipoEvaluacion,
      valor: isNumeric ? valor : null,
      calificacionTexto: isNumeric ? '' : String(item.entry.calificacionTexto || ''),
      motivo: String(item.entry.motivo || '').trim(),
      peso: meta.peso,
      fecha: meta.fecha,
      fechaEntrega: meta.fechaEntrega,
      periodo: meta.periodo,
      updatedAt: nowIso(),
    };

    grades = grades.filter((grade) => grade.id !== payload.id);
    grades.push(payload);
    await queue('grade', 'upsert', payload);
    draftGrades.delete(item.key);
  }

  write(KEYS.grades, grades);
}

function initGrades() {
  const root = document.querySelector('[data-grades]');
  if (!root) return;
  const metaForm = root.querySelector('[data-grade-meta-form]');
  const subjectHidden = metaForm?.querySelector('[name="subjectId"]');
  const typeSelect = root.querySelector('[data-evaluation-type]');
  const importanceSelect = root.querySelector('[data-grade-importance]');
  const modeSelect = root.querySelector('[data-grade-mode]');
  const periodSelect = root.querySelector('[data-grade-period]');
  const schoolFilter = root.querySelector('[data-grade-school-filter]');
  const courseFilter = root.querySelector('[data-grade-course-filter]');
  const subjectFilter = root.querySelector('[data-grade-subject-filter]');
  const bulkList = root.querySelector('[data-grade-bulk-list]');
  const bulkSummary = root.querySelector('[data-grade-bulk-summary]');
  const saveBar = root.querySelector('[data-grades-save-bar]');
  const saveHint = root.querySelector('[data-grades-save-hint]');
  const saveButton = root.querySelector('[data-grades-save]');
  const table = root.querySelector('[data-grade-table]');
  const deliveries = root.querySelector('[data-grade-deliveries]');
  const deliveriesSummary = root.querySelector('[data-grade-deliveries-summary]');
  const deliveryTypeFilter = root.querySelector('[data-delivery-type-filter]');
  const deliveryStatusFilter = root.querySelector('[data-delivery-status-filter]');
  const deliveryFromFilter = root.querySelector('[data-delivery-from-filter]');
  const deliveryToFilter = root.querySelector('[data-delivery-to-filter]');
  const contextText = root.querySelector('[data-grade-context-text]');
  const inlineSubjectForm = root.querySelector('[data-inline-subject-form]');
  const inlineSubjectList = root.querySelector('[data-inline-subject-list]');
  const detailCourseFilter = root.querySelector('[data-detail-course-filter]');
  const detailSubjectFilter = root.querySelector('[data-detail-subject-filter]');
  const detailPeriodFilter = root.querySelector('[data-detail-period-filter]');
  const draftGrades = new Map();

  const currentMeta = () => gradeEvaluationMeta(metaForm, subjectFilter?.value || '');

  const syncPeriodFromType = () => {
    if (!periodSelect) return;
    const tipo = String(typeSelect?.value || '').toLowerCase();
    if (/recuperatorio|recup/.test(tipo)) periodSelect.value = 'recuperatorio';
    else if (/previa/.test(tipo)) periodSelect.value = 'previa';
  };

  const refreshCourseOptions = (selected = courseFilter?.value || '') => {
    fillSelect(
      courseFilter,
      coursesForGradeFilters(schoolFilter?.value || ''),
      'Todos los cursos',
      'id',
      courseLabel,
    );
    if (selected && [...courseFilter.options].some((option) => option.value === selected)) {
      courseFilter.value = selected;
    }
  };

  const refreshSchoolOptions = () => {
    if (!schoolFilter) return;
    const selected = schoolFilter.value;
    fillSelect(
      schoolFilter,
      schoolNamesForSelect().map((nombre) => ({ id: nombre, nombre })),
      'Todas las escuelas',
    );
    if (selected) schoolFilter.value = selected;
  };

  const refreshSubjectOptions = (selected = subjectFilter?.value || '') => {
    fillSelect(subjectFilter, activeSubjects(), 'Elegir materia');
    if (selected && [...subjectFilter.options].some((option) => option.value === selected)) {
      subjectFilter.value = selected;
    } else if (!subjectFilter.value && activeSubjects()[0]) {
      subjectFilter.value = activeSubjects()[0].id;
    }
    if (subjectHidden) subjectHidden.value = subjectFilter?.value || '';
    renderInlineSubjects(inlineSubjectList);
  };

  const hasUnsavedGrades = () => {
    const meta = currentMeta();
    if (!meta?.subjectId || !meta.titulo) return false;
    for (const [key, entry] of draftGrades) {
      const [studentId, subjectId, , periodo] = key.split('|');
      if (subjectId !== meta.subjectId || periodo !== meta.periodo) continue;
      if (!gradeDraftHasValue(entry, meta.modoCalificacion)) continue;
      const saved = savedGradeForEvaluation(studentId, subjectId, meta.titulo, periodo);
      const savedValue = saved
        ? (meta.modoCalificacion === 'numerica'
          ? String(saved.valor ?? '')
          : String(saved.calificacionTexto || ''))
        : '';
      const draftValue = meta.modoCalificacion === 'numerica'
        ? String(entry.valor ?? '')
        : String(entry.calificacionTexto || '');
      if (savedValue !== draftValue || String(saved?.motivo || '') !== String(entry.motivo || '')) return true;
    }
    return false;
  };

  const updateGradesSaveUi = () => {
    const pending = hasUnsavedGrades();
    bulkList?.classList.toggle('grade-bulk-list--pending', pending);
    saveBar?.classList.toggle('is-pending', pending);
    saveHint?.classList.toggle('is-hidden', !pending);
    if (saveButton) {
      saveButton.disabled = !pending;
      saveButton.textContent = pending ? 'Guardar calificaciones' : 'Calificaciones guardadas';
    }
  };

  const confirmDiscardGradesDraft = () => {
    if (!hasUnsavedGrades()) return true;
    return confirm('Hay calificaciones sin guardar para esta evaluación. ¿Descartar los cambios?');
  };

  const clearDraftForEvaluation = (subjectId, titulo, periodo) => {
    const normalizedTitle = String(titulo || '').trim().toLowerCase();
    for (const key of [...draftGrades.keys()]) {
      const [, sid, title, p] = key.split('|');
      if (sid === subjectId && title === normalizedTitle && p === periodo) draftGrades.delete(key);
    }
  };

  const loadGradeIntoDraft = (grade) => {
    if (!grade || !metaForm) return;
    metaForm.titulo.value = grade.titulo || '';
    metaForm.tipoEvaluacion.value = grade.tipoEvaluacion || 'TP';
    metaForm.peso.value = grade.peso ?? 100;
    metaForm.modoCalificacion.value = ['TEP', 'TED', 'TEA'].includes(grade.calificacionTexto)
      ? 'trayectoria'
      : grade.calificacionTexto ? 'conceptual' : 'numerica';
    metaForm.fecha.value = grade.fecha || today();
    metaForm.fechaEntrega.value = grade.fechaEntrega || '';
    if (periodSelect) periodSelect.value = grade.periodo || inferGradePeriod(grade);
    if (subjectFilter) subjectFilter.value = grade.subjectId;
    if (subjectHidden) subjectHidden.value = grade.subjectId;

    const key = gradeDraftKey(grade.studentId, grade.subjectId, grade.titulo, grade.periodo || inferGradePeriod(grade));
    draftGrades.set(key, {
      valor: grade.valor ?? '',
      calificacionTexto: grade.calificacionTexto || '',
      motivo: grade.motivo || '',
    });
    renderBulkGrades();
    metaForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const renderBulkGrades = () => {
    const meta = currentMeta();
    const students = studentsInCiclo('', courseFilter?.value || '').filter((student) =>
      studentHasSubject(student, subjectFilter?.value || '')
    ).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    if (bulkSummary) {
      bulkSummary.textContent = students.length
        ? `${students.length} alumno(s) · modo ${meta?.modoCalificacion || 'numérica'}`
        : 'Seleccioná curso y materia para ver el listado.';
    }

    if (!students.length || !meta?.subjectId) {
      replaceContent(
        bulkList,
        emptyState('Sin alumnos', 'Cargá alumnos del curso de arriba.', {
          ctaLabel: 'Ir a Alumnos',
          spaNav: 'registro',
        }),
      );
      updateGradesSaveUi();
      return;
    }

    if (!meta.titulo) {
      replaceContent(
        bulkList,
        emptyState('Completá el título', 'Indicá el título de la evaluación para cargar notas al listado.'),
      );
      updateGradesSaveUi();
      return;
    }

    replaceContent(bulkList, ...students.map((student) => {
      const course = courseById(student.cursoId);
      const key = gradeDraftKey(student.id, meta.subjectId, meta.titulo, meta.periodo);
      const saved = savedGradeForEvaluation(student.id, meta.subjectId, meta.titulo, meta.periodo);
      const draft = draftGrades.get(key) || {
        valor: saved?.valor ?? '',
        calificacionTexto: saved?.calificacionTexto || '',
        motivo: saved?.motivo || '',
      };
      if (!draftGrades.has(key) && (saved || gradeDraftHasValue(draft, meta.modoCalificacion))) {
        draftGrades.set(key, draft);
      }

      const displayed = draftGrades.get(key) || draft;
      const dirty = (() => {
        if (!gradeDraftHasValue(displayed, meta.modoCalificacion)) return false;
        if (!saved) return true;
        const savedValue = meta.modoCalificacion === 'numerica'
          ? String(saved.valor ?? '')
          : String(saved.calificacionTexto || '');
        const draftValue = meta.modoCalificacion === 'numerica'
          ? String(displayed.valor ?? '')
          : String(displayed.calificacionTexto || '');
        return savedValue !== draftValue || String(saved.motivo || '') !== String(displayed.motivo || '');
      })();

      const gradeControl = meta.modoCalificacion === 'numerica'
        ? el('input', {
          type: 'number',
          className: 'grade-bulk-value',
          attrs: {
            min: 1,
            max: 10,
            step: 0.1,
            placeholder: '1-10',
            'aria-label': `Nota de ${student.nombre}`,
          },
          dataset: { gradeBulkStudent: student.id, gradeBulkField: 'valor' },
          value: displayed.valor ?? '',
        })
        : (() => {
          const select = el('select', {
            className: 'grade-bulk-value',
            dataset: { gradeBulkStudent: student.id, gradeBulkField: 'calificacionTexto' },
            attrs: { 'aria-label': `Calificación de ${student.nombre}` },
          },
            el('option', { value: '' }, 'Sin calificar'),
            ...gradeTextOptions(meta.modoCalificacion).map((option) =>
              el('option', { value: option }, option),
            ),
          );
          select.value = displayed.calificacionTexto || '';
          return select;
        })();

      const hasValue = gradeDraftHasValue(displayed, meta.modoCalificacion);

      return el('article', {
        className: `student-row grade-bulk-row${dirty ? ' grade-row--dirty' : ''}${hasValue ? ' grade-row--scored' : ''}`,
      },
        el('div', {},
          el('strong', {}, student.nombre),
          el('small', {}, [course?.escuela, `${course?.nombre || ''} ${course?.turno || ''}`.trim(), subjectById(meta.subjectId)?.nombre].filter(Boolean).join(' · ')),
          saved ? el('small', {}, `Guardada: ${gradeLabel(saved)}`) : null,
        ),
        el('div', { className: 'grade-bulk-inputs' },
          gradeControl,
          el('input', {
            type: 'text',
            className: `grade-motivo-field${hasValue ? '' : ' is-hidden'}`,
            attrs: {
              placeholder: 'Motivo u observación (opcional)',
              'aria-label': `Motivo de la nota de ${student.nombre}`,
            },
            dataset: { gradeBulkStudent: student.id, gradeBulkField: 'motivo' },
            value: displayed.motivo || '',
          }),
        ),
      );
    }));

    updateGradesSaveUi();
  };

  refreshSchoolOptions();
  refreshCourseOptions();
  fillSelect(detailCourseFilter, visibleCourses(), 'Todos los cursos', 'id', courseLabel);
  refreshSubjectOptions();
  if (detailPeriodFilter) detailPeriodFilter.value = defaultGradePeriod();
  applySelectFromUrl(courseFilter, 'curso');
  applySelectFromUrl(detailCourseFilter, 'curso');
  applySelectFromUrl(subjectFilter, 'materia');
  applySelectFromUrl(detailSubjectFilter, 'materia');
  applyTeachingContextTo({ course: courseFilter, subject: subjectFilter });
  applySuggestedContextTo({ course: courseFilter, subject: subjectFilter });
  if (metaForm) {
    metaForm.fecha.value = today();
    if (periodSelect) periodSelect.value = defaultGradePeriod();
    importanceSelect.value = String(importanceByType(typeSelect.value));
  }

  const renderDetail = () => renderGradesDetail(root);
  const syncDetailFiltersFromTake = () => {
    if (detailCourseFilter && courseFilter?.value) detailCourseFilter.value = courseFilter.value;
    if (detailSubjectFilter && subjectFilter?.value) detailSubjectFilter.value = subjectFilter.value;
  };
  [detailCourseFilter, detailSubjectFilter, detailPeriodFilter].forEach((control) => {
    control?.addEventListener('change', renderDetail);
  });

  const deliveryFilters = () => ({
    tipo: deliveryTypeFilter?.value || '',
    estado: deliveryStatusFilter?.value || '',
    desde: deliveryFromFilter?.value || '',
    hasta: deliveryToFilter?.value || '',
  });

  const renderAll = async () => {
    if (subjectHidden) subjectHidden.value = subjectFilter?.value || '';
    syncDetailFiltersFromTake();
    renderGrades(table, subjectFilter?.value || '', courseFilter?.value || '');
    renderBulkGrades();

    await renderUpcomingActivities(
      deliveries,
      deliveriesSummary,
      subjectFilter?.value || '',
      courseFilter?.value || '',
      deliveryFilters(),
      {
        onActivitySelect: (activity) => {
          if (!metaForm) return;
          if (hasUnsavedGrades() && !confirmDiscardGradesDraft()) return;
          clearDraftForEvaluation(
            subjectFilter?.value || '',
            metaForm.titulo.value,
            periodSelect?.value || defaultGradePeriod(),
          );
          metaForm.titulo.value = activity.titulo || '';
          typeSelect.value = activity.tipo === 'evaluacion' ? 'Evaluacion' : 'TP';
          importanceSelect.value = String(importanceByType(typeSelect.value));
          if (activity.fecha_publicacion) metaForm.fecha.value = activity.fecha_publicacion;
          if (activity.fecha_vencimiento) metaForm.fechaEntrega.value = activity.fecha_vencimiento;
          syncPeriodFromType();
          renderBulkGrades();
        },
      },
    );

    renderDetail();

    if (contextText) {
      const course = courseById(courseFilter?.value);
      const subject = subjectById(subjectFilter?.value);
      contextText.textContent = [
        schoolFilter?.value || course?.escuela,
        course ? `${course.nombre} (${course.turno})` : '',
        subject?.nombre,
      ].filter(Boolean).join(' · ') || 'Seleccioná escuela, curso y materia.';
    }
  };

  let lastEvaluationSignature = '';

  const handleEvaluationMetaChange = () => {
    const meta = currentMeta();
    const signature = `${meta?.subjectId}|${meta?.periodo}|${meta?.titulo}|${meta?.modoCalificacion}`;
    if (lastEvaluationSignature && lastEvaluationSignature !== signature && hasUnsavedGrades() && !confirmDiscardGradesDraft()) {
      const [subjectId, periodo, titulo, modoCalificacion] = lastEvaluationSignature.split('|');
      if (subjectFilter) subjectFilter.value = subjectId;
      if (subjectHidden) subjectHidden.value = subjectId;
      if (metaForm) {
        metaForm.titulo.value = titulo;
        metaForm.modoCalificacion.value = modoCalificacion;
      }
      if (periodSelect) periodSelect.value = periodo;
      renderBulkGrades();
      return;
    }
    if (lastEvaluationSignature && lastEvaluationSignature !== signature) {
      const [subjectId, periodo, titulo] = lastEvaluationSignature.split('|');
      clearDraftForEvaluation(subjectId, titulo, periodo);
    }
    lastEvaluationSignature = signature;
    renderBulkGrades();
  };

  schoolFilter?.addEventListener('change', () => {
    refreshCourseOptions('');
    renderAll();
  });
  subjectFilter?.addEventListener('change', () => {
    if (subjectHidden) subjectHidden.value = subjectFilter.value;
    const course = courseById(courseFilter?.value);
    setTeachingContext({
      escuela: course?.escuela || '',
      cursoId: courseFilter?.value || '',
      materiaId: subjectFilter.value,
    }, { notify: false });
    refreshGlobalTeachingContextUi();
    handleEvaluationMetaChange();
    renderAll();
  });
  courseFilter?.addEventListener('change', () => {
    const course = courseById(courseFilter.value);
    setTeachingContext({
      escuela: course?.escuela || '',
      cursoId: courseFilter.value,
      materiaId: subjectFilter?.value || '',
    }, { notify: false });
    refreshGlobalTeachingContextUi();
    renderAll();
  });
  window.addEventListener('aula-clara:teaching-context-changed', () => {
    applyTeachingContextTo({ course: courseFilter, subject: subjectFilter });
    renderAll();
  });
  typeSelect?.addEventListener('change', () => {
    importanceSelect.value = String(importanceByType(typeSelect.value));
    if (!metaForm.titulo.value.trim()) metaForm.titulo.value = typeSelect.value;
    syncPeriodFromType();
    handleEvaluationMetaChange();
  });
  modeSelect?.addEventListener('change', handleEvaluationMetaChange);
  periodSelect?.addEventListener('change', handleEvaluationMetaChange);
  metaForm?.addEventListener('input', (event) => {
    if (event.target?.name === 'titulo' || event.target?.name === 'fecha' || event.target?.name === 'fechaEntrega') {
      handleEvaluationMetaChange();
    }
  });

  [deliveryTypeFilter, deliveryStatusFilter, deliveryFromFilter, deliveryToFilter].forEach((element) => {
    element?.addEventListener('change', () => { renderAll(); });
  });

  const updateBulkRowUi = (row, studentId) => {
    if (!row) return;
    const meta = currentMeta();
    if (!meta?.subjectId || !meta.titulo) return;
    const key = gradeDraftKey(studentId, meta.subjectId, meta.titulo, meta.periodo);
    const saved = savedGradeForEvaluation(studentId, meta.subjectId, meta.titulo, meta.periodo);
    const displayed = draftGrades.get(key) || {
      valor: saved?.valor ?? '',
      calificacionTexto: saved?.calificacionTexto || '',
      motivo: saved?.motivo || '',
    };
    const hasValue = gradeDraftHasValue(displayed, meta.modoCalificacion);
    const dirty = (() => {
      if (!hasValue) return false;
      if (!saved) return true;
      const savedValue = meta.modoCalificacion === 'numerica'
        ? String(saved.valor ?? '')
        : String(saved.calificacionTexto || '');
      const draftValue = meta.modoCalificacion === 'numerica'
        ? String(displayed.valor ?? '')
        : String(displayed.calificacionTexto || '');
      return savedValue !== draftValue || String(saved.motivo || '') !== String(displayed.motivo || '');
    })();
    row.classList.toggle('grade-row--scored', hasValue);
    row.classList.toggle('grade-row--dirty', dirty);
    row.querySelector('.grade-motivo-field')?.classList.toggle('is-hidden', !hasValue);
  };
  bulkList?.addEventListener('input', (event) => {
    const field = event.target.closest('[data-grade-bulk-field]');
    if (!field) return;
    const meta = currentMeta();
    if (!meta?.subjectId || !meta.titulo) return;
    const studentId = field.dataset.gradeBulkStudent;
    const key = gradeDraftKey(studentId, meta.subjectId, meta.titulo, meta.periodo);
    const current = draftGrades.get(key) || { valor: '', calificacionTexto: '', motivo: '' };
    const next = { ...current, [field.dataset.gradeBulkField]: field.value };
    if (!gradeDraftHasValue(next, meta.modoCalificacion) && !next.motivo) {
      draftGrades.delete(key);
    } else {
      draftGrades.set(key, next);
    }
    updateBulkRowUi(field.closest('.grade-bulk-row'), studentId);
    updateGradesSaveUi();
  });

  bulkList?.addEventListener('change', (event) => {
    const field = event.target.closest('[data-grade-bulk-field]');
    if (!field || field.dataset.gradeBulkField === 'motivo') return;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

  saveButton?.addEventListener('click', async () => {
    if (!hasUnsavedGrades()) return;
    const meta = currentMeta();
    const subjectError = root.querySelector('[data-grade-subject-error]');
    if (!meta?.subjectId) {
      setFieldError(subjectFilter, 'Elegí una materia.');
      if (subjectError) {
        subjectError.hidden = false;
        subjectError.textContent = 'Elegí una materia.';
      }
      showAppToast('Elegí una materia antes de guardar calificaciones.', 'warning');
      subjectFilter?.focus();
      return;
    }
    if (subjectError) {
      subjectError.hidden = true;
      subjectError.textContent = '';
    }
    subjectFilter?.classList.remove('is-invalid');
    saveButton.disabled = true;
    saveButton.textContent = 'Guardando...';
    try {
      await commitGradesDraft(draftGrades, meta);
      notifyDataChanged({ scope: 'grades' });
      renderAll();
      showAppToast('Calificaciones guardadas.', 'ok');
    } catch (error) {
      console.error('[aula-clara] grades save failed', error);
      showAppToast(error instanceof Error ? error.message : 'No se pudieron guardar las calificaciones. Intentá de nuevo.', 'error');
      updateGradesSaveUi();
    }
  });

  [deliveryTypeFilter, deliveryStatusFilter, deliveryFromFilter, deliveryToFilter].forEach((element) => {
    element?.addEventListener('change', () => { renderAll(); });
  });

  inlineSubjectForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(inlineSubjectForm));
    const nombre = String(data.nombre || '').trim();
    if (!nombre) return;
    const payload = { id: uid('mat'), nombre, activo: true, updatedAt: nowIso() };
    write(KEYS.subjects, [...read(KEYS.subjects), payload]);
    inlineSubjectForm.reset();
    await persistAndRefresh('subject', 'upsert', payload, () => {
      refreshSubjectOptions(subjectFilter?.value || '');
      renderAll();
    });
  });

  table.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-grade]');
    const remove = event.target.closest('[data-delete-grade]');
    const grades = read(KEYS.grades);
    if (edit) {
      const grade = grades.find((item) => item.id === edit.dataset.editGrade);
      if (!grade) return;
      if (hasUnsavedGrades() && !confirmDiscardGradesDraft()) return;
      draftGrades.clear();
      if (courseFilter && grade.studentId) {
        const student = studentById(grade.studentId);
        if (student?.cursoId) courseFilter.value = student.cursoId;
      }
      if (subjectFilter) subjectFilter.value = grade.subjectId;
      loadGradeIntoDraft(grade);
      renderAll();
    }
    if (remove) {
      const id = remove.dataset.deleteGrade;
      const previous = grades.find((grade) => grade.id === id);
      if (!previous) return;
      write(KEYS.grades, grades.filter((grade) => grade.id !== id));
      await persistAndRefresh('grade', 'delete', { id, updatedAt: nowIso() }, renderAll);
      showAppToast('Calificación eliminada.', 'ok', {
        actionLabel: 'Deshacer',
        onAction: async () => {
          write(KEYS.grades, [...read(KEYS.grades), previous]);
          await persistAndRefresh('grade', 'upsert', { ...previous, updatedAt: nowIso() }, renderAll);
          showAppToast('Calificación restaurada.', 'ok');
        },
      });
    }
  });

  renderAll();
  onPanelRefresh(() => {
    refreshSchoolOptions();
    refreshCourseOptions(courseFilter?.value || '');
    fillSelect(detailCourseFilter, visibleCourses(), 'Todos los cursos', 'id', courseLabel);
    refreshSubjectOptions(subjectFilter?.value || '');
    void renderAll();
  });
}

function renderGrades(table, subjectId = '', courseId = '') {
  const students = studentsInCiclo('', courseId).filter((student) =>
    studentHasSubject(student, subjectId)
  );

  const rows = students.map((student) => {
    const avg = average(gradesForStudent(student.id, subjectId));
    const rate = attendanceRate(student.id, subjectId);
    const grades = gradesForStudent(student.id, subjectId);
    const status = avg !== null && avg < 6 ? 'danger' : rate !== null && rate < 75 ? 'warning' : 'ok';
    const notesList = el('div', { className: 'notes-list' },
      grades.length
        ? grades.map((grade) =>
          el('span', { className: 'tag' },
            `${grade.tipoEvaluacion || 'Eval.'} - ${grade.titulo}: ${gradeLabel(grade)} `,
            grade.motivo ? el('small', {}, `· ${grade.motivo}`) : null,
            el('small', {}, importanceLabel(grade.peso)),
            el('button', { dataset: { editGrade: grade.id }, attrs: { title: 'Editar' } }, 'Editar'),
            el('button', { dataset: { deleteGrade: grade.id }, attrs: { title: 'Eliminar' } }, 'Eliminar'),
          ),
        )
        : tag('Sin notas'),
    );
    return [
      [
        el('strong', {}, student.nombre),
        el('small', {}, courseById(student.cursoId)?.nombre || 'Sin curso'),
      ],
      avg === null ? '-' : avg.toFixed(1),
      rate === null ? '-' : `${rate.toFixed(0)}%`,
      notesList,
      tag(status === 'danger' ? 'Riesgo' : status === 'warning' ? 'Atencion' : 'Correcto', `tag ${status}`),
    ];
  });

  renderTable(
    table,
    ['Alumno', 'Promedio', 'Asistencia', 'Calificaciones', 'Estado'],
    rows,
    emptyState('Sin alumnos', 'Cargá alumnos del curso de arriba.', {
      ctaLabel: 'Ir a Alumnos',
      spaNav: 'registro',
    }),
  );
}

function renderInlineSubjects(list) {
  if (!list) return;
  renderTags(list, activeSubjects(), (subject) => subject.nombre, 'Sin materias');
}

function deliveryStatusLabel(status) {
  if (status === 'en_progreso') return 'En progreso';
  if (status === 'completado') return 'Completado';
  return 'Pendiente';
}

function deliveryStatusClass(status) {
  if (status === 'en_progreso') return 'warning';
  if (status === 'completado') return 'ok';
  return 'info';
}

function countStudentsInContext(courseId = '', subjectId = '') {
  return studentsInCiclo('', courseId).filter((student) =>
    studentHasSubject(student, subjectId)
  ).length;
}

function computeActivitySeguimiento(actividad, entregas = [], alumnosCount = 0) {
  const linked = entregas.filter((item) => item.actividad_id === actividad.id);
  const entregasCount = linked.length;
  const fecha = actividad.fecha_vencimiento || actividad.fecha_publicacion || '';
  const dueMs = fecha ? new Date(`${fecha}T23:59:59`).getTime() : null;
  const isPast = dueMs !== null && dueMs < Date.now();

  if (entregasCount <= 0) return isPast ? 'completado' : 'pendiente';
  if (alumnosCount > 0 && entregasCount >= alumnosCount) return 'completado';
  if (isPast && entregasCount > 0) return 'completado';
  return 'en_progreso';
}

async function fetchActividadesForContext(courseId = '', subjectId = '') {
  const course = courseById(courseId);
  const params = new URLSearchParams();
  params.set('ciclo', String(activeCicloLectivo()));
  if (course?.escuela) params.set('colegio', course.escuela);
  if (course?.turno) params.set('turno', course.turno);
  if (courseId) params.set('curso', courseId);
  if (subjectId) params.set('materia', subjectId);

  const response = await fetch(`/api/actividades?${params.toString()}`);
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.actividades) ? data.actividades : [];
}

async function fetchTrabajosForContext(courseId = '', subjectId = '', extra = {}) {
  const params = new URLSearchParams();
  if (courseId) params.set('curso', courseId);
  if (subjectId) params.set('materia', subjectId);
  if (extra.estado) params.set('estado', extra.estado);

  const response = await fetch(`/api/trabajos?${params.toString()}`);
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.entregas) ? data.entregas : [];
}

function filterUpcomingActivities(items, filters = {}) {
  const { tipo = '', estado = '', desde = '', hasta = '' } = filters;
  return items.filter((item) => {
    if (tipo && item.tipo !== tipo) return false;
    if (estado && item.seguimiento !== estado) return false;
    const fecha = item.fecha_vencimiento || item.fecha_publicacion || '';
    if (desde && fecha && fecha < desde) return false;
    if (hasta && fecha && fecha > hasta) return false;
    return true;
  });
}

async function renderUpcomingActivities(list, summary, subjectId = '', courseId = '', filters = {}, options = {}) {
  const { onActivitySelect } = options;
  if (!list) return;

  replaceContent(list, emptyState('Cargando actividades...'));

  const [actividades, entregas] = await Promise.all([
    fetchActividadesForContext(courseId, subjectId),
    fetchTrabajosForContext(courseId, subjectId),
  ]);

  const alumnosCount = countStudentsInContext(courseId, subjectId);
  const enriched = actividades.map((actividad) => {
    const linked = entregas.filter((item) => item.actividad_id === actividad.id);
    const seguimiento = computeActivitySeguimiento(actividad, entregas, alumnosCount);
    return { ...actividad, seguimiento, entregasCount: linked.length };
  });

  const items = filterUpcomingActivities(enriched, filters)
    .sort((a, b) => String(a.fecha_vencimiento || a.fecha_publicacion || a.created_at)
      .localeCompare(String(b.fecha_vencimiento || b.fecha_publicacion || b.created_at)));

  const proximas = items.filter((item) => {
    const fecha = item.fecha_vencimiento || item.fecha_publicacion;
    return fecha && new Date(`${fecha}T23:59:59`).getTime() >= Date.now();
  }).length;
  const enProgreso = items.filter((item) => item.seguimiento === 'en_progreso').length;

  if (summary) {
    renderPanelMetrics(summary, [
      { label: 'Total filtradas', value: items.length },
      { label: 'Próximas', value: proximas },
      { label: 'En progreso', value: enProgreso },
    ]);
  }

  if (!items.length) {
    replaceContent(list, emptyState('Sin actividades para este filtro', 'Creá una evaluación o TP.', {
      ctaLabel: 'Ir a Actividades',
      spaNav: 'actividades',
    }));
    return { actividades: enriched, entregas };
  }

  replaceContent(list, ...items.map((item) => {
    const fechaPublicacion = item.fecha_publicacion || '';
    const fechaEntrega = item.fecha_vencimiento || '';
    const fecha = fechaEntrega || fechaPublicacion || 'Sin fecha';
    const tipoLabel = item.tipo === 'tp' ? 'TP' : 'Evaluación';
    const proxima = item.fecha_vencimiento && new Date(`${item.fecha_vencimiento}T23:59:59`).getTime() >= Date.now();
    const cardClass = proxima ? 'event-card--warning' : item.seguimiento === 'completado' ? 'event-card--info' : '';
    const card = el('article', {
      className: `event-card grade-activity-card ${cardClass}`.trim(),
      ...(onActivitySelect ? {
        dataset: { gradeActivityId: item.id },
        attrs: { role: 'button', tabindex: '0', title: 'Usar esta actividad para cargar notas' },
      } : {}),
    },
      el('div', {},
        tag(tipoLabel),
        tag(deliveryStatusLabel(item.seguimiento), `tag ${deliveryStatusClass(item.seguimiento)}`),
        proxima ? tag('Próxima', 'tag warning') : null,
      ),
      el('strong', {}, item.titulo),
      el('small', {}, [item.colegio, item.turno, item.curso, item.materia].filter(Boolean).join(' · ')),
      el('p', {}, [
        fechaPublicacion ? `Publicación: ${fechaPublicacion}` : null,
        fechaEntrega ? `Entrega: ${fechaEntrega}` : null,
      ].filter(Boolean).join(' · ') || `Fecha: ${fecha}`),
      el('p', {}, `${item.entregasCount} entrega(s) · ${alumnosCount} alumno(s) en contexto`),
    );

    if (onActivitySelect) {
      const activate = () => onActivitySelect(item);
      card.addEventListener('click', activate);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });
    }

    return card;
  }));

  return { actividades: enriched, entregas };
}

function formatFileSize(bytes = 0) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatoDigitalTrabajo(archivo) {
  const name = String(archivo?.filename || '').toLowerCase();
  const mime = String(archivo?.mime_type || '').toLowerCase();
  return (
    mime === 'application/pdf' ||
    mime.includes('wordprocessingml') ||
    mime === 'text/plain' ||
    /\.(pdf|docx|txt)$/i.test(name)
  );
}

function parseCorreccionTrabajo(item) {
  if (item.correccion && typeof item.correccion === 'object') return item.correccion;
  if (typeof item.correccion_json === 'string' && item.correccion_json) {
    try {
      return JSON.parse(item.correccion_json);
    } catch {
      return null;
    }
  }
  return null;
}

function trabajoTieneCalificacion(item) {
  if (item.estado === 'calificado') return true;
  if (!item.alumno_id) return false;
  return read(KEYS.grades).some((grade) =>
    grade.studentId === item.alumno_id &&
    grade.subjectId === item.materia_id &&
    grade.titulo === item.titulo &&
    (grade.valor !== null && grade.valor !== '' || grade.calificacionTexto)
  );
}

function trabajoEstadoLabel(item) {
  return trabajoTieneCalificacion(item) ? 'Calificado' : 'Pendiente de calificar';
}

async function renderTrabajoHistory(list, courseId = '', subjectId = '', estado = '') {
  if (!list) return [];
  replaceContent(list, emptyState('Cargando trabajos...'));

  let entregas = await fetchTrabajosForContext(courseId, subjectId, estado === 'enviado' ? { estado } : {});
  if (estado === 'calificado') {
    entregas = entregas.filter((item) => trabajoTieneCalificacion(item));
  } else if (estado === 'enviado') {
    entregas = entregas.filter((item) => !trabajoTieneCalificacion(item));
  }

  if (!entregas.length) {
    replaceContent(list, emptyState(
      'Sin trabajos cargados',
      'En Recibir entregas: elegí actividad, alumno y un PDF/DOCX/TXT.',
      {
        ctaLabel: 'Ir a recibir entregas',
        onClick: () => {
          showSpaView('actividades');
          openActivityFlowTab('entregas');
          document.querySelector('[data-entregas-root] [data-trabajo-upload-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      },
    ));
    return entregas;
  }

  const students = studentsInCiclo('', courseId).filter((student) =>
    studentHasSubject(student, subjectId)
  );

  replaceContent(list, ...entregas.map((item) => {
    const archivos = Array.isArray(item.archivos) ? item.archivos : [];
    const tieneDigital = archivos.some(formatoDigitalTrabajo);
    const correccion = parseCorreccionTrabajo(item);
    const calificado = trabajoTieneCalificacion(item);
    const puedeCorregir = Boolean(item.alumno_id) && tieneDigital;

    const archivosNodes = archivos.length
      ? archivos.map((archivo) =>
        el('span', { className: 'tag' },
          `${archivo.filename} (${formatFileSize(archivo.size_bytes)}) `,
          el('a', { href: `/api/trabajos/archivos/${archivo.id}`, target: '_blank', rel: 'noopener' }, 'Descargar'),
          ' ',
          el('a', { href: `/api/trabajos/archivos/${archivo.id}?preview=1`, target: '_blank', rel: 'noopener' }, 'Vista previa'),
        ),
      )
      : [tag('Sin archivos')];

    const feedbackNodes = [];
    if (correccion) {
      const items = Array.isArray(correccion.items) ? correccion.items : [];
      feedbackNodes.push(
        el('details', { className: 'trabajo-correccion-details' },
          el('summary', {}, `Nota IA: ${correccion.nota}/10 — ${String(correccion.resumen || '').slice(0, 120)}${String(correccion.resumen || '').length > 120 ? '…' : ''}`),
          el('p', {}, correccion.resumen || ''),
          items.length
            ? el('ul', {}, ...items.map((row) =>
              el('li', {}, `${row.criterio || 'Criterio'}: ${row.comentario || ''} (${Math.round(Number(row.puntaje || 0) * 100)}%)`),
            ))
            : null,
        ),
      );
    }

    if (!item.alumno_id) {
      feedbackNodes.push(
        el('p', { className: 'muted' }, 'Falta vincular un alumno para habilitar Corregir con IA.'),
      );
    } else if (!tieneDigital) {
      feedbackNodes.push(
        el('p', { className: 'muted' }, 'Para Corregir con IA hace falta un PDF, DOCX o TXT (las fotos no se corrigen aún).'),
      );
    }

    const actions = [
      el('button', { className: 'btn btn-secondary btn-sm', type: 'button', dataset: { reenviarTrabajo: item.id } }, 'Reenviar'),
    ];

    if (!item.alumno_id && students.length) {
      actions.push(
        el('select', {
          className: 'input-inline',
          dataset: { vincularAlumnoEntrega: item.id },
          attrs: { 'aria-label': 'Vincular alumno' },
        },
          el('option', { value: '' }, 'Vincular alumno…'),
          ...students.map((student) => el('option', { value: student.id }, student.nombre || student.id)),
        ),
      );
    }

    if (puedeCorregir) {
      actions.push(
        el('button', {
          className: 'btn btn-primary btn-sm',
          type: 'button',
          dataset: { corregirTrabajo: item.id },
        }, calificado || correccion ? 'Re-corregir con IA' : 'Corregir con IA'),
      );
    } else if (tieneDigital && !item.alumno_id) {
      actions.push(
        el('button', {
          className: 'btn btn-primary btn-sm',
          type: 'button',
          disabled: true,
          title: 'Primero vinculá un alumno con el selector de esta tarjeta',
        }, 'Corregir con IA'),
      );
    }

    return el('article', { className: 'student-row' },
      el('div', {},
        el('strong', {}, item.titulo),
        el('small', {}, [item.curso, item.materia, item.alumno || 'Sin alumno'].filter(Boolean).join(' · ')),
        el('small', {}, `${item.submitted_at?.slice(0, 10) || ''} · ${trabajoEstadoLabel(item)}`),
        ...feedbackNodes,
      ),
      el('div', { className: 'notes-list' }, ...archivosNodes),
      el('div', { className: 'actions-group' }, ...actions),
    );
  }));

  return entregas;
}

function fillActividadSelect(select, actividades = [], options = {}) {
  if (!select) return;
  const {
    cursoId = '',
    materiaId = '',
    placeholder = 'Sin vincular',
    required = false,
  } = options;
  const current = select.value;
  const filtered = actividades.filter((item) =>
    (!cursoId || item.curso_id === cursoId) &&
    (!materiaId || item.materia_id === materiaId)
  );
  fillSelectOptions(
    select,
    filtered,
    placeholder,
    'id',
    (item) => `${item.titulo} (${activityTipoLabel(item)})`,
  );
  select.required = required;
  if (current && filtered.some((item) => item.id === current)) select.value = current;
}

function initTrabajosEntregas(root, context = {}) {
  if (!root) return { refresh: async () => {} };

  const trabajoForm = root.querySelector('[data-trabajo-upload-form]');
  const trabajoFilesInput = root.querySelector('[data-trabajo-files]');
  const trabajoFileFeedback = root.querySelector('[data-trabajo-file-feedback]');
  const trabajoActividadSelect = root.querySelector('[data-trabajo-actividad-select]');
  const trabajoAlumnoSelect = root.querySelector('[data-trabajo-alumno-select]');
  const trabajoHistory = root.querySelector('[data-trabajo-history]');
  const trabajoEstadoFilter = root.querySelector('[data-trabajo-estado-filter]');
  const reenviarDialog = root.querySelector('[data-trabajo-reenviar-dialog]');
  const reenviarForm = root.querySelector('[data-trabajo-reenviar-form]');
  const reenviarCurso = root.querySelector('[data-reenviar-curso]');
  const reenviarMateria = root.querySelector('[data-reenviar-materia]');
  const reenviarAlumno = root.querySelector('[data-reenviar-alumno]');

  const getCourseId = () => context.getCourseId?.() || getTeachingContext().cursoId || '';
  const getMateriaId = () => context.getMateriaId?.() || getTeachingContext().materiaId || '';
  const getCourse = () => context.getCourse?.() || courseById(getCourseId());
  const getSubject = () => context.getSubject?.() || subjectById(getMateriaId());
  const getActividades = () => context.getActividades?.() || [];

  const refreshStudentOptions = () => {
    if (!trabajoAlumnoSelect) return;
    const students = studentsInCiclo('', getCourseId()).filter((student) =>
      studentHasSubject(student, getMateriaId())
    );
    fillSelect(trabajoAlumnoSelect, students, 'Elegí un alumno');
    trabajoAlumnoSelect.required = true;
  };

  const refresh = async () => {
    const cursoId = getCourseId();
    const materiaId = getMateriaId();
    if (!cursoId || !materiaId) {
      fillActividadSelect(trabajoActividadSelect, [], {
        placeholder: 'Elegí curso y materia arriba',
        required: Boolean(trabajoActividadSelect),
      });
      if (trabajoHistory) {
        replaceContent(trabajoHistory, emptyState('Elegí curso y materia', 'Usá “Curso actual” arriba.', {
          ctaLabel: 'Cambiar curso',
          onClick: () => document.querySelector('[data-gtc-toggle]')?.click(),
        }));
      }
      return;
    }

    refreshStudentOptions();
    const actividades = await fetchActividadesForContext(cursoId, materiaId);
    context.setActividades?.(actividades);
    if (trabajoActividadSelect) {
      fillActividadSelect(trabajoActividadSelect, actividades, {
        cursoId,
        materiaId,
        placeholder: 'Elegí una actividad',
        required: true,
      });
    }
    await renderTrabajoHistory(
      trabajoHistory,
      cursoId,
      materiaId,
      trabajoEstadoFilter?.value || '',
    );
  };

  fillSelect(reenviarCurso, visibleCourses(), 'Elegir curso', 'id', courseLabel);
  fillSelect(reenviarMateria, activeSubjects(), 'Elegir materia');

  reenviarCurso?.addEventListener('change', () => {
    const students = studentsInCiclo('', reenviarCurso.value);
    fillSelect(reenviarAlumno, students, 'Sin alumno específico');
  });

  trabajoEstadoFilter?.addEventListener('change', () => { refresh(); });

  if (trabajoForm) {
    trabajoFilesInput?.addEventListener('change', () => {
      validateTrabajoFiles(trabajoFilesInput, trabajoFileFeedback, {
        maxFiles: Number(trabajoForm.dataset.maxFiles || 5),
        maxFileMb: Number(trabajoForm.dataset.maxFileMb || 15),
      });
    });

    trabajoActividadSelect?.addEventListener('change', () => {
      const actividad = getActividades().find((item) => item.id === trabajoActividadSelect.value);
      const tituloInput = trabajoForm.querySelector('[name="titulo"]');
      if (actividad && tituloInput && !tituloInput.value.trim()) {
        tituloInput.value = actividad.titulo;
      }
    });

    trabajoForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const course = getCourse();
      const subject = getSubject();
      const cursoId = getCourseId();
      const materiaId = getMateriaId();
      if (!course || !materiaId) {
        showAppToast('Elegí curso y materia en “Curso actual” antes de cargar un trabajo.', 'warning');
        return;
      }

      const fileCheck = validateTrabajoFiles(trabajoFilesInput, trabajoFileFeedback, {
        maxFiles: Number(trabajoForm.dataset.maxFiles || 5),
        maxFileMb: Number(trabajoForm.dataset.maxFileMb || 15),
      });
      if (!fileCheck.ok) return;

      const data = Object.fromEntries(new FormData(trabajoForm));
      if (!data.actividadId) {
        showAppToast('Elegí la actividad del curso a la que corresponde la entrega.', 'warning');
        return;
      }
      if (!data.alumnoId) {
        showAppToast('Elegí el alumno de la entrega para poder corregir con IA.', 'warning');
        return;
      }

      const payload = new FormData();
      payload.set('cursoId', cursoId);
      payload.set('materiaId', materiaId);
      payload.set('colegio', course.escuela || context.getColegio?.() || getTeachingContext().escuela || '');
      payload.set('turno', course.turno || context.getTurno?.() || getTeachingContext().turno || '');
      payload.set('cursoNombre', course.nombre || '');
      payload.set('materiaNombre', subject?.nombre || '');
      payload.set('titulo', String(data.titulo || '').trim());
      payload.set('actividadId', data.actividadId);
      if (data.alumnoId) payload.set('alumnoId', data.alumnoId);
      if (data.observaciones) payload.set('observaciones', data.observaciones);
      fileCheck.files.forEach((file) => payload.append('archivos', file));

      const submitBtn = root.querySelector('[data-trabajo-submit]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const response = await fetch('/api/trabajos', { method: 'POST', body: payload });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'No se pudo cargar el trabajo.');

        trabajoForm.reset();
        if (trabajoFileFeedback) {
          trabajoFileFeedback.textContent = '';
          trabajoFileFeedback.classList.add('is-hidden');
        }
        await refresh();
        context.onUploaded?.();
        showAppToast('Trabajo cargado con éxito.', 'ok');
      } catch (error) {
        showAppToast(error instanceof Error ? error.message : 'Error al cargar el trabajo.', 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  trabajoHistory?.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-vincular-alumno-entrega]');
    if (!select || !select.value) return;
    const entregaId = select.dataset.vincularAlumnoEntrega;
    const alumnoId = select.value;
    select.disabled = true;
    try {
      const response = await fetch('/api/trabajos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entregaId, alumnoId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo vincular el alumno.');
      showAppToast('Alumno vinculado. Ya podés corregir con IA.', 'ok');
      await refresh();
      context.onUploaded?.();
    } catch (error) {
      showAppToast(error instanceof Error ? error.message : 'Error al vincular alumno.', 'error');
      select.value = '';
    } finally {
      select.disabled = false;
    }
  });

  trabajoHistory?.addEventListener('click', async (event) => {
    const corregirBtn = event.target.closest('[data-corregir-trabajo]');
    if (corregirBtn) {
      const entregaId = corregirBtn.dataset.corregirTrabajo;
      if (!entregaId) return;
      const originalLabel = corregirBtn.textContent;
      corregirBtn.disabled = true;
      corregirBtn.textContent = 'Corrigiendo…';
      try {
        const response = await fetch('/api/trabajos/corregir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entregaId }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'No se pudo corregir la entrega.');

        if (currentUser?.id) {
          await hydrateLocalStorageFromServer(currentUser.id, { notify: false });
        }
        notifyDataChanged({ scope: 'grades' });
        await refresh();
        context.onUploaded?.();
        showAppToast(`Corrección lista: nota ${result.nota}/10.`, 'ok');
      } catch (error) {
        showAppToast(error instanceof Error ? error.message : 'Error al corregir con IA.', 'error');
      } finally {
        corregirBtn.disabled = false;
        corregirBtn.textContent = originalLabel;
      }
      return;
    }

    const button = event.target.closest('[data-reenviar-trabajo]');
    if (!button || !reenviarDialog || !reenviarForm) return;

    reenviarForm.reenviarDesdeId.value = button.dataset.reenviarTrabajo;
    reenviarForm.titulo.value = button.closest('.student-row')?.querySelector('strong')?.textContent || '';
    if (reenviarCurso) reenviarCurso.value = getCourseId();
    if (reenviarMateria) reenviarMateria.value = getMateriaId();
    reenviarCurso?.dispatchEvent(new Event('change'));
    reenviarDialog.showModal();
  });

  reenviarForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    if (!submitter || submitter.value === 'cancel') {
      reenviarDialog?.close();
      return;
    }

    const data = Object.fromEntries(new FormData(reenviarForm));
    const course = courseById(data.cursoId);
    const subject = subjectById(data.materiaId);
    if (!course || !data.materiaId || !data.titulo?.trim()) {
      showAppToast('Completá curso, materia y título.', 'warning');
      return;
    }

    const payload = new FormData();
    payload.set('reenviarDesdeId', data.reenviarDesdeId);
    payload.set('cursoId', data.cursoId);
    payload.set('materiaId', data.materiaId);
    payload.set('colegio', course.escuela || '');
    payload.set('turno', course.turno || '');
    payload.set('cursoNombre', course.nombre || '');
    payload.set('materiaNombre', subject?.nombre || '');
    payload.set('titulo', data.titulo.trim());
    if (data.alumnoId) payload.set('alumnoId', data.alumnoId);

    try {
      const response = await fetch('/api/trabajos', { method: 'POST', body: payload });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo reenviar el trabajo.');
      reenviarDialog?.close();
      await refresh();
      context.onUploaded?.();
    } catch (error) {
      showAppToast(error instanceof Error ? error.message : 'Error al reenviar.', 'error');
    }
  });

  return {
    refresh,
    openForActividad(actividadId) {
      const id = String(actividadId || '');
      if (!id || !trabajoActividadSelect) return false;

      const actividad = getActividades().find((item) => String(item.id) === id);
      if (!actividad) {
        showAppToast('No se encontró la actividad en el curso actual. Revisá “Curso actual”.', 'warning');
        return false;
      }

      if (![...trabajoActividadSelect.options].some((option) => option.value === id)) {
        trabajoActividadSelect.appendChild(
          new Option(`${actividad.titulo} (${activityTipoLabel(actividad)})`, id),
        );
      }
      trabajoActividadSelect.value = id;
      trabajoActividadSelect.dispatchEvent(new Event('change'));

      const tituloInput = trabajoForm?.querySelector('[name="titulo"]');
      if (tituloInput) tituloInput.value = actividad.titulo || '';
      return true;
    },
  };
}

function validateTrabajoFiles(input, feedback, limits = {}) {
  const maxFiles = Number(limits.maxFiles || 5);
  const maxMb = Number(limits.maxFileMb || 15);
  const maxBytes = maxMb * 1024 * 1024;
  const allowedExt = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.txt'];
  const files = Array.from(input?.files || []);

  if (!files.length) {
    if (feedback) {
      feedback.textContent = '';
      feedback.classList.add('is-hidden');
    }
    return { ok: true, files: [] };
  }

  if (files.length > maxFiles) {
    const msg = `Máximo ${maxFiles} archivos por carga.`;
    if (feedback) {
      feedback.textContent = msg;
      feedback.classList.remove('is-hidden');
    }
    return { ok: false, error: msg };
  }

  for (const file of files) {
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    if (file.size > maxBytes) {
      const msg = `"${file.name}" supera ${maxMb} MB.`;
      if (feedback) {
        feedback.textContent = msg;
        feedback.classList.remove('is-hidden');
      }
      return { ok: false, error: msg };
    }
    if (!allowedExt.includes(ext)) {
      const msg = `"${file.name}" tiene un formato no permitido.`;
      if (feedback) {
        feedback.textContent = msg;
        feedback.classList.remove('is-hidden');
      }
      return { ok: false, error: msg };
    }
  }

  if (feedback) {
    feedback.textContent = `${files.length} archivo(s) listo(s) para cargar.`;
    feedback.classList.remove('is-hidden');
  }
  return { ok: true, files };
}

function initSubjects() {
  const root = document.querySelector('[data-subjects]');
  if (!root) return;
  const form = root.querySelector('[data-subject-form]');
  const list = root.querySelector('[data-subject-list]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const editingId = form.dataset.editingId;
    const payload = { id: editingId || uid('mat'), nombre: data.nombre.trim(), activo: true, updatedAt: nowIso() };
    const subjects = read(KEYS.subjects);
    write(KEYS.subjects, editingId ? subjects.map((subject) => subject.id === editingId ? payload : subject) : [...subjects, payload]);
    form.reset();
    delete form.dataset.editingId;
    form.querySelector('button[type="submit"]').textContent = 'Crear materia';
    await persistAndRefresh('subject', 'upsert', payload, () => renderSubjects(list, form));
  });

  list.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-subject]');
    const remove = event.target.closest('[data-delete-subject]');
    const subjects = read(KEYS.subjects);
    if (edit) {
      const subject = subjects.find((item) => item.id === edit.dataset.editSubject);
      if (!subject) return;
      form.dataset.editingId = subject.id;
      form.nombre.value = subject.nombre;
      form.querySelector('button[type="submit"]').textContent = 'Actualizar materia';
    }
    if (remove) {
      const id = remove.dataset.deleteSubject;
      const previous = subjects.find((subject) => subject.id === id);
      if (!previous) return;
      write(KEYS.subjects, subjects.map((subject) => subject.id === id ? { ...subject, activo: false, updatedAt: nowIso() } : subject));
      await persistAndRefresh('subject', 'delete', { id, updatedAt: nowIso() }, () => renderSubjects(list, form));
      showAppToast('Materia desactivada.', 'ok', {
        actionLabel: 'Deshacer',
        onAction: async () => {
          write(KEYS.subjects, read(KEYS.subjects).map((subject) =>
            subject.id === id ? { ...previous, activo: true, updatedAt: nowIso() } : subject
          ));
          await persistAndRefresh('subject', 'upsert', { ...previous, activo: true, updatedAt: nowIso() }, () => renderSubjects(list, form));
          showAppToast('Materia restaurada.', 'ok');
        },
      });
    }
  });

  renderSubjects(list, form);
  onPanelRefresh(() => renderSubjects(list, form));
}

function renderSubjects(list) {
  const subjects = activeSubjects();
  const grades = read(KEYS.grades);
  replaceContent(list, ...subjects.map((subject) => {
    const count = grades.filter((grade) => grade.subjectId === subject.id).length;
    return el('article', { className: 'course-row' },
      el('div', {},
        el('strong', {}, subject.nombre),
        el('small', {}, `${count} notas vinculadas`),
      ),
      el('div', { className: 'row-actions' },
        tag('Activa'),
        el('button', { className: 'btn btn-ghost', dataset: { editSubject: subject.id } }, 'Editar'),
        el('button', { className: 'btn btn-danger', dataset: { deleteSubject: subject.id } }, 'Eliminar'),
      ),
    );
  }));
}

function initCourses() {
  const root = document.querySelector('[data-courses]');
  if (!root) return;
  const form = root.querySelector('[data-course-form]');
  const newSchoolInput = root.querySelector('[data-new-school]');
  const addSchoolButton = root.querySelector('[data-add-school]');

  const refreshCoursePanel = (selectedSchool = '', highlightCourseId = '') => {
    renderSchoolTags(root.querySelector('[data-school-list]'));
    fillSchoolSelect(root.querySelector('[data-course-school]'), 'Seleccionar escuela', selectedSchool);
    renderCourses(root.querySelector('[data-course-list]'), highlightCourseId);
  };

  const addSchoolFromInput = async () => {
    const schoolPayload = await upsertSchoolByName(newSchoolInput?.value);
    if (!schoolPayload) {
      newSchoolInput?.focus();
      return;
    }
    if (newSchoolInput) newSchoolInput.value = '';
    refreshCoursePanel(schoolPayload.nombre);
  };

  window.addEventListener('aula-clara:schools-changed', (event) => {
    refreshCoursePanel(event.detail?.selected || '');
  });

  addSchoolButton?.addEventListener('click', () => { void addSchoolFromInput(); });
  newSchoolInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addSchoolFromInput();
    }
  });

  refreshCoursePanel();

  initSimpleExcelImport(root, async (importType) => {
    if (importType !== 'cursos') return;
    refreshCoursePanel();
    window.dispatchEvent(new CustomEvent('aula-clara:schools-changed'));
    notifyDataChanged({ scope: 'course' });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!appReady) return;
    clearFieldErrors(form);
    const data = Object.fromEntries(new FormData(form));
    const escuela = String(data.escuela || '').trim();
    const nombre = String(data.nombre || '').trim();
    const turno = String(data.turno || '').trim();
    if (!escuela) {
      setFieldError(form.escuela, 'Elegí una escuela.');
      focusFirstInvalid(form);
      return;
    }
    if (!nombre) {
      setFieldError(form.nombre, 'Completá el nombre del curso.');
      focusFirstInvalid(form);
      return;
    }
    if (!turno) {
      setFieldError(form.turno, 'Elegí un turno.');
      focusFirstInvalid(form);
      return;
    }
    const courses = read(KEYS.courses);
    const payload = {
      id: uid('curso'),
      nombre,
      escuela,
      turno,
      cicloLectivo: activeCicloLectivo(),
      subjectIds: [],
      updatedAt: nowIso(),
    };
    courses.push(payload);
    write(KEYS.courses, courses);
    form.reset();
    await persistAndRefresh('course', 'upsert', payload, () => refreshCoursePanel('', payload.id));
    showAppToast('Curso creado.', 'ok');
  });

  onPanelRefresh(() => refreshCoursePanel());
}

function renderCourses(list, highlightCourseId = '') {
  if (!list) return;
  const courses = visibleCourses();
  const students = studentsInCiclo();
  const subjects = activeSubjects();
  if (!courses.length) {
    replaceContent(list, emptyState('No hay cursos en este ciclo', `Creá una división para el ciclo ${activeCicloLectivo()}.`, {
      ctaLabel: 'Crear curso',
      spaNav: 'cursos',
    }));
    return;
  }
  replaceContent(list, ...courses.map((course) => {
    const courseStudents = students.filter((student) => student.cursoId === course.id);
    const courseSubjects = courseSubjectsForDisplay(course);
    const defaultSubjectId = courseSubjects[0]?.id || subjects[0]?.id || '';
    const actionContext = { curso: course.id, materia: defaultSubjectId };
    const isHighlighted = highlightCourseId && course.id === highlightCourseId;
    return el('details', {
      className: 'course-accordion',
      ...(isHighlighted ? { attrs: { open: '' } } : {}),
    },
      el('summary', {},
        el('span', {},
          el('strong', {}, course.nombre),
          el('small', {}, `${course.escuela} · Turno ${course.turno} · Ciclo ${resolveCourseCiclo(course)}`),
        ),
        tag(`${courseStudents.length} alumnos`),
      ),
      el('div', { className: 'course-detail' },
        el('div', {},
          el('h3', {}, 'Alumnos'),
          el('div', { className: 'notes-list' },
            courseStudents.length
              ? courseStudents.map((student) => tag(student.nombre))
              : tag('Sin alumnos'),
          ),
        ),
        el('div', {},
          el('h3', {}, 'Materias'),
          el('div', { className: 'notes-list' }, ...courseSubjects.map((subject) => tag(subject.nombre))),
        ),
        el('div', { className: 'button-row' },
          el('a', { className: 'btn btn-primary', href: contextUrl('/asistencia', actionContext) }, 'Tomar asistencia'),
          el('a', { className: 'btn btn-secondary', href: contextUrl('/notas', actionContext) }, 'Calificaciones'),
        ),
      ),
    );
  }));
}

function getCalendarEventMeta(tipo = '') {
  const normalized = String(tipo);
  const meta = {
    evaluacion: { icon: '📝', label: 'Evaluación', tone: 'neutral' },
    tp: { icon: '📘', label: 'TP', tone: 'neutral' },
    cierre_tp: { icon: '📤', label: 'Entrega', tone: 'neutral' },
    asistencia: { icon: '🧾', label: 'Asistencia', tone: 'neutral' },
    nota: { icon: '🏷️', label: 'Nota', tone: 'neutral' },
    evento: { icon: '📅', label: 'Evento', tone: 'neutral' },
    ausencia: { icon: '✖', label: 'Falta docente', tone: 'danger' },
    lluvia: { icon: '🌧️', label: 'Día de lluvia', tone: 'info' },
    salida_educativa: { icon: '🚌', label: 'Salida educativa', tone: 'warning' },
    acto: { icon: '🏛️', label: 'Acto escolar', tone: 'warning' },
    jornada: { icon: '⏱️', label: 'Jornada institucional', tone: 'warning' },
  };
  return meta[normalized] || { icon: '📅', label: 'Evento', tone: 'neutral' };
}

function getCalendarEventIcon(tipo) {
  return getCalendarEventMeta(tipo).icon;
}

function getCalendarEventLabel(tipo) {
  return getCalendarEventMeta(tipo).label;
}

function getCalendarEventTone(tipo) {
  return getCalendarEventMeta(tipo).tone;
}

function getCalendarDayTone(events = []) {
  if (events.some((event) => event.tipo === 'ausencia')) return 'danger';
  if (events.some((event) => event.tipo === 'lluvia')) return 'info';
  if (events.some((event) => ['salida_educativa', 'acto', 'jornada'].includes(event.tipo))) return 'warning';
  return 'neutral';
}

function buildTeacherScheduleEvents(monthStart, monthEnd, courseId = '', subjectId = '') {
  const activeCiclo = activeCicloLectivo();
  const contexts = read(KEYS.teacherContext).filter((item) => {
    const itemCiclo = item.cicloLectivo ?? resolveCourseCiclo(courseById(item.cursoId));
    if (itemCiclo !== activeCiclo) return false;
    if (courseId && item.cursoId !== courseId) return false;
    if (subjectId && item.materiaId !== subjectId) return false;
    return true;
  });

  const start = new Date(monthStart);
  const end = new Date(monthEnd);
  const events = [];

  for (const context of contexts) {
    const course = courseById(context.cursoId);
    const subject = subjectById(context.materiaId);
    const days = Array.isArray(context.dias) ? context.dias.map(String) : [];
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const day = String(cursor.getDay());
      if (!days.includes(day)) continue;
      const fecha = cursor.toISOString().slice(0, 10);
      events.push({
        id: `horario-${context.id}-${fecha}`,
        tipo: 'evento',
        titulo: `Horario: ${subject?.nombre || 'Materia'} ${context.desde || ''} - ${context.hasta || ''}`.trim(),
        descripcion: `${context.escuela || course?.escuela || 'Escuela'} · ${course?.nombre || 'Curso'}`,
        fecha,
        fecha_fin: null,
        curso: course?.nombre || '',
        colegio: context.escuela || course?.escuela || '',
        materia: subject?.nombre || '',
        source_type: 'horarios',
        source_id: context.id,
      });
    }
  }

  return events;
}

let lastCalendarAlertPrefs = null;

function isSpaViewVisible(root) {
  const view = root.closest('[data-spa-view]');
  return !view || !view.classList.contains('spa-view--hidden');
}

function maybeShowCalendarOptIn(root) {
  const modal = root.querySelector('[data-calendar-opt-in]');
  if (!modal || modal.open) return;
  if (!isSpaViewVisible(root)) return;
  if (lastCalendarAlertPrefs?.calendar_alerts) return;
  if (localStorage.getItem(storageKey('aula_clara_calendar_alerts_dismissed'))) return;
  modal.showModal?.();
}

function ensureCalendarOptInNotBlocking(root) {
  const modal = root.querySelector('[data-calendar-opt-in]');
  if (modal?.open && !isSpaViewVisible(root)) modal.close();
}

function initCalendar() {
  const root = document.querySelector('[data-calendar]');
  if (!root) return;

  const monthInput = root.querySelector('[data-calendar-month]');
  const courseSelect = root.querySelector('[data-calendar-course]');
  const subjectSelect = root.querySelector('[data-calendar-subject]');
  const eventForm = root.querySelector('[data-calendar-event-form]');
  const eventTypeSelect = eventForm?.querySelector('[name="tipo"]');
  const eventDateInput = eventForm?.querySelector('[name="fecha"]');
  const eventCourseSelect = eventForm?.querySelector('[name="cursoId"]');
  const eventSubjectSelect = eventForm?.querySelector('[name="materiaId"]');
  const modal = root.querySelector('[data-calendar-opt-in]');
  const leadDays = root.querySelector('[data-calendar-lead-days]');
  const acceptAlerts = root.querySelector('[data-calendar-alerts-accept]');
  const dismissAlerts = root.querySelector('[data-calendar-alerts-dismiss]');

  monthInput.value = today().slice(0, 7);
  if (eventDateInput) eventDateInput.value = today();

      fillSelect(courseSelect, visibleCourses(), 'Todos los cursos', 'id', courseLabel);
  fillSelect(subjectSelect, activeSubjects(), 'Todas las materias');
  fillSelect(eventCourseSelect, visibleCourses(), 'Sin curso', 'id', courseLabel);
  fillSelect(eventSubjectSelect, activeSubjects(), 'Sin materia');

  applySelectFromUrl(courseSelect, 'curso');
  applySelectFromUrl(subjectSelect, 'materia');
  applyTeachingContextTo({ course: courseSelect, subject: subjectSelect });
  applySuggestedContextTo({ course: courseSelect, subject: subjectSelect });

  if (eventTypeSelect) {
    eventTypeSelect.value = 'ausencia';
  }

  const load = () => loadCalendar(root, monthInput.value, courseSelect.value, subjectSelect.value);
  [monthInput, courseSelect, subjectSelect].forEach((control) => control.addEventListener('change', load));

  window.addEventListener('aula-clara:teaching-context-changed', () => {
    applyTeachingContextTo({ course: courseSelect, subject: subjectSelect });
    load();
  });

  eventForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(eventForm));
    const tipo = String(data.tipo || 'ausencia');
    const fecha = String(data.fecha || today());
    const titulo = String(data.titulo || '').trim();
    const descripcion = String(data.descripcion || '').trim();

    const payload = {
      tipo,
      fecha,
      cursoId: String(data.cursoId || ''),
      materiaId: String(data.materiaId || ''),
      titulo,
      descripcion,
      fecha_fin: fecha,
    };

    const response = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarEvent: payload }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      showAppToast(error.error || 'No se pudo guardar el evento.', 'error');
      return;
    }

    eventForm.reset();
    showAppToast('Evento guardado.', 'ok');
    if (eventDateInput) eventDateInput.value = fecha;
    if (eventTypeSelect) eventTypeSelect.value = 'ausencia';
    if (courseSelect.value && eventCourseSelect) eventCourseSelect.value = courseSelect.value;
    if (subjectSelect.value && eventSubjectSelect) eventSubjectSelect.value = subjectSelect.value;
    await loadCalendar(root, monthInput.value, courseSelect.value, subjectSelect.value);
  });

  acceptAlerts?.addEventListener('click', async (event) => {
    event.preventDefault();
    await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarAlerts: true, leadDays: Number(leadDays.value || 3) }),
    });
    modal?.close();
  });

  dismissAlerts?.addEventListener('click', (event) => {
    event.preventDefault();
    localStorage.setItem(storageKey('aula_clara_calendar_alerts_dismissed'), '1');
    modal?.close();
  });

  ensureCalendarOptInNotBlocking(root);
  registerSpaViewRefresh('actividades', () => maybeShowCalendarOptIn(root));

  load();
  onPanelRefresh(() => {
    fillSelect(courseSelect, visibleCourses(), 'Todos los cursos', 'id', courseLabel);
    fillSelect(subjectSelect, activeSubjects(), 'Todas las materias');
    fillSelect(eventCourseSelect, visibleCourses(), 'Sin curso', 'id', courseLabel);
    fillSelect(eventSubjectSelect, activeSubjects(), 'Sin materia');
    load();
  });
}

async function loadCalendar(root, monthValue, courseId = '', subjectId = '') {
  const [year, month] = monthValue.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const params = new URLSearchParams({
    desde: start.toISOString().slice(0, 10),
    hasta: end.toISOString().slice(0, 10),
    ciclo: String(activeCicloLectivo()),
  });
  if (courseId) params.set('curso', courseId);
  if (subjectId) params.set('materia', subjectId);

  const response = await fetch(`/api/calendar?${params.toString()}`);
  if (!response.ok) return;
  const data = await response.json();
  const events = Array.isArray(data.events) ? data.events : [];
  const scheduleEvents = buildTeacherScheduleEvents(start, end, courseId, subjectId);

  lastCalendarAlertPrefs = data.preferences || null;
  ensureCalendarOptInNotBlocking(root);
  maybeShowCalendarOptIn(root);

  renderCalendar(root, start, [...events, ...scheduleEvents]);
}

function renderCalendarMobileList(root, monthStart, eventsByDate, showDay) {
  const listRoot = root.querySelector('[data-calendar-mobile-list]');
  if (!listRoot) return;

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayGroups = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const key = date.toISOString().slice(0, 10);
    const dayItems = eventsByDate[key] || [];
    if (dayItems.length) dayGroups.push({ key, date, dayItems });
  }

  if (!dayGroups.length) {
    replaceContent(listRoot, emptyState('Sin eventos', 'No hay eventos programados este mes.'));
    return;
  }

  replaceContent(listRoot,
    ...dayGroups.map(({ key, date, dayItems }) => {
      const tone = getCalendarDayTone(dayItems);
      const isToday = key === today();
      return el('article', {
        className: `calendar-mobile-day ${tone ? `is-${tone}` : ''} ${isToday ? 'is-today' : ''}`.trim(),
      },
        el('button', {
          type: 'button',
          className: 'calendar-mobile-day-head',
          dataset: { calendarDay: key },
        },
          el('div', { className: 'calendar-mobile-day-title' },
            el('strong', {}, date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' })),
            isToday ? el('span', { className: 'tag info' }, 'Hoy') : null,
          ),
          el('span', { className: 'calendar-mobile-day-count' }, `${dayItems.length} evento${dayItems.length !== 1 ? 's' : ''}`),
        ),
        el('div', { className: 'calendar-mobile-events' },
          ...dayItems.map((event) => {
            const meta = getCalendarEventMeta(event.tipo);
            return el('button', {
              type: 'button',
              className: `calendar-mobile-event calendar-mobile-event--${meta.tone}`,
              dataset: { calendarDay: key },
            },
              el('span', { className: 'calendar-event-emoji' }, meta.icon),
              el('span', { className: 'calendar-mobile-event-body' },
                el('strong', {}, event.titulo),
                el('small', {}, [event.colegio, event.curso, event.materia].filter(Boolean).join(' · ')),
              ),
            );
          }),
        ),
      );
    }),
  );

  listRoot.querySelectorAll('[data-calendar-day]').forEach((button) => {
    button.addEventListener('click', () => {
      showDay(button.dataset.calendarDay);
      root.querySelector('.calendar-day-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function renderCalendar(root, monthStart, events) {
  const grid = root.querySelector('[data-calendar-grid]');
  const title = root.querySelector('[data-calendar-selected-title]');
  const summary = root.querySelector('[data-calendar-selected-summary]');
  const dayEvents = root.querySelector('[data-calendar-day-events]');
  const first = new Date(monthStart);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);

  const eventsByDate = events.reduce((acc, event) => {
    const key = String(event.fecha || '').slice(0, 10);
    if (!key) return acc;
    acc[key] ||= [];
    acc[key].push(event);
    return acc;
  }, {});

  const dayButtons = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    const dayItems = eventsByDate[key] || [];
    const outside = date.getMonth() !== monthStart.getMonth();
    const tone = getCalendarDayTone(dayItems);
    return el('button', {
      className: `calendar-day ${outside ? 'is-outside' : ''} ${tone ? `is-${tone}` : ''}`.trim(),
      type: 'button',
      dataset: { calendarDay: key },
    },
      el('strong', {}, date.getDate()),
      el('span', {}, dayItems.length ? `${dayItems.length} eventos` : ''),
      el('div', { className: 'calendar-day-items' },
        ...dayItems.slice(0, 2).map((event) => {
          const meta = getCalendarEventMeta(event.tipo);
          return el('small', { className: `calendar-event-chip calendar-event-chip--${meta.tone}` },
            el('span', { className: 'calendar-event-emoji' }, meta.icon),
            el('span', {}, meta.label),
          );
        }),
      ),
    );
  });

  replaceContent(grid,
    ...['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map((day) => el('div', { className: 'calendar-weekday' }, day)),
    ...dayButtons,
  );

  const showDay = (key) => {
    const selected = eventsByDate[key] || [];
    const dayTone = getCalendarDayTone(selected);
    title.textContent = new Date(`${key}T00:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    summary.textContent = selected.length ? `${selected.length} eventos programados o registrados.` : 'Sin eventos para este dia.';
    summary.className = dayTone ? `calendar-summary is-${dayTone}` : 'calendar-summary';
    replaceContent(dayEvents,
      selected.length
        ? selected.map((event) => {
          const meta = getCalendarEventMeta(event.tipo);
          const tagClass = meta.tone === 'danger' ? 'danger' : meta.tone === 'warning' ? 'warning' : meta.tone === 'info' ? 'info' : '';
          return el('article', { className: `event-card event-card--${meta.tone}` },
            el('span', { className: `tag ${tagClass}`.trim() },
              el('span', { className: 'calendar-event-emoji' }, meta.icon),
              meta.label,
            ),
            el('strong', {}, `${meta.icon} ${event.titulo}`),
            el('small', {}, [event.colegio, event.curso, event.materia].filter(Boolean).join(' - ')),
            el('p', {}, event.descripcion || ''),
          );
        })
        : emptyState('Sin eventos', 'No hay registros para este dia.'),
    );
  };

  grid.querySelectorAll('[data-calendar-day]').forEach((button) => {
    button.addEventListener('click', () => showDay(button.dataset.calendarDay));
  });

  renderCalendarMobileList(root, monthStart, eventsByDate, showDay);

  const monthKey = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
  const initialKey = today().startsWith(monthKey) ? today() : `${monthKey}-01`;
  showDay(initialKey);
}

function downloadActivityWord(html, titulo) {
  const safeTitle = (titulo || 'Actividad').replace(/\s+/g, '_');
  const wordContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>${esc(titulo || 'Actividad')}</title></head>
    <body>${html}</body>
    </html>
  `;
  const blob = new Blob(['\ufeff', wordContent], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeTitle}.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadActivityPdf(html, titulo) {
  // Intento generar y descargar PDF directamente usando html2pdf (CDN).
  // Si falla o el script no carga, cae al fallback de impresión.
  const filename = `${(titulo || 'Actividad').replace(/\s+/g, '_')}.pdf`;
  const wrappedHtml = `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; max-width: 800px; margin: auto;">${html}</div>`;

  function loadHtml2Pdf() {
    return new Promise((resolve, reject) => {
      if (window.html2pdf) return resolve(window.html2pdf);
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.9.2/html2pdf.bundle.min.js';
      script.async = true;
      script.onload = () => resolve(window.html2pdf);
      script.onerror = (e) => reject(new Error('No se pudo cargar html2pdf desde CDN'));
      document.head.appendChild(script);
    });
  }

  (async () => {
    try {
      const html2pdf = await loadHtml2Pdf();
      const container = document.createElement('div');
      container.style.display = 'block';
      container.style.padding = '10px';
      setTrustedHtml(container, wrappedHtml);
      document.body.appendChild(container);

      const opt = {
        margin: 18, // mm (approx)
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      };

      await html2pdf().from(container).set(opt).save();
      document.body.removeChild(container);
    } catch (err) {
      // Fallback: abrir ventana de impresión como antes
      const ventanaImpresion = window.open('', '_blank');
      if (!ventanaImpresion) {
        showAppToast('No se pudo abrir la ventana de impresión. Permití ventanas emergentes para esta página.', 'error');
        return;
      }
      ventanaImpresion.document.write(`
        <html>
          <head>
            <title>${esc(titulo || 'Actividad')}</title>
            <style>
              body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; }
              @media print { @page { margin: 1.8cm; } body { padding: 0; } }
            </style>
          </head>
          <body>
            ${html}
            <script>
              window.onload = () => { window.print(); setTimeout(() => window.close(), 600); };
            </script>
          </body>
        </html>
      `);
      ventanaImpresion.document.close();
    }
  })();
}

function openActivityFlowTab(tabId = 'contenido') {
  const root = document.querySelector('[data-activities]');
  if (!root) return;
  const allowed = new Set(['contenido', 'clase', 'entregas', 'corregir']);
  const next = allowed.has(tabId) ? tabId : 'contenido';

  root.querySelectorAll('[data-activity-flow-tab]').forEach((tab) => {
    const active = tab.getAttribute('data-activity-flow-tab') === next;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  root.querySelectorAll('[data-activity-flow-panel]').forEach((panel) => {
    const active = panel.getAttribute('data-activity-flow-panel') === next;
    panel.classList.toggle('is-hidden', !active);
    panel.hidden = !active;
  });

  root.querySelectorAll('[data-flow-step]').forEach((step) => {
    const id = step.getAttribute('data-flow-step');
    step.classList.toggle('is-current', id === next);
  });

  if (next === 'entregas' || next === 'corregir') {
    void toolsEntregasApi.refresh?.();
  }

  void updateActivityFlowStepper(next);
}

async function updateActivityFlowStepper(activeTab = 'contenido') {
  const root = document.querySelector('[data-activities]');
  const stepper = root?.querySelector('[data-activity-flow-stepper]');
  if (!stepper) return;

  const ctx = getTeachingContext();
  let hasActividad = false;
  let hasEntregas = false;
  let hasPendientes = false;

  if (ctx.cursoId && ctx.materiaId) {
    try {
      const [actividades, entregas] = await Promise.all([
        fetchActividadesForContext(ctx.cursoId, ctx.materiaId),
        fetchTrabajosForContext(ctx.cursoId, ctx.materiaId),
      ]);
      hasActividad = actividades.length > 0;
      hasEntregas = entregas.length > 0;
      hasPendientes = entregas.some((item) => !trabajoTieneCalificacion(item));
    } catch {
      // ignore network errors for stepper chrome
    }
  }

  const doneByStep = {
    contenido: hasActividad,
    clase: hasActividad,
    entregas: hasEntregas,
    corregir: hasEntregas && !hasPendientes,
  };

  stepper.querySelectorAll('[data-flow-step]').forEach((step) => {
    const id = step.getAttribute('data-flow-step');
    step.classList.toggle('is-done', Boolean(doneByStep[id]));
    step.classList.toggle('is-current', id === activeTab);
  });
}

function initActivityFlowTabs() {
  const root = document.querySelector('[data-activities]');
  if (!root) return;

  root.querySelectorAll('[data-activity-flow-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      openActivityFlowTab(tab.getAttribute('data-activity-flow-tab') || 'contenido');
    });
  });

  document.addEventListener('click', (event) => {
    const trigger = event.target?.closest?.('[data-activity-flow-open]');
    if (!trigger) return;
    const tab = trigger.getAttribute('data-activity-flow-open') || 'contenido';
    window.setTimeout(() => openActivityFlowTab(tab), 30);
  });

  window.addEventListener('aula-clara:open-activity-flow', (event) => {
    openActivityFlowTab(event.detail?.tab || 'contenido');
  });

  window.addEventListener('aula-clara:teaching-context-changed', () => {
    const active = root.querySelector('[data-activity-flow-tab].is-active')?.getAttribute('data-activity-flow-tab') || 'contenido';
    void updateActivityFlowStepper(active);
  });

  void updateActivityFlowStepper('contenido');
}

function initToolsEntregas() {
  const entregasRoot = document.querySelector('[data-entregas-root]');
  const corregirRoot = document.querySelector('[data-corregir-root]');
  if (!entregasRoot && !corregirRoot) return;

  let cachedActividadesList = [];
  let entregasApi = { refresh: async () => {} };
  let corregirApi = { refresh: async () => {} };

  const sharedContext = {
    getCourseId: () => getTeachingContext().cursoId || '',
    getMateriaId: () => getTeachingContext().materiaId || '',
    getColegio: () => getTeachingContext().escuela || '',
    getTurno: () => getTeachingContext().turno || '',
    getCourse: () => getTeachingContext().course || courseById(getTeachingContext().cursoId),
    getSubject: () => getTeachingContext().subject || subjectById(getTeachingContext().materiaId),
    getActividades: () => cachedActividadesList,
    setActividades: (items) => { cachedActividadesList = items; },
    onUploaded: () => {
      void entregasApi.refresh();
      void corregirApi.refresh();
    },
  };

  entregasApi = initTrabajosEntregas(entregasRoot, sharedContext);
  corregirApi = initTrabajosEntregas(corregirRoot, sharedContext);

  toolsEntregasApi = {
    refresh: async () => {
      await Promise.all([entregasApi.refresh(), corregirApi.refresh()]);
    },
    async openForActividad(actividadId) {
      openActivityFlowTab('entregas');
      await Promise.all([entregasApi.refresh(), corregirApi.refresh()]);
      return entregasApi.openForActividad?.(actividadId);
    },
    setContext({ colegio, turno, cursoId, materiaId } = {}) {
      setTeachingContext({
        escuela: colegio,
        turno,
        cursoId,
        materiaId,
      });
    },
  };

  window.addEventListener('aula-clara:teaching-context-changed', () => {
    void toolsEntregasApi.refresh();
  });

  registerSpaViewRefresh('actividades', () => {
    void toolsEntregasApi.refresh();
  });
}

function initActivities() {
  const root = document.querySelector('[data-activities]');
  if (!root) return;

  const form = root.querySelector('[data-activity-form]');
  const editor = root.querySelector('[data-activity-editor]');
  const list = root.querySelector('[data-activity-list]');
  const btnDescargarWord = root.querySelector('#btn-descargar-word');
  const btnDescargarPdf = root.querySelector('#btn-descargar-pdf');
  const aiForm = root.querySelector('[data-activity-ai-form]');
  const aiFilesInput = root.querySelector('[data-activity-ai-files]');
  const aiFileFeedback = root.querySelector('[data-activity-ai-file-feedback]');
  const aiSourceReport = root.querySelector('[data-activity-ai-source-report]');
  const aiLimitsDialog = root.querySelector('[data-activity-ai-limits-dialog]');
  const aiLimitsOpen = root.querySelector('[data-activity-ai-limits-open]');
  const aiStatus = root.querySelector('[data-activity-ai-status]');
  const aiStatusDetail = root.querySelector('[data-activity-ai-status-detail]');
  const aiProgress = root.querySelector('[data-activity-ai-progress]');
  const aiPreview = root.querySelector('[data-activity-ai-preview]');
  const aiPreviewBody = root.querySelector('[data-activity-ai-preview-body]');
  const aiSubmit = root.querySelector('[data-activity-ai-submit]');
  const aiWord = root.querySelector('[data-activity-ai-word]');
  const aiPdf = root.querySelector('[data-activity-ai-pdf]');
  const aiApply = root.querySelector('[data-activity-ai-apply]');
  const workspace = root.querySelector('[data-activity-workspace]');
  const schoolSelect = form.colegio;
  const shiftSelect = form.turno;
  const courseSelect = form.cursoId;
  const subjectSelect = form.materiaId;

  let lastGenerated = null;
  let progressTimer = null;
  let cachedActividadesList = [];

  const getActivityMode = () => 'manual';

  const refreshActividadesContext = async () => {
    // No reemplazar la lista de tarjetas: esa cache la mantiene renderActivitiesList
    // y los botones "Cargar entrega" / "Enviar a curso" dependen de ella.
  };

  const goToActivitiesWorkspace = () => {
    showSpaView('actividades');
    window.requestAnimationFrame(() => {
      workspace?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const formatChars = (value) => new Intl.NumberFormat('es-AR').format(Number(value) || 0);

  const renderAiFileFeedback = () => {
    if (!aiFileFeedback || !aiFilesInput) return;
    const maxFiles = Number(aiForm?.dataset.maxFiles || 6);
    const maxFileBytes = Number(aiForm?.dataset.maxFileBytes || 8 * 1024 * 1024);
    const maxInputChars = Number(aiForm?.dataset.maxInputChars || 35000);
    const files = Array.from(aiFilesInput.files || []);
    if (!files.length) {
      aiFileFeedback.classList.add('is-hidden');
      replaceContent(aiFileFeedback);
      return;
    }

    const issues = [];
    if (files.length > maxFiles) issues.push(`Seleccionaste ${files.length} archivos. El máximo es ${maxFiles}.`);
    files.forEach((file) => {
      if (file.size > maxFileBytes) {
        issues.push(`${file.name} supera ${Math.round(maxFileBytes / (1024 * 1024))} MB.`);
      }
    });

    const totalMb = files.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024);
    const ok = issues.length === 0;
    aiFileFeedback.classList.remove('is-hidden');
    aiFileFeedback.classList.toggle('is-warning', !ok);
    aiFileFeedback.classList.toggle('is-ok', ok);
    replaceContent(aiFileFeedback,
      el('p', {},
        el('strong', {}, `${files.length} archivo${files.length === 1 ? '' : 's'} seleccionado${files.length === 1 ? '' : 's'}`),
        ` · ${totalMb.toFixed(1)} MB en total`,
      ),
      el('p', { className: 'muted' }, `La IA usará como máximo ${formatChars(maxInputChars)} caracteres del material extraído (~10-15 páginas). Si hay más texto, se resume o se recorta automáticamente.`),
      issues.length
        ? el('ul', {}, ...issues.map((item) => el('li', {}, item)))
        : null,
    );
  };

  const renderAiSourceReport = (meta) => {
    if (!aiSourceReport) return;
    const source = meta?.source;
    if (!source) {
      aiSourceReport.classList.add('is-hidden');
      replaceContent(aiSourceReport);
      return;
    }

    const tags = [];
    if (source.summarized) tags.push('Resumido con modelo liviano');
    if (source.extractionTruncated) tags.push('Extracción recortada');
    if (source.inputTruncated) tags.push('Texto final recortado');

    aiSourceReport.classList.remove('is-hidden');
    replaceContent(aiSourceReport,
      el('div', { className: 'ai-source-report-head' },
        el('strong', {}, 'Material procesado para la IA'),
        tags.length
          ? el('div', { className: 'tag-row' }, ...tags.map((label) => tag(label)))
          : null,
      ),
      el('p', {},
        'Extraídos ',
        el('strong', {}, formatChars(source.extractedChars)),
        ' caracteres de ',
        el('strong', {}, source.filesProcessed),
        ` archivo${source.filesProcessed === 1 ? '' : 's'}. Se enviaron `,
        el('strong', {}, formatChars(source.usedChars)),
        ` a la generación (tope ${formatChars(source.maxInputChars)}).`,
      ),
      Array.isArray(source.messages) && source.messages.length
        ? el('ul', {}, ...source.messages.map((item) => el('li', {}, item)))
        : el('p', { className: 'muted' }, 'No fue necesario resumir ni recortar el material.'),
    );
  };

  aiLimitsOpen?.addEventListener('click', () => {
    if (aiLimitsDialog?.showModal) aiLimitsDialog.showModal();
  });

  aiFilesInput?.addEventListener('change', renderAiFileFeedback);

  const setAiLoading = (active, detail = '') => {
    aiStatus?.classList.toggle('is-hidden', !active);
    aiSubmit && (aiSubmit.disabled = active);
    if (aiStatusDetail && detail) aiStatusDetail.textContent = detail;
    if (!active && progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    if (active && aiProgress) {
      let value = 8;
      aiProgress.parentElement?.setAttribute('aria-valuenow', String(value));
      progressTimer = window.setInterval(() => {
        value = Math.min(92, value + Math.random() * 9);
        aiProgress.style.width = `${value}%`;
        aiProgress.parentElement?.setAttribute('aria-valuenow', String(Math.round(value)));
      }, 700);
    }
    if (!active && aiProgress) {
      aiProgress.style.width = '0%';
      aiProgress.parentElement?.setAttribute('aria-valuenow', '0');
    }
  };

  const applyGeneratedToForm = (generated) => {
    if (!generated) return;
    refreshActivityContextSelects();
    if (generated.titulo) form.titulo.value = generated.titulo;
    const tipoInput = form.querySelector(`[name="tipo"][value="${generated.tipo}"]`);
    if (tipoInput) {
      tipoInput.checked = true;
      renderEditor();
    }
    const editorContent = generated.contenido?.editor || {};
    if (generated.tipo === 'evaluacion') {
      const field = editor.querySelector('[data-activity-questions]');
      if (field) field.value = editorContent.questions || '';
    } else {
      const brief = editor.querySelector('[data-activity-brief]');
      const criteria = editor.querySelector('[data-activity-criteria]');
      if (brief) brief.value = editorContent.brief || '';
      if (criteria) criteria.value = editorContent.criteria || '';
    }
    goToActivitiesWorkspace();
  };

  if (aiForm) {
    aiForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const aiData = new FormData(aiForm);
      const files = aiForm.querySelector('[data-activity-ai-files]')?.files;
      if (!files?.length) {
        showAppToast('Adjuntá al menos un documento PDF, DOCX o TXT.', 'warning');
        return;
      }
      const maxFiles = Number(aiForm.dataset.maxFiles || 6);
      const maxFileBytes = Number(aiForm.dataset.maxFileBytes || 8 * 1024 * 1024);
      const invalidCount = files.length > maxFiles;
      const invalidSize = Array.from(files).some((file) => file.size > maxFileBytes);
      if (invalidCount || invalidSize) {
        renderAiFileFeedback();
        showAppToast('Revisá los archivos seleccionados: superan los límites permitidos.', 'warning');
        return;
      }

      // Relee “Curso actual” y refresca el formulario (p. ej. tras importar Excel).
      refreshActivityContextSelects();
      const ctx = getTeachingContext();
      let cursoId = String(courseSelect?.value || ctx.cursoId || '').trim();
      let materiaId = String(subjectSelect?.value || ctx.materiaId || '').trim();
      let selectedCourse = courseById(cursoId);
      if (!materiaId && selectedCourse) {
        const subjects = courseSubjectsForDisplay(selectedCourse);
        const fallback = subjects[0] || activeSubjects()[0];
        if (fallback?.id) {
          materiaId = fallback.id;
          ensureSelectOption(subjectSelect, materiaId, fallback.nombre);
        }
      }
      const colegio = String(schoolSelect?.value || ctx.escuela || selectedCourse?.escuela || '').trim();
      const turno = String(shiftSelect?.value || ctx.turno || selectedCourse?.turno || '').trim();
      const selectedSubject = subjectById(materiaId);

      if (!cursoId) {
        showAppToast('Elegí un curso en “Curso actual” arriba antes de generar con IA.', 'warning');
        return;
      }
      if (!materiaId) {
        showAppToast('Elegí una materia en “Curso actual” arriba antes de generar con IA.', 'warning');
        return;
      }
      if (!colegio || !turno) {
        showAppToast('Falta escuela o turno del curso. Revisá “Curso actual” o el formulario de actividad.', 'warning');
        return;
      }

      // Deja el formulario de actividad alineado con el contexto usado.
      ensureSelectOption(schoolSelect, colegio, colegio);
      ensureSelectOption(courseSelect, cursoId, selectedCourse?.nombre || cursoId);
      ensureSelectOption(subjectSelect, materiaId, selectedSubject?.nombre || materiaId);
      ensureSelectOption(shiftSelect, turno, turno);

      const payload = new FormData();
      payload.set('tipoGeneracion', aiData.get('tipoGeneracion') || 'tp');
      payload.set('colegio', colegio);
      payload.set('turno', turno);
      payload.set('cursoId', cursoId);
      payload.set('materiaId', materiaId);
      payload.set('cursoNombre', selectedCourse?.nombre || '');
      payload.set('materiaNombre', selectedSubject?.nombre || '');
      payload.set('titulo', new FormData(form).get('titulo') || '');
      payload.set('nivelAcademico', aiData.get('nivelAcademico') || '');
      const extraPrompt = sessionStorage.getItem('aula_clara_ai_extra_prompt') || '';
      const notasDocente = [aiData.get('notasDocente') || '', extraPrompt].filter(Boolean).join('\n\n');
      payload.set('notasDocente', notasDocente);
      if (extraPrompt) sessionStorage.removeItem('aula_clara_ai_extra_prompt');
      Array.from(files).forEach((file) => payload.append('documentos', file));

      setAiLoading(true, 'Leyendo el material y generando con IA… Esto puede tardar 1–3 minutos con PDFs largos.');
      try {
        await syncPendingOperations();
      } catch (syncError) {
        console.warn('[aula-clara] sync antes de IA falló', syncError);
      }
      aiPreview?.classList.add('is-hidden');
      aiSourceReport?.classList.add('is-hidden');

      try {
        setAiLoading(true, 'Generando material didáctico con IA…');
        const response = await fetch('/api/actividades/generar', {
          method: 'POST',
          body: payload,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || 'No se pudo generar la actividad.');
        }

        lastGenerated = data;
        renderAiSourceReport(data.meta);
        if (aiPreviewBody) setTrustedHtml(aiPreviewBody, data.html || '');
        aiPreview?.classList.remove('is-hidden');
        setAiLoading(false, '');
        showAppToast('Actividad generada. Revisá la vista previa.', 'ok');
      } catch (error) {
        setAiLoading(false, '');
        showAppToast(error instanceof Error ? error.message : 'Error al generar la actividad.', 'error');
      }
    });
  }

  aiWord?.addEventListener('click', () => {
    if (!lastGenerated?.html) return showAppToast('Generá una actividad antes de exportar.', 'warning');
    downloadActivityWord(lastGenerated.html, lastGenerated.titulo);
  });

  aiPdf?.addEventListener('click', () => {
    if (!lastGenerated?.html) return showAppToast('Generá una actividad antes de exportar.', 'warning');
    downloadActivityPdf(lastGenerated.html, lastGenerated.titulo);
  });

  aiApply?.addEventListener('click', () => {
    if (!lastGenerated) return showAppToast('No hay contenido generado para aplicar.', 'warning');
    applyGeneratedToForm(lastGenerated);
    showAppToast('Contenido aplicado. Revisá en Actividades y guardá la actividad.', 'ok');
  });

  function obtenerDatosDocumento() {
    if (lastGenerated?.html) {
      return { html: lastGenerated.html, titulo: lastGenerated.titulo || form.titulo.value || 'Actividad' };
    }
    const data = Object.fromEntries(new FormData(form));
    const cursoOpcion = courseSelect.options[courseSelect.selectedIndex];
    const cursoNombre = cursoOpcion ? cursoOpcion.text : data.cursoId;
    const materiaOpcion = subjectSelect.options[subjectSelect.selectedIndex];
    const materiaNombre = materiaOpcion ? materiaOpcion.text : data.materiaId;
    const tituloDoc = esc(data.titulo ? data.titulo.toUpperCase() : 'ACTIVIDAD SIN TÍTULO');
    const avisoLabel = data.tipo === 'tp' ? 'Publicación del TP' : 'Aviso';
    const entregaLabel = data.tipo === 'tp' ? 'Entrega del TP' : 'Entrega';

    let html = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 800px; margin: auto;">
        <h1 style="color: #2c3e50; text-align: center; border-bottom: 2px solid #2c3e50; padding-bottom: 10px;">${tituloDoc}</h1>
        <table style="width: 100%; margin-top: 20px; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Colegio:</strong> ${esc(data.colegio || '')}</td>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Turno:</strong> ${esc(data.turno || '')}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Curso:</strong> ${esc(cursoNombre || '')}</td>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Materia:</strong> ${esc(materiaNombre || '')}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>${avisoLabel}:</strong> ${esc(data.fechaPublicacion || '-')}</td>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>${entregaLabel}:</strong> ${esc(data.fechaVencimiento || '-')}</td>
          </tr>
        </table>
    `;

    if (data.tipo === 'evaluacion') {
      const preguntas = String(editor.querySelector('[data-activity-questions]')?.value || '')
        .split('\n').map(p => p.trim()).filter(Boolean);

      html += `<h3 style="color: #2c3e50; margin-top: 30px;">Detalle del aviso:</h3><ol style="margin-left: 20px;">`;
      if (preguntas.length > 0) {
        preguntas.forEach(p => {
          html += `<li style="margin-bottom: 15px; padding-bottom: 60px; border-bottom: 1px dashed #ccc; font-size: 15px;">${esc(p)}</li>`;
        });
      } else {
        html += `<p><em>No se cargaron detalles.</em></p>`;
      }
      html += `</ol>`;
    } else {
      const consigna = String(editor.querySelector('[data-activity-brief]')?.value || '').trim();
      const criterios = String(editor.querySelector('[data-activity-criteria]')?.value || '').trim();

      html += `
        <h3 style="color: #2c3e50; margin-top: 30px;">Consigna del Trabajo Práctico:</h3>
        <p style="white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-left: 4px solid #3498db; font-size: 15px; line-height: 1.6;">${esc(consigna || 'Sin consigna detallada.')}</p>
      `;
      if (criterios) {
        html += `
          <h4 style="color: #2c3e50; margin-top: 20px;">Criterios de Evaluación:</h4>
          <ul>
            ${criterios.split(',').map(c => `<li style="margin-bottom: 5px; font-size: 14px;">${esc(c.trim())}</li>`).join('')}
          </ul>
        `;
      }
    }

    html += `</div>`;
    return { html, titulo: esc(data.titulo || 'Actividad') };
  }

  if (btnDescargarWord) {
    btnDescargarWord.addEventListener('click', () => {
      const { html, titulo } = obtenerDatosDocumento();
      if (!titulo && !form.titulo.value) {
        return showAppToast('Ingresá un título o generá una actividad con IA antes de descargar.', 'warning');
      }
      downloadActivityWord(html, titulo || form.titulo.value);
    });
  }

  if (btnDescargarPdf) {
    btnDescargarPdf.addEventListener('click', () => {
      const { html, titulo } = obtenerDatosDocumento();
      if (!titulo && !form.titulo.value) {
        return showAppToast('Ingresá un título o generá una actividad con IA antes de exportar.', 'warning');
      }
      downloadActivityPdf(html, titulo || form.titulo.value);
    });
  }

  const schools = schoolNamesForSelect();
  const shifts = [...new Set(visibleCourses().map((course) => course.turno).filter(Boolean))];
  fillSelect(schoolSelect, schools.map((school) => ({ id: school, nombre: school })), 'Escuela');
  fillSelect(shiftSelect, shifts.map((shift) => ({ id: shift, nombre: shift })), 'Turno');
  fillSelect(courseSelect, visibleCourses(), 'Curso', 'id', courseLabel);
  fillSelect(subjectSelect, activeSubjects(), 'Materia');
  applyTeachingContextTo({ school: schoolSelect, course: courseSelect, subject: subjectSelect, shift: shiftSelect });
  applySuggestedContextTo({ school: schoolSelect, course: courseSelect, subject: subjectSelect, shift: shiftSelect });
  const ensureSelectOption = (select, value, label = value) => {
    if (!select || value == null || value === '') return;
    const asString = String(value);
    if (![...select.options].some((option) => option.value === asString)) {
      select.appendChild(new Option(String(label || asString), asString));
    }
    select.value = asString;
  };
  const syncCourseFields = () => {
    const course = courseById(courseSelect.value);
    if (!course) return;
    ensureSelectOption(schoolSelect, course.escuela, course.escuela);
    ensureSelectOption(shiftSelect, course.turno, course.turno);
  };
  const refreshActivityContextSelects = () => {
    const ctx = getTeachingContext();
    const schoolFilter = schoolSelect?.value || ctx.escuela || '';
    fillSelect(
      schoolSelect,
      schoolNamesForSelect().map((school) => ({ id: school, nombre: school })),
      'Escuela',
    );
    const courseOptions = visibleCourses(schoolFilter);
    fillSelect(courseSelect, courseOptions, 'Curso', 'id', courseLabel);
    const shiftOptions = [...new Set(
      visibleCourses().map((course) => course.turno).filter(Boolean),
    )];
    fillSelect(shiftSelect, shiftOptions.map((shift) => ({ id: shift, nombre: shift })), 'Turno');
    fillSelect(subjectSelect, activeSubjects(), 'Materia');
    applyTeachingContextTo({
      school: schoolSelect,
      course: courseSelect,
      subject: subjectSelect,
      shift: shiftSelect,
    });
    // Si el valor del contexto no está en las opciones (datos recién importados), forzarlo.
    ensureSelectOption(schoolSelect, ctx.escuela || courseById(ctx.cursoId)?.escuela, ctx.escuela);
    ensureSelectOption(courseSelect, ctx.cursoId, courseById(ctx.cursoId)?.nombre || ctx.cursoId);
    ensureSelectOption(subjectSelect, ctx.materiaId, subjectById(ctx.materiaId)?.nombre || ctx.materiaId);
    const course = courseById(courseSelect.value || ctx.cursoId);
    ensureSelectOption(shiftSelect, course?.turno || ctx.turno, course?.turno || ctx.turno);
    syncCourseFields();
  };
  const syncFromTeachingContext = () => {
    refreshActivityContextSelects();
    refreshActividadesContext();
    refreshGlobalTeachingContextUi();
  };
  courseSelect.addEventListener('change', () => {
    syncCourseFields();
    setTeachingContext({
      escuela: schoolSelect.value,
      cursoId: courseSelect.value,
      materiaId: subjectSelect.value,
    }, { notify: true });
    refreshActividadesContext();
  });
  subjectSelect.addEventListener('change', () => {
    setTeachingContext({
      escuela: schoolSelect.value,
      cursoId: courseSelect.value,
      materiaId: subjectSelect.value,
    }, { notify: true });
    refreshActividadesContext();
  });
  window.addEventListener('aula-clara:teaching-context-changed', syncFromTeachingContext);
  window.addEventListener('aula-clara:ciclo-changed', syncFromTeachingContext);
  window.addEventListener('aula-clara:schools-changed', syncFromTeachingContext);
  onPanelRefresh(syncFromTeachingContext);
  syncCourseFields();
  root.querySelector('[name="fechaPublicacion"]').value = today();
  refreshActividadesContext();

  const renderEditor = () => {
    const tipo = new FormData(form).get('tipo') || 'evaluacion';
    if (tipo === 'evaluacion') {
      replaceContent(editor,
        el('div', { className: 'section-title' },
          el('h2', {}, 'Aviso de evaluación'),
          el('p', {}, 'Deja claro tema, modalidad y materiales necesarios.'),
        ),
        el('label', {},
          el('span', {}, 'Descripción'),
          el('textarea', { rows: 7, attrs: { 'data-activity-questions': '', placeholder: 'Tema, modalidad, material para traer o aclaraciones' } }),
        ),
      );
      return;
    }
    replaceContent(editor,
      el('div', { className: 'section-title' },
        el('h2', {}, 'Publicación del TP'),
        el('p', {}, 'Define consigna, criterios de seguimiento y fecha de entrega.'),
      ),
      el('label', {},
        el('span', {}, 'Consigna'),
        el('textarea', { rows: 7, attrs: { 'data-activity-brief': '', placeholder: 'Describe la actividad' } }),
      ),
      el('label', {},
        el('span', {}, 'Criterios de seguimiento'),
        el('input', { attrs: { 'data-activity-criteria': '', placeholder: 'Entrega, desarrollo, presentación' } }),
      ),
    );
  };

  form.querySelectorAll('[name="tipo"]').forEach((input) => input.addEventListener('change', renderEditor));
  renderEditor();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (getActivityMode() !== 'manual') return;
    clearFieldErrors(form);

    // Los selects de escuela/curso están ocultos (usan “Curso actual”); sincronizarlos antes de validar.
    refreshActivityContextSelects();
    const ctx = getTeachingContext();
    const selectedCourse = courseById(courseSelect?.value || ctx.cursoId);
    const selectedSubject = subjectById(subjectSelect?.value || ctx.materiaId);
    const colegio = String(schoolSelect?.value || ctx.escuela || selectedCourse?.escuela || '').trim();
    const turno = String(shiftSelect?.value || ctx.turno || selectedCourse?.turno || '').trim();
    const cursoId = String(courseSelect?.value || ctx.cursoId || '').trim();
    const materiaId = String(subjectSelect?.value || ctx.materiaId || '').trim();

    ensureSelectOption(schoolSelect, colegio, colegio);
    ensureSelectOption(shiftSelect, turno, turno);
    ensureSelectOption(courseSelect, cursoId, selectedCourse?.nombre || cursoId);
    ensureSelectOption(subjectSelect, materiaId, selectedSubject?.nombre || materiaId);

    const data = Object.fromEntries(new FormData(form));
    data.colegio = colegio;
    data.turno = turno;
    data.cursoId = cursoId;
    data.materiaId = materiaId;

    if (!data.colegio) {
      showAppToast('Elegí escuela y curso en “Curso actual” arriba.', 'warning');
      return;
    }
    if (!data.turno) {
      showAppToast('Falta el turno del curso. Revisá “Curso actual”.', 'warning');
      return;
    }
    if (!data.cursoId) {
      showAppToast('Elegí un curso en “Curso actual” arriba.', 'warning');
      return;
    }
    if (!data.materiaId) {
      showAppToast('Elegí una materia en “Curso actual” arriba.', 'warning');
      return;
    }
    if (!String(data.titulo || '').trim()) {
      setFieldError(form.titulo, 'Ingresá un título.');
      focusFirstInvalid(form);
      return;
    }
    const tipo = data.tipo === 'tp' ? 'tp' : 'evaluacion';
    const files = Array.from(editor.querySelector('[data-activity-images]')?.files || []);
    const fromAi = lastGenerated
      && lastGenerated.tipo === tipo
      && lastGenerated.contenido
      && typeof lastGenerated.contenido === 'object';
    const contenido = fromAi
      ? {
          ...lastGenerated.contenido,
          editor: lastGenerated.contenido.editor || undefined,
          imagenes: files.map((file) => ({ name: file.name, type: file.type, size: file.size })),
        }
      : tipo === 'evaluacion'
        ? {
            template: 'evaluacion-v1',
            bloques: String(editor.querySelector('[data-activity-questions]')?.value || '')
              .split('\n')
              .map((texto) => texto.trim())
              .filter(Boolean)
              .map((texto, index) => ({ type: 'pregunta', texto, puntaje: index + 1 })),
            imagenes: files.map((file) => ({ name: file.name, type: file.type, size: file.size })),
            seguimiento: { criterios: ['Resolucion', 'Proceso', 'Presentacion'] },
          }
        : {
            template: 'tp-v1',
            bloques: [{ type: 'consigna', texto: String(editor.querySelector('[data-activity-brief]')?.value || '').trim() }],
            seguimiento: {
              criterios: String(editor.querySelector('[data-activity-criteria]')?.value || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            },
          };

    if (tipo === 'tp') {
      const consigna = fromAi
        ? String(lastGenerated?.contenido?.editor?.brief || editor.querySelector('[data-activity-brief]')?.value || '').trim()
        : String(editor.querySelector('[data-activity-brief]')?.value || '').trim();
      if (!consigna && !(fromAi && Array.isArray(lastGenerated?.contenido?.bloques) && lastGenerated.contenido.bloques.length)) {
        showAppToast('Completá la consigna del TP antes de guardar.', 'warning');
        return;
      }
    }

    const saveBtn = form.querySelector('button[type="submit"]');
    const previousLabel = saveBtn?.textContent || 'Guardar actividad';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando…';
    }

    try {
      try {
        await syncPendingOperations();
      } catch (syncError) {
        console.warn('[aula-clara] sync antes de guardar actividad falló', syncError);
      }

      const response = await fetch('/api/actividades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          tipo,
          colegio: data.colegio,
          turno: data.turno,
          cursoId: data.cursoId,
          materiaId: data.materiaId,
          cursoNombre: selectedCourse?.nombre || courseById(data.cursoId)?.nombre || '',
          materiaNombre: selectedSubject?.nombre || subjectById(data.materiaId)?.nombre || '',
          titulo: String(data.titulo || '').trim(),
          fechaPublicacion: data.fechaPublicacion,
          fechaVencimiento: data.fechaVencimiento,
          contenido,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        showAppToast(error.error || 'No se pudo guardar la actividad.', 'error');
        return;
      }

      form.reset();
      showAppToast('Actividad guardada con éxito.', 'ok');
      knownHasActivity = true;
      sessionStorage.setItem('aula_clara_has_activity', '1');
      window.dispatchEvent(new CustomEvent('aula-clara:local-data-changed'));
      root.querySelector('[name="fechaPublicacion"]').value = today();
      refreshActivityContextSelects();
      renderEditor();
      await renderActivitiesList(list, (items) => { cachedActividadesList = items; });
    } catch (error) {
      console.error('[aula-clara] guardar actividad failed', error);
      showAppToast(error instanceof Error ? error.message : 'No se pudo guardar la actividad.', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = previousLabel;
      }
    }
  });

  const enviarDialog = root.querySelector('[data-activity-enviar-dialog]');
  const enviarForm = root.querySelector('[data-activity-enviar-form]');
  const enviarSourceLabel = root.querySelector('#activity-enviar-source-label');
  const enviarColegio = root.querySelector('[data-enviar-colegio]');
  const enviarTurno = root.querySelector('[data-enviar-turno]');
  const enviarCurso = root.querySelector('[data-enviar-curso]');
  const enviarMateria = root.querySelector('[data-enviar-materia]');

  const refreshEnviarDestinationSelects = () => {
    const schoolsForEnviar = schoolNamesForSelect();
    const courses = visibleCourses();
    const shiftsForEnviar = [...new Set(courses.map((course) => course.turno).filter(Boolean))];
    fillSelect(enviarColegio, schoolsForEnviar.map((school) => ({ id: school, nombre: school })), 'Escuela');
    fillSelect(enviarTurno, shiftsForEnviar.map((shift) => ({ id: shift, nombre: shift })), 'Turno');
    fillSelect(enviarCurso, courses, 'Curso', 'id', courseLabel);
    fillSelect(enviarMateria, activeSubjects(), 'Materia');
  };

  refreshEnviarDestinationSelects();

  const syncEnviarCourseFields = () => {
    const course = courseById(enviarCurso?.value);
    if (!course || !enviarColegio || !enviarTurno) return;
    ensureSelectOption(enviarColegio, course.escuela, course.escuela);
    ensureSelectOption(enviarTurno, course.turno, course.turno);
  };

  enviarCurso?.addEventListener('change', syncEnviarCourseFields);

  const openEnviarDialog = (actividadId) => {
    const actividad = cachedActividadesList.find((item) => String(item.id) === String(actividadId));
    if (!actividad) {
      showAppToast('No se encontró la actividad. Recargá la lista e intentá de nuevo.', 'warning');
      return;
    }
    if (!enviarForm || !enviarDialog) {
      showAppToast('No se pudo abrir el diálogo de envío.', 'error');
      return;
    }

    refreshEnviarDestinationSelects();

    enviarForm.actividadId.value = actividad.id;
    enviarForm.titulo.value = actividad.titulo || '';
    enviarForm.fechaPublicacion.value = actividad.fecha_publicacion || '';
    enviarForm.fechaVencimiento.value = actividad.fecha_vencimiento || '';

    const colegio = form.colegio?.value || actividad.colegio || getTeachingContext().escuela || '';
    const turno = form.turno?.value || actividad.turno || getTeachingContext().turno || '';
    const cursoId = form.cursoId?.value || actividad.curso_id || getTeachingContext().cursoId || '';
    const materiaId = form.materiaId?.value || actividad.materia_id || getTeachingContext().materiaId || '';
    const selectedCourse = courseById(cursoId);

    ensureSelectOption(enviarColegio, colegio || selectedCourse?.escuela, colegio || selectedCourse?.escuela);
    ensureSelectOption(enviarTurno, turno || selectedCourse?.turno, turno || selectedCourse?.turno);
    ensureSelectOption(enviarCurso, cursoId, selectedCourse ? courseLabel(selectedCourse) : cursoId);
    ensureSelectOption(
      enviarMateria,
      materiaId,
      subjectById(materiaId)?.nombre || actividad.materia || materiaId,
    );
    syncEnviarCourseFields();

    if (enviarSourceLabel) {
      enviarSourceLabel.textContent = `Vas a enviar «${actividad.titulo}» (${activityTipoLabel(actividad)}) desde ${[actividad.curso, actividad.materia].filter(Boolean).join(' · ') || 'su curso original'}.`;
    }

    if (typeof enviarDialog.showModal === 'function') {
      enviarDialog.showModal();
    } else {
      enviarDialog.setAttribute('open', '');
    }
  };

  list?.addEventListener('click', (event) => {
    const enviarBtn = event.target.closest('[data-enviar-actividad]');
    if (enviarBtn) {
      openEnviarDialog(enviarBtn.dataset.enviarActividad);
      return;
    }

    const cargarBtn = event.target.closest('[data-cargar-entrega-actividad]');
    if (!cargarBtn) return;

    const actividadId = cargarBtn.dataset.cargarEntregaActividad;
    const actividad = cachedActividadesList.find((item) => String(item.id) === String(actividadId));
    if (!actividad) {
      showAppToast('No se encontró la actividad. Recargá la lista e intentá de nuevo.', 'warning');
      return;
    }

    toolsEntregasApi.setContext?.({
      colegio: actividad.colegio,
      turno: actividad.turno,
      cursoId: actividad.curso_id,
      materiaId: actividad.materia_id,
    });
    showSpaView('actividades');
    openActivityFlowTab('entregas');
    void toolsEntregasApi.openForActividad(actividad.id);
  });

  enviarForm?.querySelector('[data-enviar-cancel]')?.addEventListener('click', () => {
    enviarDialog?.close();
  });

  enviarForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const submitter = event.submitter;
    if (submitter?.value === 'cancel') {
      enviarDialog?.close();
      return;
    }

    const data = Object.fromEntries(new FormData(enviarForm));
    const selectedCourse = courseById(data.cursoId);
    const selectedSubject = subjectById(data.materiaId);
    if (!data.actividadId || !data.colegio || !data.turno || !data.cursoId || !data.materiaId) {
      showAppToast('Completá escuela, turno, curso y materia destino.', 'warning');
      return;
    }

    const confirmBtn = enviarForm.querySelector('button[type="submit"]');
    const previousLabel = confirmBtn?.textContent || '';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Enviando…';
    }

    try {
      try {
        await syncPendingOperations();
      } catch (syncError) {
        console.warn('[aula-clara] sync antes de enviar actividad falló', syncError);
      }

      const response = await fetch('/api/actividades/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actividadId: data.actividadId,
          colegio: data.colegio,
          turno: data.turno,
          cursoId: data.cursoId,
          materiaId: data.materiaId,
          cursoNombre: selectedCourse?.nombre || '',
          materiaNombre: selectedSubject?.nombre || '',
          titulo: data.titulo?.trim() || undefined,
          fechaPublicacion: data.fechaPublicacion || undefined,
          fechaVencimiento: data.fechaVencimiento || undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo enviar la actividad.');

      enviarDialog?.close();
      await renderActivitiesList(list, (items) => { cachedActividadesList = items; });
      showAppToast(`Actividad enviada a ${selectedCourse?.nombre || 'el curso'} (${selectedSubject?.nombre || 'materia'}).`, 'ok');
    } catch (error) {
      showAppToast(error instanceof Error ? error.message : 'Error al enviar la actividad.', 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = previousLabel;
      }
    }
  });

  window.addEventListener('aula-clara:teaching-context-changed', refreshEnviarDestinationSelects);
  window.addEventListener('aula-clara:schools-changed', refreshEnviarDestinationSelects);
  onPanelRefresh(refreshEnviarDestinationSelects);

  const refreshListedActivities = () => {
    void renderActivitiesList(list, (items) => { cachedActividadesList = items; });
  };

  document.querySelector('[data-activity-list-all]')?.addEventListener('change', refreshListedActivities);
  window.addEventListener('aula-clara:teaching-context-changed', refreshListedActivities);

  refreshListedActivities();
  initClaseVirtual(root);
}

function initClaseVirtual(activitiesRoot) {
  const root = activitiesRoot?.querySelector('[data-clase-virtual-root]') || document.querySelector('[data-clase-virtual-root]');
  if (!root) return;

  const form = root.querySelector('[data-clase-form]');
  const qEditor = root.querySelector('[data-clase-questions-editor]');
  const schoolSelect = root.querySelector('[data-clase-colegio]');
  const shiftSelect = root.querySelector('[data-clase-turno]');
  const courseSelect = root.querySelector('[data-clase-curso]');
  const subjectSelect = root.querySelector('[data-clase-materia]');
  let currentAula = null;
  let currentStep = 1;

  const showStep = (step) => {
    currentStep = step;
    root.querySelectorAll('[data-clase-panel]').forEach((panel) => {
      panel.hidden = Number(panel.getAttribute('data-clase-panel')) !== step;
    });
    root.querySelectorAll('[data-clase-step]').forEach((item) => {
      const id = Number(item.getAttribute('data-clase-step'));
      item.classList.toggle('is-current', id === step);
      item.classList.toggle('is-done', id < step);
    });
    if (step === 2) void refreshActividadesCargables();
  };

  const syncContextSelects = () => {
    const ctx = getTeachingContext();
    const schools = schoolNamesForSelect();
    const courses = visibleCourses();
    const shifts = [...new Set(courses.map((c) => c.turno).filter(Boolean))];
    fillSelect(schoolSelect, schools.map((s) => ({ id: s, nombre: s })), 'Escuela');
    fillSelect(shiftSelect, shifts.map((s) => ({ id: s, nombre: s })), 'Turno');
    fillSelect(courseSelect, courses, 'Curso', 'id', courseLabel);
    fillSelect(subjectSelect, activeSubjects(), 'Materia');
    if (ctx.escuela) schoolSelect.value = ctx.escuela;
    if (ctx.cursoId) courseSelect.value = ctx.cursoId;
    if (ctx.materiaId) subjectSelect.value = ctx.materiaId;
    const course = courseById(courseSelect.value || ctx.cursoId);
    if (course?.turno) shiftSelect.value = course.turno;
  };

  const applyModoPreset = () => {
    const modo = new FormData(form).get('modo');
    const exam = modo === 'examen';
    form.querySelector('[name="atOneAtATime"]').checked = exam;
    form.querySelector('[name="atLockNav"]').checked = exam;
    form.querySelector('[name="atHideResults"]').checked = exam;
    form.querySelector('[name="atMaxFocus"]').value = exam ? '3' : '5';
  };

  const addQuestionCard = (preset = {}) => {
    const list = qEditor.querySelector('[data-aula-q-editor]');
    if (!list) return;
    const modo = new FormData(form).get('modo');
    const item = el('article', { className: 'aula-q-item', dataset: { aulaQItem: '' } },
      el('div', { className: 'input-group' },
        el('label', {},
          el('span', {}, 'Tipo'),
          el('select', { dataset: { aulaQTipo: '' } },
            el('option', { attrs: { value: 'mc_single' } }, 'Opción única'),
            el('option', { attrs: { value: 'mc_multi' } }, 'Varias correctas'),
            modo === 'multiple_choice' ? null : el('option', { attrs: { value: 'corta' } }, 'Respuesta corta'),
            modo === 'multiple_choice' ? null : el('option', { attrs: { value: 'abierta' } }, 'Respuesta abierta'),
          ),
        ),
        el('label', {},
          el('span', {}, 'Puntaje'),
          el('input', { attrs: { type: 'number', min: '0.5', step: '0.5', value: String(preset.puntaje || 1), 'data-aula-q-puntaje': '' } }),
        ),
      ),
      el('label', {},
        el('span', {}, 'Enunciado'),
        el('textarea', { attrs: { rows: '2', 'data-aula-q-enunciado': '', placeholder: 'Pregunta (respuesta digital)' } }, preset.enunciado || ''),
      ),
      el('div', { className: 'aula-q-options', dataset: { aulaQOptions: '' } }),
      el('div', { className: 'button-row' },
        el('button', { className: 'btn btn-secondary btn-sm', type: 'button', dataset: { aulaQAddOpt: '' } }, 'Agregar opción'),
        el('button', { className: 'btn btn-secondary btn-sm', type: 'button', dataset: { aulaQRemove: '' } }, 'Quitar'),
      ),
    );
    item.dataset.uid = `q${Date.now()}${Math.random().toString(16).slice(2, 5)}`;
    const tipoSelect = item.querySelector('[data-aula-q-tipo]');
    tipoSelect.value = modo === 'multiple_choice'
      ? (preset.tipo === 'mc_multi' ? 'mc_multi' : 'mc_single')
      : (preset.tipo || 'abierta');
    list.appendChild(item);
    const optionsBox = item.querySelector('[data-aula-q-options]');
    const syncOptionsVisibility = () => {
      const isMc = String(tipoSelect.value).startsWith('mc_');
      optionsBox.hidden = !isMc;
      item.querySelector('[data-aula-q-add-opt]').hidden = !isMc;
    };
    const addOption = (text = '', correct = false, id = '') => {
      const row = el('div', { className: 'aula-q-option-row', dataset: { aulaQOption: '', optionId: id || `opt-${Date.now()}-${Math.random().toString(16).slice(2, 6)}` } },
        el('input', { attrs: { type: tipoSelect.value === 'mc_multi' ? 'checkbox' : 'radio', name: `correct-${item.dataset.uid}`, 'data-aula-q-correct': '' } }),
        el('input', { attrs: { type: 'text', placeholder: 'Opción', 'data-aula-q-option-text': '', value: text } }),
      );
      if (correct) row.querySelector('[data-aula-q-correct]').checked = true;
      optionsBox.appendChild(row);
    };
    tipoSelect.addEventListener('change', () => {
      optionsBox.querySelectorAll('[data-aula-q-correct]').forEach((input) => {
        input.type = tipoSelect.value === 'mc_multi' ? 'checkbox' : 'radio';
        input.name = `correct-${item.dataset.uid}`;
      });
      syncOptionsVisibility();
    });
    item.querySelector('[data-aula-q-add-opt]').addEventListener('click', () => addOption());
    item.querySelector('[data-aula-q-remove]').addEventListener('click', () => item.remove());
    (Array.isArray(preset.opciones) && preset.opciones.length ? preset.opciones : [{ texto: '' }, { texto: '' }]).forEach((opt) => {
      addOption(opt.texto || '', Array.isArray(preset.correctas) && preset.correctas.includes(opt.id), opt.id || '');
    });
    syncOptionsVisibility();
  };

  const renderQuestionEditor = (preguntas = []) => {
    replaceContent(qEditor,
      el('div', { className: 'aula-q-editor', dataset: { aulaQEditor: '' } }),
      el('button', { className: 'btn btn-secondary', type: 'button', dataset: { aulaQAdd: '' } }, 'Agregar pregunta'),
    );
    qEditor.querySelector('[data-aula-q-add]')?.addEventListener('click', () => addQuestionCard());
    if (Array.isArray(preguntas) && preguntas.length) {
      preguntas.forEach((p) => addQuestionCard(p));
    } else {
      addQuestionCard();
    }
  };

  const refreshActividadesCargables = async () => {
    const select = root.querySelector('[data-clase-actividad-existente]');
    const aiRef = root.querySelector('[data-clase-ai-ref]');
    try {
      const res = await fetch('/api/aula-temporal/actividades-cargables', {
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      const items = data.actividades || [];

      const fillSelectList = (elSelect, emptyLabel) => {
        if (!elSelect) return;
        const previous = elSelect.value;
        replaceContent(elSelect, el('option', { attrs: { value: '' } }, emptyLabel));
        items.forEach((item) => {
          elSelect.appendChild(el('option', {
            attrs: { value: item.id },
          }, `${item.titulo} · ${item.curso} / ${item.materia}`));
        });
        if (previous && [...elSelect.options].some((o) => o.value === previous)) elSelect.value = previous;
      };

      fillSelectList(select, '— Elegí una actividad guardada —');
      fillSelectList(aiRef, '— Actividad de referencia (opcional) —');
    } catch {
      showAppToast('No se pudieron listar las actividades.', 'warning');
    }
  };

  const readQuestions = () => [...qEditor.querySelectorAll('[data-aula-q-item]')].map((item, index) => {
    const tipo = item.querySelector('[data-aula-q-tipo]')?.value || 'mc_single';
    const enunciado = String(item.querySelector('[data-aula-q-enunciado]')?.value || '').trim();
    const puntaje = Number(item.querySelector('[data-aula-q-puntaje]')?.value) || 1;
    const optionRows = [...item.querySelectorAll('[data-aula-q-option]')];
    const opciones = optionRows.map((row, optIndex) => ({
      id: row.dataset.optionId || `opt-${index + 1}-${optIndex + 1}`,
      texto: String(row.querySelector('[data-aula-q-option-text]')?.value || '').trim(),
    })).filter((opt) => opt.texto);
    const correctas = optionRows
      .filter((row) => row.querySelector('[data-aula-q-correct]')?.checked)
      .map((row, optIndex) => row.dataset.optionId || `opt-${index + 1}-${optIndex + 1}`)
      .filter((id) => opciones.some((opt) => opt.id === id));
    return { tipo, enunciado, puntaje, opciones, correctas };
  }).filter((q) => q.enunciado);

  const renderShare = (aula) => {
    currentAula = aula;
    const url = `${window.location.origin}${aula.joinPath}`;
    root.querySelector('[data-clase-url]').textContent = url;
    root.querySelector('[data-clase-open]').href = url;
    const box = root.querySelector('[data-clase-intentos]');
    if (!aula.intentos?.length) {
      replaceContent(box, el('p', { className: 'muted' }, 'Todavía no hay entregas digitales.'));
    } else {
      replaceContent(box, ...aula.intentos.map((item) =>
        el('article', { className: 'event-card' },
          el('strong', {}, `${item.apellido}, ${item.nombre}`),
          el('small', {}, [
            item.estado,
            item.nota10 != null ? `nota ${item.nota10}` : null,
            item.alumnoId ? 'vinculado' : 'sin vincular',
          ].filter(Boolean).join(' · ')),
        ),
      ));
    }
    showStep(3);
  };

  form.querySelectorAll('[name="modo"]').forEach((input) => input.addEventListener('change', applyModoPreset));
  applyModoPreset();
  syncContextSelects();
  showStep(1);

  window.addEventListener('aula-clara:teaching-context-changed', syncContextSelects);
  onPanelRefresh(syncContextSelects);

  root.querySelector('[data-clase-crear]')?.addEventListener('click', async () => {
    syncContextSelects();
    const data = Object.fromEntries(new FormData(form));
    const course = courseById(data.cursoId);
    const btn = root.querySelector('[data-clase-crear]');
    btn.disabled = true;
    try {
      const res = await fetch('/api/aula-temporal/clase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          colegio: data.colegio || course?.escuela,
          turno: data.turno || course?.turno,
          cursoId: data.cursoId,
          materiaId: data.materiaId,
          titulo: data.titulo,
          modo: data.modo,
          duracionMinutos: Number(data.duracionMinutos) || 40,
          expiresInHours: Number(data.expiresInHours) || 24,
          mostrarNotaAlAlumno: Boolean(form.querySelector('[name="mostrarNota"]')?.checked),
          antiTrampa: {
            shuffleQuestions: Boolean(form.querySelector('[name="atShuffleQuestions"]')?.checked),
            shuffleOptions: Boolean(form.querySelector('[name="atShuffleOptions"]')?.checked),
            oneAtATime: Boolean(form.querySelector('[name="atOneAtATime"]')?.checked),
            lockNavigation: Boolean(form.querySelector('[name="atLockNav"]')?.checked),
            blockClipboard: Boolean(form.querySelector('[name="atClipboard"]')?.checked),
            watermark: Boolean(form.querySelector('[name="atWatermark"]')?.checked),
            hideResultsUntilClose: Boolean(form.querySelector('[name="atHideResults"]')?.checked),
            maxFocusLoss: Number(form.querySelector('[name="atMaxFocus"]')?.value) || 3,
            actionOnFocusLimit: form.querySelector('[name="atFocusAction"]')?.value || 'flag',
          },
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'No se pudo crear la clase.');
      currentAula = payload.aula;
      renderQuestionEditor();
      void refreshActividadesCargables();
      showStep(2);
      showAppToast('Clase creada. Cargá una actividad existente o armá preguntas nuevas.', 'ok');
    } catch (error) {
      showAppToast(error instanceof Error ? error.message : 'Error al crear la clase.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('[data-clase-back-1]')?.addEventListener('click', () => showStep(1));

  root.querySelector('[data-clase-ai-generar]')?.addEventListener('click', async () => {
    if (!currentAula?.id) {
      showAppToast('Primero creá la clase.', 'warning');
      return;
    }
    const prompt = String(root.querySelector('[data-clase-ai-prompt]')?.value || '').trim();
    const actividadId = root.querySelector('[data-clase-ai-ref]')?.value || '';
    const filesInput = root.querySelector('[data-clase-ai-files]');
    const files = Array.from(filesInput?.files || []);
    if (!prompt && !actividadId && !files.length) {
      showAppToast('Indicá un pedido, una actividad de referencia o un documento.', 'warning');
      return;
    }
    const btn = root.querySelector('[data-clase-ai-generar]');
    const status = root.querySelector('[data-clase-ai-status]');
    btn.disabled = true;
    if (status) {
      status.hidden = false;
      status.textContent = 'Generando con IA… puede tardar unos segundos.';
    }
    try {
      const body = new FormData();
      if (prompt) body.set('prompt', prompt);
      if (actividadId) body.set('actividadId', actividadId);
      files.forEach((file) => body.append('documentos', file));
      const res = await fetch(`/api/aula-temporal/${currentAula.id}/generar-ia`, {
        method: 'POST',
        credentials: 'same-origin',
        body,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'No se pudo generar.');
      renderShare(payload.aula);
      showAppToast(`Listo: ${payload.generadas || payload.aula?.preguntas?.length || ''} preguntas cargadas. Descargá el documento referencia si querés.`, 'ok');
    } catch (error) {
      showAppToast(error instanceof Error ? error.message : 'Error al generar con IA.', 'error');
      if (status) status.textContent = error instanceof Error ? error.message : 'Error';
    } finally {
      btn.disabled = false;
      if (status && !status.textContent?.startsWith('Error') && !status.textContent?.includes('No se')) {
        status.hidden = true;
      }
    }
  });

  root.querySelector('[data-clase-doc]')?.addEventListener('click', () => {
    if (!currentAula?.id) {
      showAppToast('Todavía no hay clase publicada.', 'warning');
      return;
    }
    window.open(`/api/aula-temporal/${currentAula.id}/documento`, '_blank', 'noopener');
  });

  root.querySelector('[data-clase-cargar-existente]')?.addEventListener('click', async () => {
    if (!currentAula?.id) {
      showAppToast('Primero creá la clase.', 'warning');
      return;
    }
    const actividadId = root.querySelector('[data-clase-actividad-existente]')?.value;
    if (!actividadId) {
      showAppToast('Elegí una actividad de la lista.', 'warning');
      return;
    }
    const btn = root.querySelector('[data-clase-cargar-existente]');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/aula-temporal/${currentAula.id}/cargar-actividad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ actividadId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'No se pudo cargar.');
      currentAula = payload.aula;
      if (payload.aula?.needsReview) {
        const preview = payload.aula.preguntasPreview || payload.aula.preguntas || [];
        renderQuestionEditor(preview);
        showStep(2);
        showAppToast(
          payload.aula.importedFrom
            ? `Se importó “${payload.aula.importedFrom}”. Completá opciones/correctas y guardá.`
            : 'Actividad importada. Revisá las preguntas y guardá para publicar el link.',
          'ok',
        );
        return;
      }
      renderShare(payload.aula);
      showAppToast('Actividad cargada. Al cerrar la clase se auto-corrige.', 'ok');
    } catch (error) {
      showAppToast(error instanceof Error ? error.message : 'Error al cargar.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('[data-clase-guardar-actividad]')?.addEventListener('click', async () => {
    if (!currentAula?.id) {
      showAppToast('Primero creá la clase.', 'warning');
      return;
    }
    const preguntas = readQuestions();
    if (!preguntas.length) {
      showAppToast('Agregá al menos una pregunta digital.', 'warning');
      return;
    }
    const modo = new FormData(form).get('modo');
    if (modo === 'multiple_choice' && preguntas.some((q) => !String(q.tipo).startsWith('mc_'))) {
      showAppToast('En opción múltiple solo se permiten preguntas MC.', 'warning');
      return;
    }
    for (const q of preguntas) {
      if (String(q.tipo).startsWith('mc_') && (q.opciones.length < 2 || !q.correctas.length)) {
        showAppToast('Cada MC necesita opciones y al menos una correcta.', 'warning');
        return;
      }
    }
    const btn = root.querySelector('[data-clase-guardar-actividad]');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/aula-temporal/${currentAula.id}/actividad`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ preguntas, publicar: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'No se pudo guardar la actividad.');
      renderShare(payload.aula);
      showAppToast('Actividad lista. Compartí el link con el curso.', 'ok');
    } catch (error) {
      showAppToast(error instanceof Error ? error.message : 'Error al guardar.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('[data-clase-copy]')?.addEventListener('click', async () => {
    const url = root.querySelector('[data-clase-url]')?.textContent || '';
    try {
      await navigator.clipboard.writeText(url);
      showAppToast('Link copiado.', 'ok');
    } catch {
      showAppToast('Copiá el link manualmente.', 'warning');
    }
  });

  root.querySelector('[data-clase-refresh]')?.addEventListener('click', async () => {
    if (!currentAula?.id) return;
    const res = await fetch(`/api/aula-temporal/${currentAula.id}`, { credentials: 'same-origin' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      showAppToast(payload.error || 'No se pudieron cargar intentos.', 'error');
      return;
    }
    renderShare(payload.aula);
  });

  root.querySelector('[data-clase-close]')?.addEventListener('click', async () => {
    if (!currentAula?.id) return;
    if (!confirm('¿Cerrar la clase? Se auto-corregirán todas las entregas (MC + IA) y se cargarán las notas.')) return;
    const closeBtn = root.querySelector('[data-clase-close]');
    if (closeBtn) {
      closeBtn.disabled = true;
      closeBtn.textContent = 'Corrigiendo…';
    }
    const res = await fetch(`/api/aula-temporal/${currentAula.id}/cerrar`, { method: 'POST', credentials: 'same-origin' });
    const payload = await res.json().catch(() => ({}));
    if (closeBtn) {
      closeBtn.disabled = false;
      closeBtn.textContent = 'Cerrar clase y corregir';
    }
    if (!res.ok) {
      showAppToast(payload.error || 'No se pudo cerrar.', 'error');
      return;
    }
    showAppToast('Clase cerrada. Entregas corregidas automáticamente.', 'ok');
    renderShare(payload.aula);
  });

  root.querySelector('[data-clase-nueva]')?.addEventListener('click', () => {
    currentAula = null;
    form.reset();
    applyModoPreset();
    syncContextSelects();
    showStep(1);
  });
}

function activityTipoLabel(item) {
  const template = String(item?.contenido?.template || '');
  const tipoGen = String(item?.contenido?.tipoGeneracion || item?.contenido?.generadoPor || '');
  if (template.includes('integrador') || tipoGen === 'integrador') return 'Integrador';
  if (template.includes('examen') || tipoGen === 'examen') return 'Examen';
  return item?.tipo === 'tp' ? 'TP' : 'Evaluación';
}

async function renderActivitiesList(list, onLoaded) {
  if (!list) return [];
  const response = await fetch('/api/actividades');
  if (!response.ok) {
    replaceContent(list, emptyState('Sin actividades', 'Todavía no se pudieron cargar actividades.'));
    if (onLoaded) onLoaded([]);
    return [];
  }
  const data = await response.json();
  const allActividades = Array.isArray(data.actividades) ? data.actividades : [];
  knownHasActivity = allActividades.length > 0;
  if (knownHasActivity) sessionStorage.setItem('aula_clara_has_activity', '1');
  if (onLoaded) onLoaded(allActividades);

  const showAll = Boolean(document.querySelector('[data-activity-list-all]')?.checked);
  const ctx = getTeachingContext();
  let actividades = allActividades;
  if (!showAll && ctx.cursoId) {
    actividades = allActividades.filter((item) =>
      item.curso_id === ctx.cursoId && (!ctx.materiaId || item.materia_id === ctx.materiaId)
    );
  }

  if (!allActividades.length) {
    replaceContent(list, emptyState('Sin actividades', 'Creá la primera evaluación o TP en este panel.', {
      ctaLabel: 'Empezar a crear',
      onClick: () => {
        showSpaView('actividades');
        openActivityFlowTab('contenido');
        document.querySelector('[data-activities] [name="titulo"]')?.focus();
      },
    }));
    void updateActivityFlowStepper('contenido');
    return allActividades;
  }

  if (!actividades.length) {
    replaceContent(list, emptyState(
      'Sin actividades en este curso',
      showAll
        ? 'No hay actividades cargadas.'
        : 'No hay actividades para el Curso actual. Creá una o marcá “Ver todas”.',
      {
        ctaLabel: 'Crear actividad',
        onClick: () => {
          openActivityFlowTab('contenido');
          document.querySelector('[data-activities] [name="titulo"]')?.focus();
        },
      },
    ));
    void updateActivityFlowStepper('contenido');
    return allActividades;
  }

  replaceContent(list, ...actividades.map((item) =>
    el('article', { className: 'event-card' },
      el('div', {},
        tag(activityTipoLabel(item)),
        tag(item.estado === 'publicado' ? 'Publicado' : 'Borrador', item.estado === 'publicado' ? 'tag ok' : 'tag'),
      ),
      el('strong', {}, item.titulo),
      el('small', {}, [item.colegio, item.turno, item.curso, item.materia].filter(Boolean).join(' · ')),
      el('p', {}, item.fecha_publicacion ? `Publicación: ${item.fecha_publicacion}` : 'Sin fecha de publicación'),
      el('p', {}, item.fecha_vencimiento ? `Entrega: ${item.fecha_vencimiento}` : 'Sin fecha de entrega'),
      el('div', { className: 'actions-group' },
        el('button', { className: 'btn btn-primary btn-sm', type: 'button', dataset: { cargarEntregaActividad: item.id } }, 'Cargar entrega'),
        el('button', { className: 'btn btn-secondary btn-sm', type: 'button', dataset: { enviarActividad: item.id } }, 'Enviar a curso'),
      ),
    ),
  ));

  void updateActivityFlowStepper(
    document.querySelector('[data-activity-flow-tab].is-active')?.getAttribute('data-activity-flow-tab') || 'contenido',
  );
  return allActividades;
}

function formatSyncStatus(counts = {}) {
  const pending = (counts.pending || 0) + (counts.syncing || 0);
  const error = counts.error || 0;
  if (!navigator.onLine) return 'Sin conexión — los cambios quedan en este dispositivo';
  if (error > 0) return `${error} cambio${error === 1 ? '' : 's'} con error`;
  if (pending > 0) return `Hay ${pending} cambio${pending === 1 ? '' : 's'} sin subir`;
  return 'Todo guardado en la nube';
}

function renderImportResult(container, result, isError = false) {
  if (!container) return;
  container.hidden = false;
  container.className = `import-result ${isError ? 'import-result-error' : 'import-result-ok'}`;

  if (isError) {
    container.textContent = result?.error || 'No se pudo importar el archivo.';
    return;
  }

  const lines = [result.message || 'Importación completada.'];
  if (Array.isArray(result.errors) && result.errors.length) {
    const preview = result.errors.slice(0, 5).map((item) => `Fila ${item.row}: ${item.message}`);
    lines.push(`Errores (${result.errors.length}): ${preview.join(' · ')}${result.errors.length > 5 ? ' · …' : ''}`);
  }
  container.textContent = lines.join(' ');
}

function refreshExportPanelFilters(panel) {
  const schoolSelect = panel.querySelector('[data-export-school]');
  const courseSelect = panel.querySelector('[data-export-course]');
  const subjectSelect = panel.querySelector('[data-export-subject]');

  if (schoolSelect) {
    const selectedSchool = schoolSelect.value;
    fillSelect(
      schoolSelect,
      schoolNamesForSelect().map((nombre) => ({ id: nombre, nombre })),
      'Todas las escuelas',
    );
    if (selectedSchool) schoolSelect.value = selectedSchool;
  }

  if (courseSelect) {
    const selectedCourse = courseSelect.value;
    fillSelect(
      courseSelect,
      visibleCourses(schoolSelect?.value || ''),
      'Todos los cursos',
      'id',
      courseLabel,
    );
    if (selectedCourse && [...courseSelect.options].some((option) => option.value === selectedCourse)) {
      courseSelect.value = selectedCourse;
    }
  }

  if (subjectSelect) {
    const selectedSubject = subjectSelect.value;
    fillSelect(subjectSelect, activeSubjects(), 'Todas las materias');
    if (selectedSubject && [...subjectSelect.options].some((option) => option.value === selectedSubject)) {
      subjectSelect.value = selectedSubject;
    }
  }
}

function initExcelExport() {
  document.querySelectorAll('[data-excel-export]').forEach((panel) => {
    const schoolSelect = panel.querySelector('[data-export-school]');
    const courseSelect = panel.querySelector('[data-export-course]');
    const submitButton = panel.querySelector('[data-export-submit]');
    if (!submitButton) return;

    schoolSelect?.addEventListener('change', () => {
      if (!courseSelect) return;
      const selectedCourse = courseSelect.value;
      fillSelect(
        courseSelect,
        visibleCourses(schoolSelect.value || ''),
        'Todos los cursos',
        'id',
        courseLabel,
      );
      if (selectedCourse && [...courseSelect.options].some((option) => option.value === selectedCourse)) {
        courseSelect.value = selectedCourse;
      }
    });

    refreshExportPanelFilters(panel);

    submitButton.addEventListener('click', async () => {
      submitButton.disabled = true;
      const previousLabel = submitButton.textContent;
      submitButton.textContent = 'Preparando...';
      try {
        await syncPendingOperations();
        const params = new URLSearchParams();
        params.set('type', panel.dataset.excelExport || '');
        params.set('ciclo', String(activeCicloLectivo()));
        if (schoolSelect?.value) params.set('colegio', schoolSelect.value);
        if (courseSelect?.value) params.set('curso', courseSelect.value);
        const subjectSelect = panel.querySelector('[data-export-subject]');
        const fromInput = panel.querySelector('[data-export-from]');
        const toInput = panel.querySelector('[data-export-to]');
        if (subjectSelect?.value) params.set('materia', subjectSelect.value);
        if (fromInput?.value) params.set('desde', fromInput.value);
        if (toInput?.value) params.set('hasta', toInput.value);
        window.location.href = `/api/export?${params.toString()}`;
      } finally {
        window.setTimeout(() => {
          submitButton.disabled = false;
          submitButton.textContent = previousLabel;
        }, 800);
      }
    });
  });

  window.addEventListener('aula-clara:data-hydrated', () => {
    document.querySelectorAll('[data-excel-export]').forEach((panel) => refreshExportPanelFilters(panel));
  });

  onPanelRefresh(() => {
    document.querySelectorAll('[data-excel-export]').forEach((panel) => refreshExportPanelFilters(panel));
  });
}

async function bootstrap() {
  document.documentElement.dataset.appBooting = 'true';
  seed();
  initTheme();
  initMobileNav();

  const spaConfig = window.__AULA_CLARA_SPA__;
  if (spaConfig?.enabled) {
    initSpaRouter(spaConfig.initialView);
  }

  window.addEventListener('aula-clara:data-hydrated', refreshAllPanels);

  await resetOfflineDatabaseOnce();

  if (currentUser?.id) {
    await hydrateLocalStorageFromServer(currentUser.id, { notify: false });
  }

  initResponsiveTables();
  initDashboard();
  initOnboarding({
    getUserId: () => currentUser?.id || null,
    hasCourse: () => visibleCourses().length > 0,
    hasSubject: () => activeSubjects().length > 0,
    hasStudents: () => studentsInCiclo().length > 0,
    hasTeachingContext: () => teachingContextIsReady(),
    hasActivity: () => knownHasActivity || sessionStorage.getItem('aula_clara_has_activity') === '1',
    openTeachingContextPicker,
    onPanelRefresh,
  });
  initProductTour({
    getUserId: () => currentUser?.id || null,
  });
  initGuestSession({
    userId: currentUser?.id || null,
    isGuest: Boolean(currentUser?.isGuest),
  });
  initTeacherContext();
  initScheduleSuggestion();
  initGlobalTeachingContext();
  initStudents();
  initAttendance();
  initGrades();
  initCourses();
  initSubjects();
  initCalendar();
  initActivityFlowTabs();
  initToolsEntregas();
  initActivities();
  initExcelExport();
  initTeacherFeatures({
    getStudents: () => studentsInCiclo(),
    getCourses: () => read(KEYS.courses),
    getSubjects: () => activeSubjects(),
    getAttendance: () => read(KEYS.attendance),
    getGrades: () => read(KEYS.grades),
    getDashboardFilters: () => read(KEYS.dashboardFilters) || {},
    showSpaView,
    onPanelRefresh,
  });
  initSchoolCycleUi({
    readFilters: () => read(KEYS.dashboardFilters),
    writeFilters: (value) => write(KEYS.dashboardFilters, value),
    readCourses: () => read(KEYS.courses),
    writeCourses: (value) => write(KEYS.courses, value),
    readTeacherContext: () => read(KEYS.teacherContext),
    writeTeacherContext: (value) => write(KEYS.teacherContext, value),
    schoolNamesForSelect,
    queueCourseUpsert: (course) => queue('course', 'upsert', course),
    uid,
    nowIso,
    onChanged: () => notifyDataChanged({ scope: 'ciclo' }),
  });
  initToolsView({
    getCicloLectivo: () => activeCicloLectivo(),
    onImported: async (importType, result) => {
      if (importType === 'alumnos') {
        const importedCiclo = Number(result?.cicloLectivo);
        if (Number.isFinite(importedCiclo) && importedCiclo > 0) {
          const filters = read(KEYS.dashboardFilters) || {};
          write(KEYS.dashboardFilters, { ...filters, cicloLectivo: importedCiclo });
        }
      }
      let hydrated = false;
      if (currentUser?.id) {
        hydrated = await hydrateLocalStorageFromServer(currentUser.id);
        if (!hydrated) {
          hydrated = await hydrateLocalStorageFromServer(currentUser.id);
        }
      }
      if (!hydrated) {
        showAppToast('Se importó en el servidor, pero no se pudo actualizar la pantalla. Recargá la página.', 'warning');
      }
      if (importType === 'alumnos') {
        window.dispatchEvent(new CustomEvent('aula-clara:schools-changed'));
        showSpaView('registro');
      }
      notifyDataChanged({ scope: importType });
      if (importType === 'alumnos') {
        const root = document.querySelector('[data-students]');
        const list = root?.querySelector('[data-student-list]');
        if (list) renderStudents(list);
        const total = Number(result?.imported || 0) + Number(result?.updated || 0);
        const visible = studentsInCiclo().length;
        if (total > 0 && visible > 0) {
          showAppToast(
            `${visible} alumno(s) visibles en el ciclo ${activeCicloLectivo()}.`,
            'ok',
          );
        } else if (total > 0 && visible === 0) {
          showAppToast(
            `Se importaron ${total} alumno(s), pero no aparecen en el ciclo ${activeCicloLectivo()}. Revisá el ciclo lectivo arriba.`,
            'warning',
          );
        }
      }
    },
  });
  document.addEventListener('click', (event) => {
    const trigger = event.target?.closest?.('[data-tools-focus]');
    if (!trigger) return;
    const section = trigger.getAttribute('data-tools-focus');
    const tab = trigger.getAttribute('data-tools-tab');
    if (!section) return;
    event.preventDefault();
    if (section === 'ai' || section === 'contenido') {
      showSpaView('actividades');
      openActivityFlowTab('contenido');
      return;
    }
    if (section === 'entregas') {
      showSpaView('actividades');
      openActivityFlowTab('entregas');
      return;
    }
    if (section === 'corregir') {
      showSpaView('actividades');
      openActivityFlowTab('corregir');
      return;
    }
    navigateToToolsSection(section, tab || undefined);
  });
  initSyncUi({ formatSyncStatus });
  startAutoSync();
  appReady = true;
  delete document.documentElement.dataset.appBooting;
  refreshAllPanels();
}

document.addEventListener('submit', (event) => {
  if (appReady) return;
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.closest('[data-courses], [data-students], [data-subjects], [data-grades], [data-attendance], [data-teacher-context], [data-student-form]')) return;
  event.preventDefault();
}, true);

void bootstrap();
