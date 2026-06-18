import { countPendingOperations, getOperationStatusCounts, queueOfflineOperation, resetOfflineDatabaseOnce, saveAttendanceOffline } from './offline-db.ts';
import { hydrateLocalStorageFromServer, startAutoSync, syncPendingOperations } from './sync-client.ts';
import { initMobileNav, openMenu, closeMenu } from './ui-nav.js';
import { initSpaRouter } from './spa-router.ts';
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
  studentExcelMappings: 'aula_clara_student_excel_mappings',
};

const DEFAULTS = {
  [KEYS.courses]: [
    { id: 'curso-6-1-manana', nombre: '6to 1ra', escuela: 'Escuela Tecnica 1', turno: 'Manana' },
    { id: 'curso-5-2-tarde', nombre: '5to 2da', escuela: 'Escuela Tecnica 1', turno: 'Tarde' },
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
  [KEYS.attendance]: [],
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
  const names = activeSchools().map((school) => school.nombre);
  const fromCourses = read(KEYS.courses).map((course) => course.escuela).filter(Boolean);
  return [...new Set([...names, ...fromCourses])].sort((a, b) => a.localeCompare(b, 'es'));
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
  return course ? `${course.nombre} - ${course.turno}` : 'Sin curso';
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
  const students = activeStudents();
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
        acredita: rate !== null && rate >= ATTENDANCE_PASS_THRESHOLD,
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
      { value: acreditados, label: `Acreditan (≥${ATTENDANCE_PASS_THRESHOLD}%)` },
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
    emptyState('Sin registros de asistencia', 'No hay asistencias tomadas con los filtros actuales.'),
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

  const students = activeStudents().filter((student) =>
    (!courseId || student.cursoId === courseId) &&
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
    const start = parseTime(item.desde);
    const end = parseTime(item.hasta);
    const days = Array.isArray(item.dias) ? item.dias.map(String) : [];
    return days.includes(todayDay) && start !== null && end !== null && minutes >= start && minutes <= end;
  }) || null;
}

function applySuggestedContextTo(selects = {}, options = {}) {
  const context = currentSuggestedContext();
  if (!context) return null;
  const hasUrlContext = ['curso', 'materia'].some((param) => urlContext().has(param));
  const shouldApply = options.force || !hasUrlContext;
  if (!shouldApply) return context;

  if (selects.school && !selects.school.value && context.escuela) selects.school.value = context.escuela;
  if (selects.course && !selects.course.value && context.cursoId) selects.course.value = context.cursoId;
  if (selects.subject && !selects.subject.value && context.materiaId) selects.subject.value = context.materiaId;
  return context;
}

function describeContext(context) {
  if (!context) return 'Configurá tu horario para ver sugerencias automáticas.';
  const course = courseById(context.cursoId);
  const subject = subjectById(context.materiaId);
  return `${context.escuela || course?.escuela || 'Escuela'} - ${course?.nombre || 'Curso'} - ${subject?.nombre || 'Materia'} (${context.desde || '--:--'} a ${context.hasta || '--:--'})`;
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

function initDashboard() {
  const root = document.querySelector('[data-dashboard]');
  const filters = document.querySelector('[data-dashboard-filters]');
  if (!root) return;

  const saved = read(KEYS.dashboardFilters) || {};
  if (filters) {
    const schoolSelect = filters.querySelector('[name="escuela"]');
    const courseSelect = filters.querySelector('[name="curso"]');
    const subjectSelect = filters.querySelector('[name="materia"]');
    const schools = schoolNamesForSelect();
    fillSelect(schoolSelect, schools.map((school) => ({ id: school, nombre: school })), 'Todas las escuelas');
    fillSelect(courseSelect, read(KEYS.courses), 'Todos los cursos', 'id', (course) => `${course.nombre} - ${course.turno}`);
    fillSelect(subjectSelect, activeSubjects(), 'Todas las materias');
    schoolSelect.value = saved.escuela || '';
    courseSelect.value = saved.curso || '';
    subjectSelect.value = saved.materia || '';
    applySuggestedContextTo({ school: schoolSelect, course: courseSelect, subject: subjectSelect });
    write(KEYS.dashboardFilters, {
      escuela: schoolSelect.value,
      curso: courseSelect.value,
      materia: subjectSelect.value,
    });
    filters.addEventListener('change', () => {
      write(KEYS.dashboardFilters, {
        escuela: schoolSelect.value,
        curso: courseSelect.value,
        materia: subjectSelect.value,
      });
      renderDashboard(root);
    });
    window.addEventListener('aula-clara:schools-changed', () => {
      const selected = schoolSelect.value;
      fillSchoolSelect(schoolSelect, 'Todas las escuelas', selected);
    });
  }

  document.querySelectorAll('[data-context-summary]').forEach((item) => {
    item.textContent = describeContext(currentSuggestedContext());
  });
  renderDashboard(root);
  onPanelRefresh(() => {
    if (filters) {
      const schoolSelect = filters.querySelector('[name="escuela"]');
      const courseSelect = filters.querySelector('[name="curso"]');
      const subjectSelect = filters.querySelector('[name="materia"]');
      const schools = schoolNamesForSelect();
      fillSelect(schoolSelect, schools.map((school) => ({ id: school, nombre: school })), 'Todas las escuelas');
      fillSelect(courseSelect, read(KEYS.courses), 'Todos los cursos', 'id', (course) => `${course.nombre} - ${course.turno}`);
      fillSelect(subjectSelect, activeSubjects(), 'Todas las materias');
    }
    document.querySelectorAll('[data-context-summary]').forEach((item) => {
      item.textContent = describeContext(currentSuggestedContext());
    });
    renderDashboard(root);
  });
}

function renderDashboard(root) {
  const filters = read(KEYS.dashboardFilters) || {};
  const courses = read(KEYS.courses).filter((course) =>
    (!filters.escuela || course.escuela === filters.escuela) &&
    (!filters.curso || course.id === filters.curso)
  );
  const courseIds = new Set(courses.map((course) => course.id));
  const students = activeStudents().filter((student) => courseIds.has(student.cursoId));
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
    return (studentAverage !== null && studentAverage < 6) || (studentAttendance !== null && studentAttendance < 75);
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
  fillSelect(courseSelect, read(KEYS.courses), 'Curso', 'id', courseLabel);
  fillSelect(subjectSelect, activeSubjects(), 'Materia');

  window.addEventListener('aula-clara:schools-changed', (event) => {
    fillSchoolSelect(schoolSelect, 'Escuela', event.detail?.selected || schoolSelect?.value || '');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const dias = data.getAll('dias').map(String);
    if (!dias.length) {
      alert('Elegí al menos un día.');
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
      updatedAt: nowIso(),
    };
    write(KEYS.teacherContext, [...read(KEYS.teacherContext), item]);
    form.reset();
    renderTeacherContextList(list);
    document.querySelectorAll('[data-context-summary]').forEach((node) => {
      node.textContent = describeContext(currentSuggestedContext());
    });
  });

  list.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-delete-context]');
    if (!remove) return;
    write(KEYS.teacherContext, read(KEYS.teacherContext).filter((item) => item.id !== remove.dataset.deleteContext));
    renderTeacherContextList(list);
  });

  renderTeacherContextList(list);
  onPanelRefresh(() => {
    fillSelect(schoolSelect, schoolNamesForSelect().map((school) => ({ id: school, nombre: school })), 'Escuela');
    fillSelect(courseSelect, read(KEYS.courses), 'Curso', 'id', courseLabel);
    fillSelect(subjectSelect, activeSubjects(), 'Materia');
    renderTeacherContextList(list);
    document.querySelectorAll('[data-context-summary]').forEach((node) => {
      node.textContent = describeContext(currentSuggestedContext());
    });
  });
}

function renderTeacherContextList(list) {
  const items = read(KEYS.teacherContext);
  if (!items.length) {
    replaceContent(list, emptyState('Sin horario cargado', 'Agregá tus clases habituales para activar sugerencias automáticas.'));
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

function validateStudentExcelFile(input, feedback, form) {
  const maxMb = Number(form?.dataset.maxFileMb || 5);
  const maxBytes = maxMb * 1024 * 1024;
  const allowedExt = ['.xlsx', '.xls'];
  const file = input?.files?.[0];

  if (!file) {
    if (feedback) {
      feedback.textContent = '';
      feedback.classList.add('is-hidden');
    }
    return { ok: false, error: 'Seleccioná un archivo Excel (.xlsx).' };
  }

  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
  if (!allowedExt.includes(ext)) {
    const msg = `"${file.name}" no es un Excel válido. Usá .xlsx o .xls.`;
    if (feedback) {
      feedback.textContent = msg;
      feedback.classList.remove('is-hidden', 'is-ok');
      feedback.classList.add('is-warning');
    }
    return { ok: false, error: msg };
  }

  if (file.size > maxBytes) {
    const msg = `"${file.name}" supera ${maxMb} MB.`;
    if (feedback) {
      feedback.textContent = msg;
      feedback.classList.remove('is-hidden', 'is-ok');
      feedback.classList.add('is-warning');
    }
    return { ok: false, error: msg };
  }

  if (feedback) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    feedback.textContent = `${file.name} listo para cargar (${sizeMb} MB).`;
    feedback.classList.remove('is-hidden', 'is-warning');
    feedback.classList.add('is-ok');
  }

  return { ok: true, file };
}

const STUDENT_MAPPABLE_FIELDS = [
  { field: 'escuela', label: 'Escuela', required: true },
  { field: 'curso', label: 'Curso', required: true },
  { field: 'turno', label: 'Turno', required: true },
  { field: 'apellido', label: 'Apellido', required: false, hint: 'Opcional si ya tenés Nombre completo' },
  { field: 'nombre', label: 'Nombre', required: false, hint: 'Obligatorio si no usás Apellido' },
  { field: 'dni', label: 'DNI', required: false },
  { field: 'tutor', label: 'Tutor / contacto', required: false },
  { field: 'materias', label: 'Materias', required: false },
];

function readStudentExcelTemplates() {
  return read(KEYS.studentExcelMappings);
}

function writeStudentExcelTemplates(templates) {
  write(KEYS.studentExcelMappings, templates);
}

function normalizeExcelHeaderLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function scoreExcelTemplateMatch(templateLabels, currentHeaders) {
  if (!Array.isArray(templateLabels) || !Array.isArray(currentHeaders) || !templateLabels.length || !currentHeaders.length) {
    return 0;
  }
  let hits = 0;
  templateLabels.forEach((label) => {
    const normalized = normalizeExcelHeaderLabel(label);
    if (!normalized) return;
    if (currentHeaders.some((header) => normalizeExcelHeaderLabel(header) === normalized)) hits += 1;
  });
  return hits / Math.max(templateLabels.length, currentHeaders.length);
}

function findBestExcelTemplate(templates, headers) {
  let best = null;
  let bestScore = 0;
  templates.forEach((template) => {
    const score = scoreExcelTemplateMatch(template.columnLabels, headers);
    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  });
  return bestScore >= 0.55 ? best : null;
}

function buildStudentExcelMappingFromPreview(preview) {
  return {
    headerRow: Number(preview?.mapping?.headerRow || preview?.headerRow || 1),
    columns: { ...(preview?.mapping?.columns || {}) },
  };
}

function validateStudentExcelMappingClient(mapping) {
  const errors = [];
  const columns = mapping?.columns || {};
  ['escuela', 'curso', 'turno'].forEach((field) => {
    if (columns[field] == null || columns[field] === '') errors.push(`Asigná la columna de ${field}.`);
  });
  if ((columns.nombre == null || columns.nombre === '') && (columns.apellido == null || columns.apellido === '')) {
    errors.push('Asigná al menos Nombre o Apellido.');
  }
  return errors;
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
  if (!form || !list) return;

  const modeInputs = root.querySelectorAll('[data-student-mode-input]');
  const modePanels = root.querySelectorAll('[data-student-mode-panel]');
  const excelForm = root.querySelector('[data-student-excel-form]');
  const excelFileInput = root.querySelector('[data-student-excel-file]');
  const excelFeedback = root.querySelector('[data-student-excel-feedback]');
  const excelPreview = root.querySelector('[data-student-excel-preview]');
  const excelResult = root.querySelector('[data-student-excel-result]');
  const excelSubmitBtn = excelForm?.querySelector('[data-student-excel-submit]');
  const excelMappingPanel = root.querySelector('[data-student-excel-mapping]');
  const excelMappingFields = root.querySelector('[data-student-excel-mapping-fields]');
  const excelHeaderRowInput = root.querySelector('[data-student-excel-header-row]');
  const excelApplyMappingBtn = root.querySelector('[data-student-excel-apply-mapping]');
  const excelTemplateSelect = root.querySelector('[data-student-excel-template-select]');
  const excelTemplateNameInput = root.querySelector('[data-student-excel-template-name]');
  const excelTemplateSaveBtn = root.querySelector('[data-student-excel-template-save]');
  const excelTemplateDeleteBtn = root.querySelector('[data-student-excel-template-delete]');

  let currentStudentExcelPreview = null;
  let currentStudentExcelMapping = null;
  let appliedExcelTemplateName = '';

  const renderStudentExcelTemplateOptions = (selectedId = '') => {
    if (!excelTemplateSelect) return;
    const templates = readStudentExcelTemplates();
    const options = ['<option value="">Sin plantilla</option>'];
    templates.forEach((template) => {
      const selected = template.id === selectedId ? ' selected' : '';
      options.push(`<option value="${template.id}"${selected}>${template.name}</option>`);
    });
    excelTemplateSelect.innerHTML = options.join('');
  };

  const renderStudentExcelMappingFields = (preview) => {
    if (!excelMappingFields) return;
    const columns = preview?.availableColumns || [];
    const mapping = preview?.mapping?.columns || {};
    const fields = preview?.mappableFields || STUDENT_MAPPABLE_FIELDS;

    excelMappingFields.innerHTML = fields.map((field) => {
      const options = ['<option value="">(No usar)</option>'];
      columns.forEach((column) => {
        const selected = Number(mapping[field.field]) === column.index ? ' selected' : '';
        const label = column.label || `Columna ${column.index + 1}`;
        options.push(`<option value="${column.index}"${selected}>${label}</option>`);
      });
      const tag = field.required ? 'obligatorio' : 'opcional';
      const hint = field.hint ? `<small>${field.hint}</small>` : '';
      return `
        <div class="excel-mapping-field">
          <label>
            <span>${field.label} <span class="excel-ref-tag">${tag}</span></span>
            <select data-student-excel-map-field="${field.field}">
              ${options.join('')}
            </select>
            ${hint}
          </label>
        </div>
      `;
    }).join('');
  };

  const collectStudentExcelMapping = () => {
    const headerRow = Math.max(1, Number(excelHeaderRowInput?.value || currentStudentExcelPreview?.headerRow || 1));
    const columns = {};
    excelMappingFields?.querySelectorAll('[data-student-excel-map-field]').forEach((select) => {
      const field = select.getAttribute('data-student-excel-map-field');
      if (!field) return;
      const value = select.value;
      columns[field] = value === '' ? null : Number(value);
    });
    return { headerRow, columns };
  };

  const syncStudentExcelMappingFromUI = () => {
    currentStudentExcelMapping = collectStudentExcelMapping();
    return currentStudentExcelMapping;
  };

  const showStudentExcelMappingPanel = (preview) => {
    if (!excelMappingPanel) return;
    excelMappingPanel.classList.remove('is-hidden');
    if (excelHeaderRowInput) excelHeaderRowInput.value = String(preview?.mapping?.headerRow || preview?.headerRow || 1);
    renderStudentExcelMappingFields(preview);
    renderStudentExcelTemplateOptions();
  };

  const hideStudentExcelMappingPanel = () => {
    excelMappingPanel?.classList.add('is-hidden');
    if (excelMappingFields) excelMappingFields.innerHTML = '';
    appliedExcelTemplateName = '';
  };

  const renderStudentExcelPreview = (preview) => {
    if (!excelPreview) return;
    if (!preview) {
      excelPreview.hidden = true;
      excelPreview.textContent = '';
      if (excelSubmitBtn) excelSubmitBtn.disabled = false;
      return;
    }

    excelPreview.hidden = false;
    excelPreview.className = `import-result ${preview.canImport ? 'import-result-ok' : 'import-result-error'}`;

    const lines = [
      `Hoja "${preview.sheetName || '?'}" · encabezados en fila ${preview.headerRow || 1}.`,
      `${preview.validRows} fila(s) lista(s) para cargar · ${preview.invalidRows} con error · ${preview.totalRows} total.`,
    ];

    if (appliedExcelTemplateName) {
      lines.push(`Plantilla aplicada: ${appliedExcelTemplateName}.`);
    }

    if (preview.requiresMapping) {
      lines.push('Revisá el mapeo de columnas antes de cargar.');
    }

    if (preview.preview?.length) {
      const sample = preview.preview
        .map((row) => `${row.nombre} (${row.curso}, ${row.turno})`)
        .join(' · ');
      lines.push(`Ejemplos: ${sample}${preview.validRows > preview.preview.length ? ' · …' : ''}`);
    }

    if (preview.mappingErrors?.length) {
      lines.push(`Mapeo: ${preview.mappingErrors.join(' · ')}`);
    }

    if (preview.errors?.length) {
      const errorPreview = preview.errors.slice(0, 4).map((item) => `Fila ${item.row}: ${item.message}`);
      lines.push(`Errores: ${errorPreview.join(' · ')}${preview.errors.length > 4 ? ' · …' : ''}`);
    }

    excelPreview.textContent = lines.join(' ');
    if (excelSubmitBtn) excelSubmitBtn.disabled = !preview.canImport;
  };

  const previewStudentExcelFile = async (file, mapping = null) => {
    if (!file) {
      renderStudentExcelPreview(null);
      hideStudentExcelMappingPanel();
      currentStudentExcelPreview = null;
      currentStudentExcelMapping = null;
      return null;
    }

    const formData = new FormData();
    formData.append('file', file);
    if (mapping) formData.append('mapping', JSON.stringify(mapping));

    const response = await fetch('/api/import/preview', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
    });
    const preview = await response.json().catch(() => ({}));
    if (!response.ok) {
      renderStudentExcelPreview({ canImport: false, errors: [{ row: 0, message: preview.error || 'No se pudo leer la planilla.' }] });
      return null;
    }

    currentStudentExcelPreview = preview;
    currentStudentExcelMapping = buildStudentExcelMappingFromPreview(preview);
    showStudentExcelMappingPanel(preview);
    renderStudentExcelPreview(preview);
    return preview;
  };

  const tryApplyMatchingExcelTemplate = async (file, preview) => {
    const templates = readStudentExcelTemplates();
    const matched = findBestExcelTemplate(templates, preview?.detectedHeaders || []);
    if (!matched) return preview;

    appliedExcelTemplateName = matched.name;
    if (excelTemplateSelect) excelTemplateSelect.value = matched.id;
    if (excelTemplateNameInput) excelTemplateNameInput.value = matched.name;
    if (excelHeaderRowInput) excelHeaderRowInput.value = String(matched.headerRow || preview.headerRow || 1);

    const remapped = await previewStudentExcelFile(file, {
      headerRow: matched.headerRow || preview.headerRow || 1,
      columns: { ...(matched.columns || {}) },
    });
    return remapped || preview;
  };

  const setStudentMode = (mode) => {
    const value = mode === 'excel' ? 'excel' : 'manual';
    modeInputs.forEach((input) => {
      input.checked = input.value === value;
    });
    modePanels.forEach((panel) => {
      panel.classList.toggle('is-hidden', panel.getAttribute('data-student-mode-panel') !== value);
    });
  };

  excelFileInput?.addEventListener('change', async () => {
    const check = validateStudentExcelFile(excelFileInput, excelFeedback, excelForm);
    if (!check.ok) {
      renderStudentExcelPreview(null);
      hideStudentExcelMappingPanel();
      return;
    }
    if (excelResult) {
      excelResult.hidden = true;
      excelResult.textContent = '';
    }
    try {
      if (excelSubmitBtn) {
        excelSubmitBtn.disabled = true;
        excelSubmitBtn.textContent = 'Analizando...';
      }
      await previewStudentExcelFile(check.file);
      if (check.file && currentStudentExcelPreview) {
        await tryApplyMatchingExcelTemplate(check.file, currentStudentExcelPreview);
      }
    } catch (error) {
      console.error('[aula-clara] student excel preview failed', error);
      renderStudentExcelPreview({ canImport: false, errors: [{ row: 0, message: 'No se pudo analizar la planilla.' }] });
    } finally {
      if (excelSubmitBtn) excelSubmitBtn.textContent = 'Cargar alumnos';
    }
  });

  excelApplyMappingBtn?.addEventListener('click', async () => {
    const check = validateStudentExcelFile(excelFileInput, excelFeedback, excelForm);
    if (!check.ok) return;

    const mapping = syncStudentExcelMappingFromUI();
    const mappingErrors = validateStudentExcelMappingClient(mapping);
    if (mappingErrors.length) {
      renderStudentExcelPreview({
        canImport: false,
        mappingErrors,
        errors: mappingErrors.map((message) => ({ row: 0, message })),
        validRows: 0,
        invalidRows: 0,
        totalRows: 0,
      });
      return;
    }

    appliedExcelTemplateName = '';
    try {
      if (excelApplyMappingBtn) {
        excelApplyMappingBtn.disabled = true;
        excelApplyMappingBtn.textContent = 'Actualizando...';
      }
      await previewStudentExcelFile(check.file, mapping);
    } catch (error) {
      console.error('[aula-clara] student excel mapping preview failed', error);
      renderStudentExcelPreview({ canImport: false, errors: [{ row: 0, message: 'No se pudo aplicar el mapeo.' }] });
    } finally {
      if (excelApplyMappingBtn) {
        excelApplyMappingBtn.disabled = false;
        excelApplyMappingBtn.textContent = 'Actualizar vista previa';
      }
    }
  });

  excelTemplateSelect?.addEventListener('change', async () => {
    const templateId = excelTemplateSelect.value;
    if (!templateId) {
      appliedExcelTemplateName = '';
      return;
    }
    const template = readStudentExcelTemplates().find((item) => item.id === templateId);
    const check = validateStudentExcelFile(excelFileInput, excelFeedback, excelForm);
    if (!template || !check.ok) return;

    appliedExcelTemplateName = template.name;
    if (excelTemplateNameInput) excelTemplateNameInput.value = template.name;
    if (excelHeaderRowInput) excelHeaderRowInput.value = String(template.headerRow || 1);
    await previewStudentExcelFile(check.file, {
      headerRow: template.headerRow,
      columns: { ...(template.columns || {}) },
    });
  });

  excelTemplateSaveBtn?.addEventListener('click', () => {
    const mapping = syncStudentExcelMappingFromUI();
    const mappingErrors = validateStudentExcelMappingClient(mapping);
    if (mappingErrors.length) {
      alert(mappingErrors.join('\n'));
      return;
    }

    const name = String(excelTemplateNameInput?.value || '').trim();
    if (!name) {
      alert('Escribí un nombre para la plantilla.');
      excelTemplateNameInput?.focus();
      return;
    }

    const templates = readStudentExcelTemplates();
    const existing = templates.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const template = {
      id: existing?.id || uid('excel-map'),
      name,
      headerRow: mapping.headerRow,
      columns: mapping.columns,
      columnLabels: (currentStudentExcelPreview?.detectedHeaders || []).map((label) => String(label || '')),
      updatedAt: new Date().toISOString(),
    };

    const next = existing
      ? templates.map((item) => (item.id === existing.id ? template : item))
      : [...templates, template];

    writeStudentExcelTemplates(next);
    renderStudentExcelTemplateOptions(template.id);
    if (excelTemplateSelect) excelTemplateSelect.value = template.id;
    appliedExcelTemplateName = template.name;
    alert(`Plantilla "${name}" guardada.`);
  });

  excelTemplateDeleteBtn?.addEventListener('click', () => {
    const templateId = excelTemplateSelect?.value;
    if (!templateId) {
      alert('Seleccioná una plantilla para eliminar.');
      return;
    }
    const templates = readStudentExcelTemplates();
    const target = templates.find((item) => item.id === templateId);
    if (!target) return;
    if (!window.confirm(`¿Eliminar la plantilla "${target.name}"?`)) return;

    writeStudentExcelTemplates(templates.filter((item) => item.id !== templateId));
    renderStudentExcelTemplateOptions();
    if (excelTemplateNameInput) excelTemplateNameInput.value = '';
    appliedExcelTemplateName = '';
    alert('Plantilla eliminada.');
  });

  excelForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const check = validateStudentExcelFile(excelFileInput, excelFeedback, excelForm);
    if (!check.ok) {
      alert(check.error || 'Seleccioná un archivo Excel válido.');
      excelFileInput?.focus();
      return;
    }

    const mapping = syncStudentExcelMappingFromUI();
    const mappingErrors = validateStudentExcelMappingClient(mapping);
    if (mappingErrors.length) {
      alert(mappingErrors.join('\n'));
      return;
    }

    const submitBtn = excelForm.querySelector('[data-student-excel-submit]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Cargando...';
    }
    if (excelResult) {
      excelResult.hidden = true;
      excelResult.textContent = '';
    }

    try {
      const formData = new FormData();
      formData.append('type', 'alumnos');
      formData.append('file', check.file);
      formData.append('mapping', JSON.stringify(mapping));

      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        renderImportResult(excelResult, result, true);
        return;
      }

      if (currentUser?.id) {
        await hydrateLocalStorageFromServer(currentUser.id);
      }
      window.dispatchEvent(new CustomEvent('aula-clara:schools-changed'));
      notifyDataChanged();
      refreshSchoolOptions();
      renderStudents(list, form);
      renderImportResult(excelResult, result, false);
      excelForm.reset();
      hideStudentExcelMappingPanel();
      currentStudentExcelPreview = null;
      currentStudentExcelMapping = null;
      renderStudentExcelPreview(null);
      if (excelFeedback) {
        excelFeedback.textContent = '';
        excelFeedback.classList.add('is-hidden');
        excelFeedback.classList.remove('is-ok', 'is-warning');
      }
    } catch (error) {
      console.error('[aula-clara] student excel upload failed', error);
      renderImportResult(excelResult, { error: 'Error de red al cargar la hoja. Revisá tu conexión e intentá de nuevo.' }, true);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Cargar alumnos';
      }
    }
  });

  const refreshCourseOptions = (school = '', selectedCourseId = '') => {
    const courses = read(KEYS.courses).filter((course) => !school || course.escuela === school);
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

  schoolSelect?.addEventListener('change', () => {
    refreshCourseOptions(schoolSelect.value);
  });

  window.addEventListener('aula-clara:schools-changed', (event) => {
    refreshSchoolOptions(event.detail?.selected || schoolSelect?.value || '');
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const editingId = form.dataset.editingId;
    const students = read(KEYS.students);
    const selectedSubjects = Array.from(form.querySelectorAll('[name="subjectIds"]')).map((input) => input.value);
    const pendingSubject = await upsertSubjectByName(data.nuevaMateria);
    if (pendingSubject) selectedSubjects.push(pendingSubject.id);
    const course = courseById(data.cursoId);
    if (!data.escuela) {
      alert('Elegí una escuela.');
      return;
    }
    if (!data.cursoId) {
      alert('Elegí un curso.');
      return;
    }
    if (course && course.escuela !== data.escuela) {
      alert('El curso seleccionado no pertenece a la escuela elegida.');
      return;
    }
    const payload = {
      id: editingId || uid('al'),
      nombre: data.nombre.trim(),
      dni: String(data.dni || '').trim(),
      cursoId: data.cursoId,
      tutor: String(data.tutor || '').trim(),
      subjectIds: [...new Set(selectedSubjects)],
      activo: true,
      updatedAt: nowIso(),
    };
    const next = editingId ? students.map((student) => student.id === editingId ? payload : student) : [...students, payload];
    write(KEYS.students, next);
    form.reset();
    delete form.dataset.editingId;
    form.querySelector('button[type="submit"]').textContent = 'Guardar alumno';
    const refreshStudentPanel = () => {
      refreshSchoolOptions();
      renderStudentSubjectPicker(subjectContainer);
      renderStudents(list, form);
    };
    await persistAndRefresh('student', 'upsert', payload, refreshStudentPanel);
  });

  list.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-student]');
    const remove = event.target.closest('[data-delete-student]');
    const students = read(KEYS.students);

    if (edit) {
      activateStudentMode('manual');
      const student = students.find((item) => item.id === edit.dataset.editStudent);
      if (!student) return;
      form.dataset.editingId = student.id;
      form.nombre.value = student.nombre;
      form.dni.value = student.dni || '';
      const course = courseById(student.cursoId);
      refreshSchoolOptions(course?.escuela || '', student.cursoId);
      form.cursoId.value = student.cursoId;
      form.tutor.value = student.tutor || '';
      renderStudentSubjectPicker(subjectContainer, studentSubjectIds(student));
      form.querySelector('button[type="submit"]').textContent = 'Actualizar alumno';
    }

    if (remove) {
      const id = remove.dataset.deleteStudent;
      if (!confirm('Eliminar este alumno? Si tiene notas/asistencias se desactivara para no romper historiales.')) return;
      const next = students.map((student) => student.id === id ? { ...student, activo: false, updatedAt: nowIso() } : student);
      write(KEYS.students, next);
      await persistAndRefresh('student', 'delete', { id, updatedAt: nowIso() }, () => renderStudents(list, form));
    }
  });

  renderStudents(list, form);
  onPanelRefresh(() => {
    refreshSchoolOptions();
    renderStudents(list, form);
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
  const students = activeStudents();
  if (!students.length) {
    replaceContent(list, emptyState('No hay alumnos registrados', 'Usa el formulario para crear el primer legajo.'));
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
  const takeView = root.querySelector('[data-attendance-take-view]');
  const historyView = root.querySelector('[data-attendance-history-view]');
  const viewToggle = root.querySelector('[data-attendance-view-toggle]');
  const courseSelect = root.querySelector('[data-filter-course]');
  const subjectSelect = root.querySelector('[data-filter-subject]');
  const dateInput = root.querySelector('[data-attendance-date]');
  const list = root.querySelector('[data-attendance-list]');
  const saveBar = root.querySelector('[data-attendance-save-bar]');
  const saveHint = root.querySelector('[data-attendance-save-hint]');
  const saveButton = root.querySelector('[data-attendance-save]');
  const syncStatus = root.querySelector('[data-sync-status]');
  const connectionStatus = root.querySelector('[data-connection-status]');
  const syncButton = root.querySelector('[data-sync-button]');
  const historySchool = root.querySelector('[data-history-filter-school]');
  const historyCourse = root.querySelector('[data-history-filter-course]');
  const historySubject = root.querySelector('[data-history-filter-subject]');
  const historyFrom = root.querySelector('[data-history-filter-from]');
  const historyTo = root.querySelector('[data-history-filter-to]');
  let showingHistory = false;
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

  dateInput.value = today();
  fillSelect(courseSelect, read(KEYS.courses), 'Todos los cursos', 'id', (course) => `${course.nombre} - ${course.turno}`);
  fillSelect(subjectSelect, activeSubjects(), 'Materia');
  applySelectFromUrl(courseSelect, 'curso');
  applySelectFromUrl(subjectSelect, 'materia');
  applySuggestedContextTo({ course: courseSelect, subject: subjectSelect });
  if (!subjectSelect.value && activeSubjects()[0]) subjectSelect.value = activeSubjects()[0].id;

  const schools = schoolNamesForSelect();
  fillSelect(historySchool, schools.map((school) => ({ id: school, nombre: school })), 'Todos los colegios');
  fillSelect(historyCourse, read(KEYS.courses), 'Todos los cursos', 'id', courseLabel);
  fillSelect(historySubject, activeSubjects(), 'Todas las materias');

  const renderHistory = () => renderAttendanceHistory(root);
  [historySchool, historyCourse, historySubject, historyFrom, historyTo].forEach((control) => {
    control?.addEventListener('change', renderHistory);
  });

  viewToggle?.addEventListener('click', () => {
    if (!showingHistory && !confirmDiscardAttendanceDraft()) return;
    showingHistory = !showingHistory;
    takeView?.classList.toggle('is-hidden', showingHistory);
    historyView?.classList.toggle('is-hidden', !showingHistory);
    viewToggle.textContent = showingHistory ? 'Tomar asistencia' : 'Ver asistencias';
    if (showingHistory) renderHistory();
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
      renderAttendance();
    });
  };

  [courseSelect, subjectSelect, dateInput].forEach(handleAttendanceFilterChange);

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-attendance-state]');
    if (!button) return;
    const { date, subjectId } = attendanceContext();
    if (!subjectId) {
      alert('Elegí una materia antes de marcar asistencia.');
      return;
    }
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
    } catch (error) {
      console.error('[aula-clara] attendance save failed', error);
      alert('No se pudieron guardar las asistencias. Intentá de nuevo.');
    } finally {
      renderAttendance();
    }
  });

  window.addEventListener('aula-clara:sync-finished', (event) => {
    if (syncStatus) syncStatus.textContent = formatSyncStatus(event.detail?.counts);
  });
  const updateConnectionStatus = () => {
    if (!connectionStatus) return;
    connectionStatus.textContent = navigator.onLine ? 'Online' : 'Offline';
    connectionStatus.className = `tag ${navigator.onLine ? 'ok' : 'warning'}`;
  };
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  updateConnectionStatus();
  syncButton?.addEventListener('click', async () => {
    syncButton.disabled = true;
    syncButton.textContent = 'Sincronizando...';
    const result = await syncPendingOperations();
    syncButton.disabled = false;
    syncButton.textContent = 'Sincronizar';
    if (syncStatus) syncStatus.textContent = formatSyncStatus(result.counts);
  });
  Promise.all([countPendingOperations(), getOperationStatusCounts()]).then(([, counts]) => {
    if (syncStatus) syncStatus.textContent = formatSyncStatus(counts);
  });

  function renderAttendance() {
    const students = activeStudents().filter((student) =>
      (!courseSelect.value || student.cursoId === courseSelect.value) &&
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
      replaceContent(list, emptyState('No hay alumnos para estos filtros', 'Registra alumnos o cambia el curso seleccionado.'));
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
  onPanelRefresh(() => {
    fillSelect(courseSelect, read(KEYS.courses), 'Todos los cursos', 'id', (course) => `${course.nombre} - ${course.turno}`);
    fillSelect(subjectSelect, activeSubjects(), 'Materia');
    fillSelect(historyCourse, read(KEYS.courses), 'Todos los cursos', 'id', courseLabel);
    fillSelect(historySubject, activeSubjects(), 'Todas las materias');
    renderAttendance();
    if (showingHistory) renderHistory();
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
  const courses = read(KEYS.courses);
  if (!schoolName) return courses;
  return courses.filter((course) => String(course.escuela || '').toLowerCase() === schoolName.toLowerCase());
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
  const takeView = root.querySelector('[data-grades-take-view]');
  const detailView = root.querySelector('[data-grades-detail-view]');
  const viewToggle = root.querySelector('[data-grades-view-toggle]');
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
  let showingDetail = false;
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
    const students = activeStudents().filter((student) =>
      (!courseFilter?.value || student.cursoId === courseFilter.value) &&
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
        emptyState('Sin alumnos', 'No hay alumnos para los filtros seleccionados o falta elegir materia.'),
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
  fillSelect(detailCourseFilter, read(KEYS.courses), 'Todos los cursos', 'id', courseLabel);
  refreshSubjectOptions();
  if (detailPeriodFilter) detailPeriodFilter.value = defaultGradePeriod();
  applySelectFromUrl(courseFilter, 'curso');
  applySelectFromUrl(detailCourseFilter, 'curso');
  applySelectFromUrl(subjectFilter, 'materia');
  applySelectFromUrl(detailSubjectFilter, 'materia');
  applySuggestedContextTo({ course: courseFilter, subject: subjectFilter });
  if (metaForm) {
    metaForm.fecha.value = today();
    if (periodSelect) periodSelect.value = defaultGradePeriod();
    importanceSelect.value = String(importanceByType(typeSelect.value));
  }

  const renderDetail = () => renderGradesDetail(root);
  [detailCourseFilter, detailSubjectFilter, detailPeriodFilter].forEach((control) => {
    control?.addEventListener('change', renderDetail);
  });

  viewToggle?.addEventListener('click', () => {
    if (!showingDetail && !confirmDiscardGradesDraft()) return;
    showingDetail = !showingDetail;
    takeView?.classList.toggle('is-hidden', showingDetail);
    detailView?.classList.toggle('is-hidden', !showingDetail);
    viewToggle.textContent = showingDetail ? 'Cargar notas' : 'Ver calificaciones';
    if (showingDetail) {
      if (detailCourseFilter && courseFilter?.value) detailCourseFilter.value = courseFilter.value;
      if (detailSubjectFilter && subjectFilter?.value) detailSubjectFilter.value = subjectFilter.value;
      renderDetail();
    }
  });

  const deliveryFilters = () => ({
    tipo: deliveryTypeFilter?.value || '',
    estado: deliveryStatusFilter?.value || '',
    desde: deliveryFromFilter?.value || '',
    hasta: deliveryToFilter?.value || '',
  });

  const renderAll = async () => {
    if (subjectHidden) subjectHidden.value = subjectFilter?.value || '';
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
    handleEvaluationMetaChange();
    renderAll();
  });
  courseFilter?.addEventListener('change', () => {
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
    saveButton.disabled = true;
    saveButton.textContent = 'Guardando...';
    try {
      await commitGradesDraft(draftGrades, meta);
      notifyDataChanged({ scope: 'grades' });
      renderAll();
    } catch (error) {
      console.error('[aula-clara] grades save failed', error);
      alert(error instanceof Error ? error.message : 'No se pudieron guardar las calificaciones. Intentá de nuevo.');
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
      if (!confirm('¿Eliminar esta calificación? El promedio se recalculará automáticamente.')) return;
      write(KEYS.grades, grades.filter((grade) => grade.id !== id));
      await persistAndRefresh('grade', 'delete', { id, updatedAt: nowIso() }, renderAll);
    }
  });

  renderAll();
  onPanelRefresh(() => {
    refreshSchoolOptions();
    refreshCourseOptions(courseFilter?.value || '');
    fillSelect(detailCourseFilter, read(KEYS.courses), 'Todos los cursos', 'id', courseLabel);
    refreshSubjectOptions(subjectFilter?.value || '');
    void renderAll();
    if (showingDetail) renderDetail();
  });
}

function renderGrades(table, subjectId = '', courseId = '') {
  const students = activeStudents().filter((student) =>
    (!courseId || student.cursoId === courseId) &&
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
    emptyState('Sin alumnos', 'No hay alumnos para los filtros seleccionados.'),
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
  return activeStudents().filter((student) =>
    (!courseId || student.cursoId === courseId) &&
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
    replaceContent(list, emptyState('Sin actividades para este filtro', 'Creá actividades en la sección Actividades o ajustá curso/materia.'));
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
    replaceContent(list, emptyState('Sin trabajos cargados', 'Usá el formulario para subir entregas de alumnos o docentes.'));
    return entregas;
  }

  replaceContent(list, ...entregas.map((item) => {
    const archivos = Array.isArray(item.archivos) ? item.archivos : [];
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

    return el('article', { className: 'student-row' },
      el('div', {},
        el('strong', {}, item.titulo),
        el('small', {}, [item.curso, item.materia, item.alumno].filter(Boolean).join(' · ')),
        el('small', {}, `${item.submitted_at?.slice(0, 10) || ''} · ${trabajoEstadoLabel(item)}`),
      ),
      el('div', { className: 'notes-list' }, ...archivosNodes),
      el('div', { className: 'actions-group' },
        el('button', { className: 'btn btn-secondary btn-sm', type: 'button', dataset: { reenviarTrabajo: item.id } }, 'Reenviar'),
      ),
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
  const trabajoForm = root.querySelector('[data-trabajo-upload-form]');
  if (!trabajoForm) return { refresh: async () => {} };

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

  const getCourseId = () => context.getCourseId?.() || '';
  const getMateriaId = () => context.getMateriaId?.() || '';
  const getCourse = () => context.getCourse?.() || courseById(getCourseId());
  const getSubject = () => context.getSubject?.() || subjectById(getMateriaId());
  const getActividades = () => context.getActividades?.() || [];

  const refreshStudentOptions = () => {
    const students = activeStudents().filter((student) =>
      (!getCourseId() || student.cursoId === getCourseId()) &&
      studentHasSubject(student, getMateriaId())
    );
    fillSelect(trabajoAlumnoSelect, students, 'Sin alumno específico');
  };

  const refresh = async () => {
    const cursoId = getCourseId();
    const materiaId = getMateriaId();
    if (!cursoId || !materiaId) {
      fillActividadSelect(trabajoActividadSelect, [], {
        placeholder: 'Elegí curso y materia arriba',
        required: true,
      });
      if (trabajoHistory) {
        replaceContent(trabajoHistory, emptyState('Elegí curso y materia', 'Definí el contexto arriba para cargar entregas.'));
      }
      return;
    }

    refreshStudentOptions();
    let actividades = getActividades();
    if (!actividades.length) {
      actividades = await fetchActividadesForContext(cursoId, materiaId);
      context.setActividades?.(actividades);
    }
    fillActividadSelect(trabajoActividadSelect, actividades, {
      cursoId,
      materiaId,
      placeholder: 'Elegí una actividad',
      required: true,
    });
    await renderTrabajoHistory(
      trabajoHistory,
      cursoId,
      materiaId,
      trabajoEstadoFilter?.value || '',
    );
  };

  fillSelect(reenviarCurso, read(KEYS.courses), 'Elegir curso', 'id', courseLabel);
  fillSelect(reenviarMateria, activeSubjects(), 'Elegir materia');

  reenviarCurso?.addEventListener('change', () => {
    const students = activeStudents().filter((student) =>
      (!reenviarCurso.value || student.cursoId === reenviarCurso.value)
    );
    fillSelect(reenviarAlumno, students, 'Sin alumno específico');
  });

  trabajoEstadoFilter?.addEventListener('change', () => { refresh(); });

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
      alert('Completá colegio, turno, curso y materia antes de cargar un trabajo.');
      return;
    }

    const fileCheck = validateTrabajoFiles(trabajoFilesInput, trabajoFileFeedback, {
      maxFiles: Number(trabajoForm.dataset.maxFiles || 5),
      maxFileMb: Number(trabajoForm.dataset.maxFileMb || 15),
    });
    if (!fileCheck.ok) return;

    const data = Object.fromEntries(new FormData(trabajoForm));
    if (!data.actividadId) {
      alert('Elegí la actividad del curso a la que corresponde la entrega.');
      return;
    }

    const payload = new FormData();
    payload.set('cursoId', cursoId);
    payload.set('materiaId', materiaId);
    payload.set('colegio', course.escuela || context.getColegio?.() || '');
    payload.set('turno', course.turno || context.getTurno?.() || '');
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
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Error al cargar el trabajo.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  trabajoHistory?.addEventListener('click', (event) => {
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
      alert('Completá curso, materia y título.');
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
      alert(error instanceof Error ? error.message : 'Error al reenviar.');
    }
  });

  return {
    refresh,
    openForActividad(actividadId) {
      if (trabajoActividadSelect) {
        trabajoActividadSelect.value = actividadId;
        trabajoActividadSelect.dispatchEvent(new Event('change'));
      }
      const actividad = getActividades().find((item) => item.id === actividadId);
      const tituloInput = trabajoForm.querySelector('[name="titulo"]');
      if (actividad && tituloInput) tituloInput.value = actividad.titulo;
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
      const deps = read(KEYS.grades).some((grade) => grade.subjectId === id) || read(KEYS.attendance).some((item) => item.subjectId === id);
      const msg = deps ? 'Esta materia tiene notas/asistencias. Se marcara como inactiva.' : 'Eliminar esta materia?';
      if (!confirm(msg)) return;
      write(KEYS.subjects, subjects.map((subject) => subject.id === id ? { ...subject, activo: false, updatedAt: nowIso() } : subject));
      await persistAndRefresh('subject', 'delete', { id, updatedAt: nowIso() }, () => renderSubjects(list, form));
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!appReady) return;
    const data = Object.fromEntries(new FormData(form));
    const escuela = String(data.escuela || '').trim();
    const nombre = String(data.nombre || '').trim();
    const turno = String(data.turno || '').trim();
    if (!escuela) {
      alert('Elegí una escuela.');
      return;
    }
    if (!nombre || !turno) {
      alert('Completá curso y turno.');
      return;
    }
    const courses = read(KEYS.courses);
    const payload = {
      id: uid('curso'),
      nombre,
      escuela,
      turno,
      cicloLectivo: new Date().getFullYear(),
      updatedAt: nowIso(),
    };
    courses.push(payload);
    write(KEYS.courses, courses);
    form.reset();
    await persistAndRefresh('course', 'upsert', payload, () => refreshCoursePanel('', payload.id));
  });

  onPanelRefresh(() => refreshCoursePanel());
}

function renderCourses(list, highlightCourseId = '') {
  if (!list) return;
  const courses = read(KEYS.courses);
  const students = activeStudents();
  const subjects = activeSubjects();
  if (!courses.length) {
    replaceContent(list, emptyState('No hay cursos creados', 'Agregá una escuela y completá el formulario para crear el primer curso.'));
    return;
  }
  replaceContent(list, ...courses.map((course) => {
    const courseStudents = students.filter((student) => student.cursoId === course.id);
    const defaultSubjectId = subjects[0]?.id || '';
    const actionContext = { curso: course.id, materia: defaultSubjectId };
    const isHighlighted = highlightCourseId && course.id === highlightCourseId;
    return el('details', {
      className: 'course-accordion',
      ...(isHighlighted ? { attrs: { open: '' } } : {}),
    },
      el('summary', {},
        el('span', {},
          el('strong', {}, course.nombre),
          el('small', {}, `${course.escuela} · Turno ${course.turno}`),
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
          el('div', { className: 'notes-list' }, ...subjects.map((subject) => tag(subject.nombre))),
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
  const contexts = read(KEYS.teacherContext).filter((item) => {
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

  fillSelect(courseSelect, read(KEYS.courses), 'Todos los cursos', 'id', (course) => `${course.nombre} - ${course.turno}`);
  fillSelect(subjectSelect, activeSubjects(), 'Todas las materias');
  fillSelect(eventCourseSelect, read(KEYS.courses), 'Sin curso', 'id', (course) => `${course.nombre} - ${course.turno}`);
  fillSelect(eventSubjectSelect, activeSubjects(), 'Sin materia');

  applySelectFromUrl(courseSelect, 'curso');
  applySelectFromUrl(subjectSelect, 'materia');
  applySuggestedContextTo({ course: courseSelect, subject: subjectSelect });

  if (eventTypeSelect) {
    eventTypeSelect.value = 'ausencia';
  }

  const load = () => loadCalendar(root, monthInput.value, courseSelect.value, subjectSelect.value);
  [monthInput, courseSelect, subjectSelect].forEach((control) => control.addEventListener('change', load));

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
      alert(error.error || 'No se pudo guardar el evento.');
      return;
    }

    eventForm.reset();
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

  load();
  onPanelRefresh(() => {
    fillSelect(courseSelect, read(KEYS.courses), 'Todos los cursos', 'id', (course) => `${course.nombre} - ${course.turno}`);
    fillSelect(subjectSelect, activeSubjects(), 'Todas las materias');
    fillSelect(eventCourseSelect, read(KEYS.courses), 'Sin curso', 'id', (course) => `${course.nombre} - ${course.turno}`);
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
  });
  if (courseId) params.set('curso', courseId);
  if (subjectId) params.set('materia', subjectId);

  const response = await fetch(`/api/calendar?${params.toString()}`);
  if (!response.ok) return;
  const data = await response.json();
  const events = Array.isArray(data.events) ? data.events : [];
  const scheduleEvents = buildTeacherScheduleEvents(start, end, courseId, subjectId);

  if (!data.preferences?.calendar_alerts && !localStorage.getItem(storageKey('aula_clara_calendar_alerts_dismissed'))) {
    root.querySelector('[data-calendar-opt-in]')?.showModal?.();
  }

  renderCalendar(root, start, [...events, ...scheduleEvents]);
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
        alert('No se pudo abrir la ventana de impresión. Permití ventanas emergentes para esta página.');
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
  const modeInputs = root.querySelectorAll('[data-activity-mode-input]');
  const modePanels = root.querySelectorAll('[data-activity-mode-panel]');
  const workspace = root.querySelector('[data-activity-workspace]');
  const schoolSelect = form.colegio;
  const shiftSelect = form.turno;
  const courseSelect = form.cursoId;
  const subjectSelect = form.materiaId;

  let lastGenerated = null;
  let progressTimer = null;
  let cachedActividadesList = [];

  const getActivityMode = () => root.querySelector('[data-activity-mode-input]:checked')?.value || 'manual';

  let trabajosEntregas = { refresh: async () => {}, openForActividad: () => {} };

  const setActivityMode = (mode) => {
    const value = ['ai', 'cargar'].includes(mode) ? mode : 'manual';
    modeInputs.forEach((input) => {
      input.checked = input.value === value;
    });
    modePanels.forEach((panel) => {
      const active = panel.getAttribute('data-activity-mode-panel') === value;
      panel.classList.toggle('is-hidden', !active);
    });
    if (value === 'cargar') void trabajosEntregas.refresh();
  };

  modeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) setActivityMode(input.value);
    });
  });
  setActivityMode(getActivityMode());

  const refreshActividadesContext = async () => {
    const cursoId = courseSelect?.value || '';
    const materiaId = subjectSelect?.value || '';
    if (cursoId && materiaId) {
      cachedActividadesList = await fetchActividadesForContext(cursoId, materiaId);
    }
    await trabajosEntregas.refresh();
  };

  trabajosEntregas = initTrabajosEntregas(root, {
    getCourseId: () => courseSelect?.value || '',
    getMateriaId: () => subjectSelect?.value || '',
    getColegio: () => schoolSelect?.value || '',
    getTurno: () => shiftSelect?.value || '',
    getCourse: () => courseById(courseSelect?.value),
    getSubject: () => subjectById(subjectSelect?.value),
    getActividades: () => cachedActividadesList,
    setActividades: (items) => { cachedActividadesList = items; },
    onUploaded: () => renderActivitiesList(list, (items) => { cachedActividadesList = items; }),
  });

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
    setActivityMode('manual');
    workspace?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (aiForm) {
    aiForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const aiData = new FormData(aiForm);
      const mainData = new FormData(form);
      const files = aiForm.querySelector('[data-activity-ai-files]')?.files;
      if (!files?.length) {
        alert('Adjuntá al menos un documento PDF, DOCX o TXT.');
        return;
      }
      const maxFiles = Number(aiForm.dataset.maxFiles || 6);
      const maxFileBytes = Number(aiForm.dataset.maxFileBytes || 8 * 1024 * 1024);
      const invalidCount = files.length > maxFiles;
      const invalidSize = Array.from(files).some((file) => file.size > maxFileBytes);
      if (invalidCount || invalidSize) {
        renderAiFileFeedback();
        alert('Revisá los archivos seleccionados: superan los límites permitidos.');
        return;
      }
      if (!mainData.get('colegio') || !mainData.get('turno') || !mainData.get('cursoId') || !mainData.get('materiaId')) {
        alert('Completá colegio, turno, curso y materia antes de generar con IA.');
        return;
      }

      const selectedCourse = courseById(mainData.get('cursoId'));
      const selectedSubject = subjectById(mainData.get('materiaId'));
      const payload = new FormData();
      payload.set('tipoGeneracion', aiData.get('tipoGeneracion') || 'tp');
      payload.set('colegio', mainData.get('colegio'));
      payload.set('turno', mainData.get('turno'));
      payload.set('cursoId', mainData.get('cursoId'));
      payload.set('materiaId', mainData.get('materiaId'));
      payload.set('cursoNombre', selectedCourse?.nombre || '');
      payload.set('materiaNombre', selectedSubject?.nombre || '');
      payload.set('titulo', mainData.get('titulo') || '');
      payload.set('nivelAcademico', aiData.get('nivelAcademico') || '');
      payload.set('notasDocente', aiData.get('notasDocente') || '');
      Array.from(files).forEach((file) => payload.append('documentos', file));

      setAiLoading(true, 'Sincronizando cursos y generando material con IA…');
      await syncPendingOperations();
      aiPreview?.classList.add('is-hidden');
      aiSourceReport?.classList.add('is-hidden');

      try {
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
      } catch (error) {
        setAiLoading(false, '');
        alert(error instanceof Error ? error.message : 'Error al generar la actividad.');
      }
    });
  }

  aiWord?.addEventListener('click', () => {
    if (!lastGenerated?.html) return alert('Generá una actividad antes de exportar.');
    downloadActivityWord(lastGenerated.html, lastGenerated.titulo);
  });

  aiPdf?.addEventListener('click', () => {
    if (!lastGenerated?.html) return alert('Generá una actividad antes de exportar.');
    downloadActivityPdf(lastGenerated.html, lastGenerated.titulo);
  });

  aiApply?.addEventListener('click', () => {
    if (!lastGenerated) return alert('No hay contenido generado para aplicar.');
    applyGeneratedToForm(lastGenerated);
    alert('Contenido aplicado. Revisá en «Realizar a mano» y guardá la actividad.');
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
    const tituloDoc = data.titulo ? data.titulo.toUpperCase() : 'ACTIVIDAD SIN TÍTULO';

    let html = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 800px; margin: auto;">
        <h1 style="color: #2c3e50; text-align: center; border-bottom: 2px solid #2c3e50; padding-bottom: 10px;">${tituloDoc}</h1>
        <table style="width: 100%; margin-top: 20px; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Colegio:</strong> ${data.colegio || ''}</td>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Turno:</strong> ${data.turno || ''}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Curso:</strong> ${cursoNombre || ''}</td>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Materia:</strong> ${materiaNombre || ''}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>${data.tipo === 'tp' ? 'Publicación del TP' : 'Aviso'}:</strong> ${data.fechaPublicacion || '-'}</td>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>${data.tipo === 'tp' ? 'Entrega del TP' : 'Entrega'}:</strong> ${data.fechaVencimiento || '-'}</td>
          </tr>
        </table>
    `;

    if (data.tipo === 'evaluacion') {
      const preguntas = String(editor.querySelector('[data-activity-questions]')?.value || '')
        .split('\n').map(p => p.trim()).filter(Boolean);

      html += `<h3 style="color: #2c3e50; margin-top: 30px;">Detalle del aviso:</h3><ol style="margin-left: 20px;">`;
      if (preguntas.length > 0) {
        preguntas.forEach(p => {
          html += `<li style="margin-bottom: 15px; padding-bottom: 60px; border-bottom: 1px dashed #ccc; font-size: 15px;">${p}</li>`;
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
        <p style="white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-left: 4px solid #3498db; font-size: 15px; line-height: 1.6;">${consigna || 'Sin consigna detallada.'}</p>
      `;
      if (criterios) {
        html += `
          <h4 style="color: #2c3e50; margin-top: 20px;">Criterios de Evaluación:</h4>
          <ul>
            ${criterios.split(',').map(c => `<li style="margin-bottom: 5px; font-size: 14px;">${c.trim()}</li>`).join('')}
          </ul>
        `;
      }
    }

    html += `</div>`;
    return { html, titulo: data.titulo || 'Actividad' };
  }

  if (btnDescargarWord) {
    btnDescargarWord.addEventListener('click', () => {
      const { html, titulo } = obtenerDatosDocumento();
      if (!titulo && !form.titulo.value) {
        return alert('Ingresá un título o generá una actividad con IA antes de descargar.');
      }
      downloadActivityWord(html, titulo || form.titulo.value);
    });
  }

  if (btnDescargarPdf) {
    btnDescargarPdf.addEventListener('click', () => {
      const { html, titulo } = obtenerDatosDocumento();
      if (!titulo && !form.titulo.value) {
        return alert('Ingresá un título o generá una actividad con IA antes de exportar.');
      }
      downloadActivityPdf(html, titulo || form.titulo.value);
    });
  }

  const schools = schoolNamesForSelect();
  const shifts = [...new Set(read(KEYS.courses).map((course) => course.turno).filter(Boolean))];
  fillSelect(schoolSelect, schools.map((school) => ({ id: school, nombre: school })), 'Colegio');
  fillSelect(shiftSelect, shifts.map((shift) => ({ id: shift, nombre: shift })), 'Turno');
  fillSelect(courseSelect, read(KEYS.courses), 'Curso', 'id', (course) => `${course.nombre} - ${course.turno}`);
  fillSelect(subjectSelect, activeSubjects(), 'Materia');
  applySuggestedContextTo({ school: schoolSelect, course: courseSelect, subject: subjectSelect });
  const syncCourseFields = () => {
    const course = courseById(courseSelect.value);
    if (!course) return;
    schoolSelect.value = course.escuela || schoolSelect.value;
    shiftSelect.value = course.turno || shiftSelect.value;
  };
  courseSelect.addEventListener('change', () => {
    syncCourseFields();
    refreshActividadesContext();
  });
  subjectSelect.addEventListener('change', () => { refreshActividadesContext(); });
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
    const data = Object.fromEntries(new FormData(form));
    const tipo = data.tipo;
    const files = Array.from(editor.querySelector('[data-activity-images]')?.files || []);
    const contenido = tipo === 'evaluacion'
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

    const selectedCourse = courseById(data.cursoId);
    const selectedSubject = subjectById(data.materiaId);
    await syncPendingOperations();

    const response = await fetch('/api/actividades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo,
        colegio: data.colegio,
        turno: data.turno,
        cursoId: data.cursoId,
        materiaId: data.materiaId,
        cursoNombre: selectedCourse?.nombre || '',
        materiaNombre: selectedSubject?.nombre || '',
        titulo: data.titulo,
        fechaPublicacion: data.fechaPublicacion,
        fechaVencimiento: data.fechaVencimiento,
        contenido,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      alert(error.error || 'No se pudo guardar la actividad.');
      return;
    }

    form.reset();
    root.querySelector('[name="fechaPublicacion"]').value = today();
    renderEditor();
    await renderActivitiesList(list, (items) => { cachedActividadesList = items; });
  });

  const enviarDialog = root.querySelector('[data-activity-enviar-dialog]');
  const enviarForm = root.querySelector('[data-activity-enviar-form]');
  const enviarSourceLabel = root.querySelector('#activity-enviar-source-label');
  const enviarColegio = root.querySelector('[data-enviar-colegio]');
  const enviarTurno = root.querySelector('[data-enviar-turno]');
  const enviarCurso = root.querySelector('[data-enviar-curso]');
  const enviarMateria = root.querySelector('[data-enviar-materia]');

  const schoolsForEnviar = schoolNamesForSelect();
  const shiftsForEnviar = [...new Set(read(KEYS.courses).map((course) => course.turno).filter(Boolean))];
  fillSelect(enviarColegio, schoolsForEnviar.map((school) => ({ id: school, nombre: school })), 'Colegio');
  fillSelect(enviarTurno, shiftsForEnviar.map((shift) => ({ id: shift, nombre: shift })), 'Turno');
  fillSelect(enviarCurso, read(KEYS.courses), 'Curso', 'id', courseLabel);
  fillSelect(enviarMateria, activeSubjects(), 'Materia');

  const syncEnviarCourseFields = () => {
    const course = courseById(enviarCurso?.value);
    if (!course || !enviarColegio || !enviarTurno) return;
    enviarColegio.value = course.escuela || enviarColegio.value;
    enviarTurno.value = course.turno || enviarTurno.value;
  };

  enviarCurso?.addEventListener('change', syncEnviarCourseFields);

  const openEnviarDialog = (actividadId) => {
    const actividad = cachedActividadesList.find((item) => item.id === actividadId);
    if (!actividad || !enviarForm || !enviarDialog) return;

    enviarForm.actividadId.value = actividad.id;
    enviarForm.titulo.value = actividad.titulo || '';
    enviarForm.fechaPublicacion.value = actividad.fecha_publicacion || '';
    enviarForm.fechaVencimiento.value = actividad.fecha_vencimiento || '';

    if (enviarColegio) enviarColegio.value = form.colegio?.value || actividad.colegio || enviarColegio.value;
    if (enviarTurno) enviarTurno.value = form.turno?.value || actividad.turno || enviarTurno.value;
    if (enviarCurso) enviarCurso.value = form.cursoId?.value || actividad.curso_id || enviarCurso.value;
    if (enviarMateria) enviarMateria.value = form.materiaId?.value || actividad.materia_id || enviarMateria.value;
    syncEnviarCourseFields();

    if (enviarSourceLabel) {
      enviarSourceLabel.textContent = `Vas a enviar «${actividad.titulo}» (${activityTipoLabel(actividad)}) desde ${[actividad.curso, actividad.materia].filter(Boolean).join(' · ')}.`;
    }

    enviarDialog.showModal();
  };

  list?.addEventListener('click', (event) => {
    const enviarBtn = event.target.closest('[data-enviar-actividad]');
    if (enviarBtn) {
      openEnviarDialog(enviarBtn.dataset.enviarActividad);
      return;
    }

    const cargarBtn = event.target.closest('[data-cargar-entrega-actividad]');
    if (!cargarBtn) return;

    const actividad = cachedActividadesList.find((item) => item.id === cargarBtn.dataset.cargarEntregaActividad);
    if (actividad) {
      if (schoolSelect) schoolSelect.value = actividad.colegio || schoolSelect.value;
      if (shiftSelect) shiftSelect.value = actividad.turno || shiftSelect.value;
      if (courseSelect) courseSelect.value = actividad.curso_id || courseSelect.value;
      if (subjectSelect) subjectSelect.value = actividad.materia_id || subjectSelect.value;
      syncCourseFields();
      refreshActividadesContext().then(() => {
        setActivityMode('cargar');
        trabajosEntregas.openForActividad(actividad.id);
        workspace?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }

    setActivityMode('cargar');
    trabajosEntregas.openForActividad(cargarBtn.dataset.cargarEntregaActividad);
    workspace?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  enviarForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    if (!submitter || submitter.value === 'cancel') {
      enviarDialog?.close();
      return;
    }

    const data = Object.fromEntries(new FormData(enviarForm));
    const selectedCourse = courseById(data.cursoId);
    const selectedSubject = subjectById(data.materiaId);
    if (!data.actividadId || !data.colegio || !data.turno || !data.cursoId || !data.materiaId) {
      alert('Completá colegio, turno, curso y materia destino.');
      return;
    }

    await syncPendingOperations();

    try {
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
      alert(`Actividad enviada a ${selectedCourse?.nombre || 'el curso'} (${selectedSubject?.nombre || 'materia'}).`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Error al enviar la actividad.');
    }
  });

  renderActivitiesList(list, (items) => { cachedActividadesList = items; });
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
    replaceContent(list, emptyState('Sin actividades', 'Todavia no se pudieron cargar actividades.'));
    if (onLoaded) onLoaded([]);
    return [];
  }
  const data = await response.json();
  const actividades = Array.isArray(data.actividades) ? data.actividades : [];
  if (onLoaded) onLoaded(actividades);

  if (!actividades.length) {
    replaceContent(list, emptyState('Sin actividades', 'Prepara una evaluación o TP para empezar.'));
    return actividades;
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

  return actividades;
}

function formatSyncStatus(counts = {}) {
  const pending = (counts.pending || 0) + (counts.syncing || 0);
  const synced = counts.synced || 0;
  const error = counts.error || 0;
  return `${pending} pendientes · ${synced} sincronizadas · ${error} con error`;
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
      read(KEYS.courses).filter((course) => !schoolSelect?.value || course.escuela === schoolSelect.value),
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
        read(KEYS.courses).filter((course) => !schoolSelect.value || course.escuela === schoolSelect.value),
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
}

function initExcelImport() {
  document.querySelectorAll('[data-excel-import]').forEach((panel) => {
    const type = panel.dataset.excelImport;
    const fileInput = panel.querySelector('[data-import-file]');
    const submitButton = panel.querySelector('[data-import-submit]');
    const resultEl = panel.querySelector('[data-import-result]');
    if (!type || !fileInput || !submitButton) return;

    submitButton.addEventListener('click', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        alert('Seleccioná un archivo Excel (.xlsx).');
        fileInput.focus();
        return;
      }

      submitButton.disabled = true;
      const previousLabel = submitButton.textContent;
      submitButton.textContent = 'Importando...';
      if (resultEl) {
        resultEl.hidden = true;
        resultEl.textContent = '';
      }

      try {
        const formData = new FormData();
        formData.append('type', type);
        formData.append('file', file);

        const response = await fetch('/api/import', {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          renderImportResult(resultEl, result, true);
          return;
        }

        if (currentUser?.id) {
          await hydrateLocalStorageFromServer(currentUser.id);
        }
        notifyDataChanged();
        renderImportResult(resultEl, result, false);
        fileInput.value = '';
      } catch (error) {
        console.error('[aula-clara] excel import failed', error);
        renderImportResult(resultEl, { error: 'Error de red al importar. Revisá tu conexión e intentá de nuevo.' }, true);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = previousLabel;
      }
    });
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
  initTeacherContext();
  initStudents();
  initAttendance();
  initGrades();
  initCourses();
  initSubjects();
  initCalendar();
  initActivities();
  initExcelExport();
  initExcelImport();
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
