import {
  countPendingOperations,
  getOperationStatusCounts,
  openOfflineDb,
  queueOfflineOperation,
  saveAttendanceOffline,
} from './offline-db.ts';
import { startAutoSync, syncPendingOperations } from './sync-client.ts';
import { initMobileNav, openMenu, closeMenu } from './ui-nav.js';
import { initSpaRouter, registerSpaViewRefresh } from './spa-router.ts';
import { isIndexedDbEmpty, readLocalOrIndexed, writeIndexedCache } from './local-data-cache.ts';

const currentUser = window.__AULA_CLARA_USER__ || null;

const KEYS = {
  students: 'aula_clara_students',
  courses: 'aula_clara_courses',
  subjects: 'aula_clara_subjects',
  attendance: 'aula_clara_attendance',
  grades: 'aula_clara_grades',
  dashboardFilters: 'aula_clara_dashboard_filters',
  teacherContext: 'aula_clara_teacher_context',
  activities: 'aula_clara_activities',
  theme: 'aula_clara_theme',
};

const DEFAULTS = {
  [KEYS.courses]: [
    { id: 'curso-6-1-manana', nombre: '6to 1ra', escuela: 'Escuela Tecnica 1', turno: 'Manana' },
    { id: 'curso-5-2-tarde', nombre: '5to 2da', escuela: 'Escuela Tecnica 1', turno: 'Tarde' },
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
  [KEYS.activities]: [],
};

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(key)) || 'null') ?? DEFAULTS[key] ?? [];
  } catch {
    return DEFAULTS[key] ?? [];
  }
}

function write(key, value) {
  localStorage.setItem(storageKey(key), JSON.stringify(value));
}

function seed() {
  Object.entries(DEFAULTS).forEach(([key, value]) => {
    if (!localStorage.getItem(storageKey(key))) write(key, value);
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

function courseById(id) {
  return read(KEYS.courses).find((course) => course.id === id);
}

function subjectById(id) {
  return read(KEYS.subjects).find((subject) => subject.id === id);
}

function fillSelect(select, items, placeholder, valueKey = 'id', labeler = (item) => item.nombre) {
  if (!select) return;
  select.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    items.map((item) => `<option value="${esc(item[valueKey])}">${esc(labeler(item))}</option>`).join('');
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
  if (root.dataset.bound === 'true') {
    renderDashboard(root);
    document.querySelectorAll('[data-context-summary]').forEach((item) => {
      item.textContent = describeContext(currentSuggestedContext());
    });
    return;
  }
  root.dataset.bound = 'true';

  const saved = read(KEYS.dashboardFilters) || {};
  if (filters) {
    const schoolSelect = filters.querySelector('[name="escuela"]');
    const courseSelect = filters.querySelector('[name="curso"]');
    const subjectSelect = filters.querySelector('[name="materia"]');
    const schools = [...new Set(read(KEYS.courses).map((course) => course.escuela))];
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
  }

  document.querySelectorAll('[data-context-summary]').forEach((item) => {
    item.textContent = describeContext(currentSuggestedContext());
  });
  renderDashboard(root);
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

  root.innerHTML = `
    <div class="metric"><strong>${students.length}</strong><span>Alumnos</span></div>
    <div class="metric"><strong>${courses.length}</strong><span>Cursos</span></div>
    <div class="metric"><strong>${avg === null ? '-' : avg.toFixed(1)}</strong><span>Promedio</span></div>
    <div class="metric"><strong>${present === null ? '-' : present.toFixed(0) + '%'}</strong><span>Asistencia</span></div>
  `;

  const alerts = document.querySelector('[data-alerts]');
  if (alerts) {
    alerts.innerHTML = risk === 0
      ? '<div class="empty"><h3>Sin alertas en este contexto</h3><p>El filtro actual no muestra riesgo académico o de asistencia.</p></div>'
      : `<div class="empty"><h3>${risk} alumnos requieren seguimiento</h3><p>El cálculo respeta escuela, curso y materia seleccionados.</p></div>`;
  }
}

function initTeacherContext() {
  const root = document.querySelector('[data-teacher-context]');
  if (!root) return;
  if (root.dataset.bound === 'true') {
    renderTeacherContextList(root.querySelector('[data-context-list]'));
    return;
  }
  root.dataset.bound = 'true';

  const form = root.querySelector('[data-context-form]');
  const list = root.querySelector('[data-context-list]');
  const schoolSelect = form.escuela;
  const courseSelect = form.cursoId;
  const subjectSelect = form.materiaId;
  const schools = [...new Set(read(KEYS.courses).map((course) => course.escuela).filter(Boolean))];

  fillSelect(schoolSelect, schools.map((school) => ({ id: school, nombre: school })), 'Escuela');
  fillSelect(courseSelect, read(KEYS.courses), 'Curso', 'id', courseLabel);
  fillSelect(subjectSelect, activeSubjects(), 'Materia');

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
}

function renderTeacherContextList(list) {
  const items = read(KEYS.teacherContext);
  if (!items.length) {
    list.innerHTML = '<div class="empty"><h3>Sin horario cargado</h3><p>Agregá tus clases habituales para activar sugerencias automáticas.</p></div>';
    return;
  }

  list.innerHTML = items.map((item) => {
    const course = courseById(item.cursoId);
    const subject = subjectById(item.materiaId);
    return `
      <article class="course-row">
        <div>
          <strong>${esc(subject?.nombre || 'Materia')}</strong>
          <small>${esc(item.dias.map(weekdayLabel).join(', '))} - ${esc(item.desde)} a ${esc(item.hasta)} - ${esc(course?.nombre || 'Curso')} - ${esc(item.escuela || course?.escuela || '')}</small>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost" data-delete-context="${esc(item.id)}">Quitar</button>
        </div>
      </article>
    `;
  }).join('');
}

function initStudents() {
  const form = document.querySelector('[data-student-form]');
  const list = document.querySelector('[data-student-list]');
  const courseSelect = document.querySelector('[name="cursoId"]');
  const subjectContainer = document.querySelector('[data-student-subjects]');
  if (!form || !list) return;
  if (form.dataset.bound === 'true') {
    renderStudents(list, form);
    return;
  }
  form.dataset.bound = 'true';

  fillSelect(courseSelect, read(KEYS.courses), 'Seleccionar curso', 'id', (course) => `${course.escuela} - ${course.nombre} - ${course.turno}`);
  renderStudentSubjectPicker(subjectContainer);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const editingId = form.dataset.editingId;
    const students = read(KEYS.students);
    const selectedSubjects = Array.from(form.querySelectorAll('[name="subjectIds"]')).map((input) => input.value);
    const newSubjectName = String(data.nuevaMateria || '').trim();
    if (newSubjectName) {
      const existing = activeSubjects().find((subject) => subject.nombre.toLowerCase() === newSubjectName.toLowerCase());
      const subjectPayload = existing || { id: uid('mat'), nombre: newSubjectName, activo: true, updatedAt: nowIso() };
      if (!existing) {
        write(KEYS.subjects, [...read(KEYS.subjects), subjectPayload]);
        await queue('subject', 'upsert', subjectPayload);
      }
      selectedSubjects.push(subjectPayload.id);
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
    await queue('student', 'upsert', payload);
    form.reset();
    delete form.dataset.editingId;
    form.querySelector('button[type="submit"]').textContent = 'Guardar alumno';
    renderStudentSubjectPicker(subjectContainer);
    renderStudents(list, form);
  });

  list.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-student]');
    const remove = event.target.closest('[data-delete-student]');
    const students = read(KEYS.students);

    if (edit) {
      const student = students.find((item) => item.id === edit.dataset.editStudent);
      if (!student) return;
      form.dataset.editingId = student.id;
      form.nombre.value = student.nombre;
      form.dni.value = student.dni || '';
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
      await queue('student', 'delete', { id, updatedAt: nowIso() });
      renderStudents(list, form);
    }
  });

  renderStudents(list, form);
}

function renderStudentSubjectPicker(container, selectedIds = []) {
  if (!container) return;

  const subjects = activeSubjects();
  const selected = new Set(selectedIds);
  const availableSubjects = subjects.filter((subject) => !selected.has(subject.id));

  container.innerHTML = `
    <label class="subject-search-label">
      <span>Buscar materia</span>
      <input type="search" data-subject-filter placeholder="Ej: Matemática, Programación" autocomplete="off" />
    </label>
    <div class="selected-subjects" data-selected-subjects>
      ${subjects.filter((subject) => selected.has(subject.id)).map((subject) => `
        <span class="subject-chip" data-subject-id="${esc(subject.id)}">
          ${esc(subject.nombre)}
          <button type="button" aria-label="Eliminar ${esc(subject.nombre)}" data-remove-subject>×</button>
          <input type="hidden" name="subjectIds" value="${esc(subject.id)}" />
        </span>
      `).join('')}
    </div>
    <div class="subject-suggestions" data-subject-suggestions>
      ${availableSubjects.length ? availableSubjects.map((subject) => `
        <button type="button" class="subject-suggestion" data-add-subject="${esc(subject.id)}">${esc(subject.nombre)}</button>
      `).join('') : '<p class="muted">No hay materias disponibles para seleccionar.</p>'}
    </div>
  `;

  const filterInput = container.querySelector('[data-subject-filter]');
  const suggestions = container.querySelector('[data-subject-suggestions]');

  const updateSuggestions = (query = '') => {
    const value = String(query).trim().toLowerCase();
    const filtered = availableSubjects.filter((subject) => subject.nombre.toLowerCase().includes(value));
    suggestions.innerHTML = filtered.length ? filtered.map((subject) => `
      <button type="button" class="subject-suggestion" data-add-subject="${esc(subject.id)}">${esc(subject.nombre)}</button>
    `).join('') : '<p class="muted">No se encontraron materias con ese nombre.</p>';
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
    list.innerHTML = '<div class="empty"><h3>No hay alumnos registrados</h3><p>Usa el formulario para crear el primer legajo.</p></div>';
    return;
  }
  list.innerHTML = students.map((student) => {
    const course = courseById(student.cursoId);
    const avg = average(gradesForStudent(student.id));
    const subjects = subjectsForStudent(student).map((subject) => subject.nombre).join(', ') || 'Sin materias';
    return `
      <article class="student-row">
        <div>
          <strong>${esc(student.nombre)}</strong>
          <small>${esc(course?.nombre || 'Sin curso')} - ${esc(course?.turno || '')} - ${esc(subjects)}</small>
          <small>${student.tutor ? `Contacto: ${esc(student.tutor)}` : 'Sin contacto cargado'}</small>
          <small>DNI ${esc(student.dni || '-')} · ${esc(course?.nombre || 'Sin curso')} · ${esc(course?.turno || '')}</small>
        </div>
        <div class="row-actions">
          <span class="tag ${avg !== null && avg < 6 ? 'danger' : 'ok'}">Promedio ${avg === null ? '-' : avg.toFixed(1)}</span>
          <button class="btn btn-ghost" data-edit-student="${esc(student.id)}">Editar</button>
          <button class="btn btn-danger" data-delete-student="${esc(student.id)}">Eliminar</button>
        </div>
      </article>
    `;
  }).join('');
}

function initAttendance() {
  const root = document.querySelector('[data-attendance]');
  if (!root) return;

  if (root.__attendanceAbort) root.__attendanceAbort.abort();
  const abort = new AbortController();
  root.__attendanceAbort = abort;
  const { signal } = abort;

  const courseSelect = root.querySelector('[data-filter-course]');
  const subjectSelect = root.querySelector('[data-filter-subject]');
  const dateInput = root.querySelector('[data-attendance-date]');
  const list = root.querySelector('[data-attendance-list]');
  const syncStatus = root.querySelector('[data-sync-status]');
  const connectionStatus = root.querySelector('[data-connection-status]');
  const syncButton = root.querySelector('[data-sync-button]');
  const exportButton = root.querySelector('[data-export-excel]');
  dateInput.value = today();
  fillSelect(courseSelect, read(KEYS.courses), 'Todos los cursos', 'id', (course) => `${course.nombre} - ${course.turno}`);
  fillSelect(subjectSelect, activeSubjects(), 'Materia');
  applySelectFromUrl(courseSelect, 'curso');
  applySelectFromUrl(subjectSelect, 'materia');
  applySuggestedContextTo({ course: courseSelect, subject: subjectSelect });
  if (!subjectSelect.value && activeSubjects()[0]) subjectSelect.value = activeSubjects()[0].id;

  [courseSelect, subjectSelect, dateInput].forEach((control) => control.addEventListener('change', renderAttendance, { signal }));
  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-attendance-state]');
    if (!button) return;
    await saveAttendance(button.dataset.studentId, button.dataset.attendanceState, dateInput.value, subjectSelect.value);
    renderAttendance();
  }, { signal });

  window.addEventListener('aula-clara:sync-finished', (event) => {
    if (syncStatus) syncStatus.textContent = formatSyncStatus(event.detail?.counts);
  }, { signal });
  const updateConnectionStatus = () => {
    if (!connectionStatus) return;
    connectionStatus.textContent = navigator.onLine ? 'Online' : 'Offline';
    connectionStatus.className = `tag ${navigator.onLine ? 'ok' : 'warning'}`;
  };
  window.addEventListener('online', updateConnectionStatus, { signal });
  window.addEventListener('offline', updateConnectionStatus, { signal });
  updateConnectionStatus();
  syncButton?.addEventListener('click', async () => {
    syncButton.disabled = true;
    syncButton.textContent = 'Sincronizando...';
    const result = await syncPendingOperations();
    syncButton.disabled = false;
    syncButton.textContent = 'Sincronizar';
    if (syncStatus) syncStatus.textContent = formatSyncStatus(result.counts);
  }, { signal });
  exportButton?.addEventListener('click', async () => {
    exportButton.disabled = true;
    exportButton.textContent = 'Preparando...';
    await syncPendingOperations();
    const params = new URLSearchParams();
    if (courseSelect.value) params.set('curso', courseSelect.value);
    if (subjectSelect.value) params.set('materia', subjectSelect.value);
    if (dateInput.value) {
      params.set('desde', dateInput.value);
      params.set('hasta', dateInput.value);
    }
    window.location.href = `/api/export?${params.toString()}`;
    window.setTimeout(() => {
      exportButton.disabled = false;
      exportButton.textContent = 'Exportar Excel';
    }, 800);
  }, { signal });
  Promise.all([countPendingOperations(), getOperationStatusCounts()]).then(([, counts]) => {
    if (syncStatus) syncStatus.textContent = formatSyncStatus(counts);
  });

  function renderAttendance() {
    const students = activeStudents().filter((student) =>
      (!courseSelect.value || student.cursoId === courseSelect.value) &&
      studentHasSubject(student, subjectSelect.value)
    )
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const subjectId = subjectSelect.value;
    const date = dateInput.value;
    const records = read(KEYS.attendance);
    const present = students.filter((student) => records.some((item) => item.studentId === student.id && item.fecha === date && item.subjectId === subjectId && item.estado === 'presente')).length;
    const absent = students.filter((student) => records.some((item) => item.studentId === student.id && item.fecha === date && item.subjectId === subjectId && item.estado === 'ausente')).length;

    root.querySelector('[data-attendance-summary]').innerHTML = `
      <div class="metric"><strong>${students.length}</strong><span>Alumnos</span></div>
      <div class="metric"><strong>${present}</strong><span>Presentes</span></div>
      <div class="metric"><strong>${absent}</strong><span>Ausentes</span></div>
    `;

    list.innerHTML = students.length ? students.map((student) => {
      const current = records.find((item) => item.studentId === student.id && item.fecha === date && item.subjectId === subjectId)?.estado || '';
      const course = courseById(student.cursoId);
      return `
        <article class="student-row">
          <div>
            <strong>${esc(student.nombre)}</strong>
            <small>${esc(course?.nombre || '')} · ${esc(subjectById(subjectId)?.nombre || 'Materia')}</small>
          </div>
          <div class="attendance-options">
            <button data-student-id="${esc(student.id)}" data-attendance-state="presente" class="${current === 'presente' ? 'active-present' : ''}">Presente</button>
            <button data-student-id="${esc(student.id)}" data-attendance-state="ausente" class="${current === 'ausente' ? 'active-absent' : ''}">Ausente</button>
          </div>
        </article>
      `;
    }).join('') : '<div class="empty"><h3>No hay alumnos para estos filtros</h3><p>Registra alumnos o cambia el curso seleccionado.</p></div>';
  }

  renderAttendance();
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

function initGrades() {
  const root = document.querySelector('[data-grades]');
  if (!root) return;

  if (root.__gradesAbort) root.__gradesAbort.abort();
  const abort = new AbortController();
  root.__gradesAbort = abort;
  const { signal } = abort;

  const form = root.querySelector('[data-grade-form]');
  const studentSelect = root.querySelector('[name="studentId"]');
  const subjectSelect = root.querySelector('[name="subjectId"]');
  const typeSelect = root.querySelector('[data-evaluation-type]');
  const importanceSelect = root.querySelector('[data-grade-importance]');
  const modeSelect = root.querySelector('[data-grade-mode]');
  const numericField = root.querySelector('[data-numeric-grade-field]');
  const textField = root.querySelector('[data-text-grade-field]');
  const textGradeSelect = root.querySelector('[name="calificacionTexto"]');
  const courseFilter = root.querySelector('[data-grade-course-filter]');
  const subjectFilter = root.querySelector('[data-grade-subject-filter]');
  const table = root.querySelector('[data-grade-table]');
  const deliveries = root.querySelector('[data-grade-deliveries]');
  const contextText = root.querySelector('[data-grade-context-text]');
  const inlineSubjectForm = root.querySelector('[data-inline-subject-form]');
  const inlineSubjectList = root.querySelector('[data-inline-subject-list]');

  const refreshStudentOptions = () => {
    const students = activeStudents().filter((student) =>
      (!courseFilter?.value || student.cursoId === courseFilter.value) &&
      studentHasSubject(student, subjectFilter?.value || '')
    );
    fillSelect(studentSelect, students, 'Alumno');
  };

  const updateMode = () => {
    const mode = modeSelect.value;
    const conceptual = mode !== 'numerica';
    numericField?.classList.toggle('is-hidden', conceptual);
    textField?.classList.toggle('is-hidden', !conceptual);
    form.valor.required = !conceptual;
    textGradeSelect.required = conceptual;
    textGradeSelect.innerHTML = mode === 'trayectoria'
      ? ['TEP', 'TED', 'TEA'].map((item) => `<option value="${item}">${item}</option>`).join('')
      : ['Bien', 'Regular', 'Mal'].map((item) => `<option value="${item}">${item}</option>`).join('');
  };

  const refreshSubjectOptions = () => {
    fillSelect(subjectFilter, activeSubjects(), 'Elegir materia');
    if (!subjectFilter.value && activeSubjects()[0]) subjectFilter.value = activeSubjects()[0].id;
    if (subjectSelect) subjectSelect.value = subjectFilter.value;
    renderInlineSubjects(inlineSubjectList);
  };

  fillSelect(courseFilter, read(KEYS.courses), 'Todos los cursos', 'id', courseLabel);
  applySelectFromUrl(courseFilter, 'curso');
  refreshSubjectOptions();
  applySelectFromUrl(subjectFilter, 'materia');
  applySuggestedContextTo({ course: courseFilter, subject: subjectFilter });
  if (subjectSelect) subjectSelect.value = subjectFilter?.value || '';
  refreshStudentOptions();
  root.querySelector('[name="fecha"]').value = today();
  importanceSelect.value = String(importanceByType(typeSelect.value));
  updateMode();

  const renderAll = () => {
    if (subjectSelect) subjectSelect.value = subjectFilter?.value || '';
    refreshStudentOptions();
    renderGrades(table, subjectFilter?.value || '', courseFilter?.value || '');
    renderGradeDeliveries(deliveries, subjectFilter?.value || '', courseFilter?.value || '');
    if (contextText) {
      const course = courseById(courseFilter?.value);
      const subject = subjectById(subjectFilter?.value);
      contextText.textContent = [course?.nombre, subject?.nombre].filter(Boolean).join(' - ') || 'Elegir curso y materia.';
    }
  };

  subjectFilter?.addEventListener('change', () => {
    if (subjectFilter.value) subjectSelect.value = subjectFilter.value;
    renderAll();
  }, { signal });
  courseFilter?.addEventListener('change', () => {
    renderAll();
  }, { signal });
  typeSelect?.addEventListener('change', () => {
    importanceSelect.value = String(importanceByType(typeSelect.value));
    if (!form.titulo.value.trim()) form.titulo.value = typeSelect.value;
  }, { signal });
  modeSelect?.addEventListener('change', updateMode, { signal });

  inlineSubjectForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(inlineSubjectForm));
    const nombre = String(data.nombre || '').trim();
    if (!nombre) return;
    const payload = { id: uid('mat'), nombre, activo: true, updatedAt: nowIso() };
    write(KEYS.subjects, [...read(KEYS.subjects), payload]);
    await queue('subject', 'upsert', payload);
    inlineSubjectForm.reset();
    refreshSubjectOptions();
    renderAll();
  }, { signal });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const editingId = form.dataset.editingId;
    const isNumeric = data.modoCalificacion === 'numerica';
    const payload = {
      id: editingId || uid('nota'),
      studentId: data.studentId,
      subjectId: data.subjectId || subjectFilter?.value || subjectSelect?.value,
      titulo: data.titulo.trim(),
      tipoEvaluacion: data.tipoEvaluacion || 'TP',
      valor: isNumeric ? Number(data.valor) : null,
      calificacionTexto: isNumeric ? '' : String(data.calificacionTexto || ''),
      peso: Number(data.peso || 100),
      fecha: data.fecha || today(),
      fechaEntrega: data.fechaEntrega || '',
      updatedAt: nowIso(),
    };
    if (!payload.subjectId) {
      alert('Elegí una materia.');
      return;
    }
    if (payload.valor !== null && (Number.isNaN(payload.valor) || payload.valor < 1 || payload.valor > 10)) {
      alert('La nota numérica debe estar entre 1 y 10.');
      return;
    }
    const grades = read(KEYS.grades);
    write(KEYS.grades, editingId ? grades.map((grade) => grade.id === editingId ? payload : grade) : [...grades, payload]);
    await queue('grade', 'upsert', payload);
    form.reset();
    delete form.dataset.editingId;
    root.querySelector('[name="fecha"]').value = today();
    importanceSelect.value = String(importanceByType(typeSelect.value));
    subjectSelect.value = subjectFilter?.value || subjectSelect.value;
    updateMode();
    form.querySelector('button[type="submit"]').textContent = 'Guardar calificación';
    renderAll();
  }, { signal });

  table.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-grade]');
    const remove = event.target.closest('[data-delete-grade]');
    const grades = read(KEYS.grades);
    if (edit) {
      const grade = grades.find((item) => item.id === edit.dataset.editGrade);
      if (!grade) return;
      form.dataset.editingId = grade.id;
      form.studentId.value = grade.studentId;
      form.subjectId.value = grade.subjectId;
      form.titulo.value = grade.titulo;
      form.tipoEvaluacion.value = grade.tipoEvaluacion || 'TP';
      form.modoCalificacion.value = ['TEP', 'TED', 'TEA'].includes(grade.calificacionTexto) ? 'trayectoria' : grade.calificacionTexto ? 'conceptual' : 'numerica';
      updateMode();
      form.valor.value = grade.valor ?? '';
      form.calificacionTexto.value = grade.calificacionTexto || textGradeSelect.value;
      form.peso.value = grade.peso;
      form.fecha.value = grade.fecha;
      form.fechaEntrega.value = grade.fechaEntrega || '';
      form.querySelector('button[type="submit"]').textContent = 'Actualizar calificación';
    }
    if (remove) {
      const id = remove.dataset.deleteGrade;
      if (!confirm('¿Eliminar esta calificación? El promedio se recalculará automáticamente.')) return;
      write(KEYS.grades, grades.filter((grade) => grade.id !== id));
      await queue('grade', 'delete', { id, updatedAt: nowIso() });
      renderAll();
    }
  }, { signal });

  renderAll();
}

function renderGrades(table, subjectId = '', courseId = '') {
  const students = activeStudents().filter((student) =>
    (!courseId || student.cursoId === courseId) &&
    studentHasSubject(student, subjectId)
  );
  table.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Alumno</th><th>Promedio</th><th>Asistencia</th><th>Calificaciones</th><th>Estado</th></tr></thead>
        <tbody>
          ${students.map((student) => {
            const avg = average(gradesForStudent(student.id, subjectId));
            const rate = attendanceRate(student.id, subjectId);
            const grades = gradesForStudent(student.id, subjectId);
            const status = avg !== null && avg < 6 ? 'danger' : rate !== null && rate < 75 ? 'warning' : 'ok';
            return `
              <tr>
                <td><strong>${esc(student.nombre)}</strong><small>${esc(courseById(student.cursoId)?.nombre || 'Sin curso')}</small></td>
                <td>${avg === null ? '-' : avg.toFixed(1)}</td>
                <td>${rate === null ? '-' : rate.toFixed(0) + '%'}</td>
                <td><div class="notes-list">${grades.map((grade) => `
                  <span class="tag">
                    ${esc(grade.tipoEvaluacion || 'Eval.')} - ${esc(grade.titulo)}: ${esc(gradeLabel(grade))}
                    <small>${esc(importanceLabel(grade.peso))}</small>
                    <button data-edit-grade="${esc(grade.id)}" title="Editar">Editar</button>
                    <button data-delete-grade="${esc(grade.id)}" title="Eliminar">Eliminar</button>
                  </span>
                `).join('') || '<span class="tag">Sin notas</span>'}</div></td>
                <td><span class="tag ${status}">${status === 'danger' ? 'Riesgo' : status === 'warning' ? 'Atencion' : 'Correcto'}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderInlineSubjects(list) {
  if (!list) return;
  const subjects = activeSubjects();
  list.innerHTML = subjects.length
    ? subjects.map((subject) => `<span class="tag">${esc(subject.nombre)}</span>`).join('')
    : '<span class="tag">Sin materias</span>';
}

function renderGradeDeliveries(list, subjectId = '', courseId = '') {
  if (!list) return;
  const students = activeStudents().filter((student) => !courseId || student.cursoId === courseId);
  const studentIds = new Set(students.map((student) => student.id));
  const deliveries = read(KEYS.grades)
    .filter((grade) => grade.fechaEntrega && studentIds.has(grade.studentId) && (!subjectId || grade.subjectId === subjectId))
    .reduce((acc, grade) => {
      const key = `${grade.subjectId}|${grade.titulo}|${grade.fechaEntrega}`;
      if (!acc.has(key)) acc.set(key, { ...grade, count: 0 });
      acc.get(key).count += 1;
      return acc;
    }, new Map());
  const items = [...deliveries.values()].sort((a, b) => String(a.fechaEntrega).localeCompare(String(b.fechaEntrega)));

  list.innerHTML = items.length ? items.map((item) => {
    const subject = subjectById(item.subjectId);
    const pending = new Date(`${item.fechaEntrega}T23:59:59`).getTime() >= Date.now();
    return `
      <article class="event-card">
        <span class="tag ${pending ? 'warning' : ''}">${pending ? 'Proxima' : 'Pasada'}</span>
        <strong>${esc(item.titulo)}</strong>
        <small>${esc(subject?.nombre || 'Materia')} - ${esc(item.fechaEntrega)} - ${item.count} alumnos</small>
      </article>
    `;
  }).join('') : '<div class="empty"><h3>Sin entregas pendientes</h3><p>Cuando cargues una fecha de entrega, aparecera aca.</p></div>';
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
    await queue('subject', 'upsert', payload);
    form.reset();
    delete form.dataset.editingId;
    form.querySelector('button[type="submit"]').textContent = 'Crear materia';
    renderSubjects(list, form);
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
      await queue('subject', 'delete', { id, updatedAt: nowIso() });
      renderSubjects(list, form);
    }
  });

  renderSubjects(list, form);
}

function renderSubjects(list) {
  const subjects = activeSubjects();
  const grades = read(KEYS.grades);
  list.innerHTML = subjects.map((subject) => {
    const count = grades.filter((grade) => grade.subjectId === subject.id).length;
    return `
      <article class="course-row">
        <div><strong>${esc(subject.nombre)}</strong><small>${count} notas vinculadas</small></div>
        <div class="row-actions">
          <span class="tag">Activa</span>
          <button class="btn btn-ghost" data-edit-subject="${esc(subject.id)}">Editar</button>
          <button class="btn btn-danger" data-delete-subject="${esc(subject.id)}">Eliminar</button>
        </div>
      </article>
    `;
  }).join('');
}

function initCourses() {
  const root = document.querySelector('[data-courses]');
  if (!root) return;
  const list = root.querySelector('[data-course-list]');
  const form = root.querySelector('[data-course-form]');
  if (form?.dataset.bound === 'true') {
    renderCourses(list);
    return;
  }
  if (form) form.dataset.bound = 'true';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const courses = read(KEYS.courses);
    const payload = {
      id: uid('curso'),
      nombre: data.nombre.trim(),
      escuela: data.escuela.trim(),
      turno: data.turno,
      cicloLectivo: new Date().getFullYear(),
      updatedAt: nowIso(),
    };
    courses.push(payload);
    write(KEYS.courses, courses);
    await queue('course', 'upsert', payload);
    form.reset();
    renderCourses(list);
  });
  renderCourses(list);
}

function renderCourses(list) {
  const courses = read(KEYS.courses);
  const students = activeStudents();
  const subjects = activeSubjects();
  list.innerHTML = courses.map((course) => {
    const courseStudents = students.filter((student) => student.cursoId === course.id);
    const defaultSubjectId = subjects[0]?.id || '';
    const actionContext = { curso: course.id, materia: defaultSubjectId };
    return `
      <details class="course-accordion">
        <summary>
          <span><strong>${esc(course.nombre)}</strong><small>${esc(course.escuela)} · Turno ${esc(course.turno)}</small></span>
          <span class="tag">${courseStudents.length} alumnos</span>
        </summary>
        <div class="course-detail">
          <div>
            <h3>Alumnos</h3>
            <div class="notes-list">${courseStudents.map((student) => `<span class="tag">${esc(student.nombre)}</span>`).join('') || '<span class="tag">Sin alumnos</span>'}</div>
          </div>
          <div>
            <h3>Materias</h3>
            <div class="notes-list">${subjects.map((subject) => `<span class="tag">${esc(subject.nombre)}</span>`).join('')}</div>
          </div>
          <div class="button-row">
            <a class="btn btn-primary" href="${esc(contextUrl('/asistencia', actionContext))}">Tomar asistencia</a>
            <a class="btn btn-secondary" href="${esc(contextUrl('/notas', actionContext))}">Calificaciones</a>
          </div>
        </div>
      </details>
    `;
  }).join('');
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
  if (root.dataset.bound === 'true') {
    const monthInput = root.querySelector('[data-calendar-month]');
    const courseSelect = root.querySelector('[data-calendar-course]');
    const subjectSelect = root.querySelector('[data-calendar-subject]');
    loadCalendar(root, monthInput?.value || today().slice(0, 7), courseSelect?.value || '', subjectSelect?.value || '', false);
    return;
  }
  root.dataset.bound = 'true';

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
    await loadCalendar(root, monthInput.value, courseSelect.value, subjectSelect.value, true);
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

  load(false);
}

async function loadCalendar(root, monthValue, courseId = '', subjectId = '', force = false) {
  const [year, month] = monthValue.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const scheduleEvents = buildTeacherScheduleEvents(start, end, courseId, subjectId);
  const cacheParts = {
    month: monthValue,
    courseId: courseId || 'all',
    subjectId: subjectId || 'all',
  };

  if (!force) {
    const cachedEvents = await readLocalOrIndexed({
      localItems: [],
      cacheScope: 'calendar',
      cacheParts,
    });

    if (Array.isArray(cachedEvents) && cachedEvents.length) {
      renderCalendar(root, start, [...cachedEvents, ...scheduleEvents]);
      return;
    }

    renderCalendar(root, start, scheduleEvents);

    if (!navigator.onLine) return;

    const idbEmpty = await isIndexedDbEmpty();
    if (!idbEmpty) return;

    await fetchCalendarFromServer(root, monthValue, courseId, subjectId, start, scheduleEvents);
    return;
  }

  await fetchCalendarFromServer(root, monthValue, courseId, subjectId, start, scheduleEvents);
}

async function fetchCalendarFromServer(root, monthValue, courseId, subjectId, start, scheduleEvents) {
  const [year, month] = monthValue.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const params = new URLSearchParams({
    desde: monthStart.toISOString().slice(0, 10),
    hasta: monthEnd.toISOString().slice(0, 10),
  });
  if (courseId) params.set('curso', courseId);
  if (subjectId) params.set('materia', subjectId);

  const response = await fetch(`/api/calendar?${params.toString()}`);
  if (!response.ok) return;
  const data = await response.json();
  const events = Array.isArray(data.events) ? data.events : [];

  await writeIndexedCache('calendar', {
    month: monthValue,
    courseId: courseId || 'all',
    subjectId: subjectId || 'all',
  }, events);

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

  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    const dayItems = eventsByDate[key] || [];
    const outside = date.getMonth() !== monthStart.getMonth();
    const tone = getCalendarDayTone(dayItems);
    return `
      <button class="calendar-day ${outside ? 'is-outside' : ''} ${tone ? `is-${tone}` : ''}" type="button" data-calendar-day="${esc(key)}">
        <strong>${date.getDate()}</strong>
        <span>${dayItems.length ? `${dayItems.length} eventos` : ''}</span>
        <div class="calendar-day-items">${dayItems.slice(0, 2).map((event) => {
          const meta = getCalendarEventMeta(event.tipo);
          return `<small class="calendar-event-chip calendar-event-chip--${meta.tone}"><span class="calendar-event-emoji">${meta.icon}</span><span>${esc(meta.label)}</span></small>`;
        }).join('')}</div>
      </button>
    `;
  });

  grid.innerHTML = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
    .map((day) => `<div class="calendar-weekday">${day}</div>`)
    .join('') + days.join('');

  const showDay = (key) => {
    const selected = eventsByDate[key] || [];
    const dayTone = getCalendarDayTone(selected);
    title.textContent = new Date(`${key}T00:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    summary.textContent = selected.length ? `${selected.length} eventos programados o registrados.` : 'Sin eventos para este dia.';
    summary.className = dayTone ? `calendar-summary is-${dayTone}` : 'calendar-summary';
    dayEvents.innerHTML = selected.length ? selected.map((event) => {
      const meta = getCalendarEventMeta(event.tipo);
      return `
        <article class="event-card event-card--${meta.tone}">
          <span class="tag ${meta.tone === 'danger' ? 'danger' : meta.tone === 'warning' ? 'warning' : meta.tone === 'info' ? 'info' : ''}">
            <span class="calendar-event-emoji">${meta.icon}</span>
            ${esc(meta.label)}
          </span>
          <strong>${meta.icon} ${esc(event.titulo)}</strong>
          <small>${esc([event.colegio, event.curso, event.materia].filter(Boolean).join(' - '))}</small>
          <p>${esc(event.descripcion || '')}</p>
        </article>
      `;
    }).join('') : '<div class="empty"><h3>Sin eventos</h3><p>No hay registros para este dia.</p></div>';
  };

  grid.querySelectorAll('[data-calendar-day]').forEach((button) => {
    button.addEventListener('click', () => showDay(button.dataset.calendarDay));
  });

  const monthKey = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
  const initialKey = today().startsWith(monthKey) ? today() : `${monthKey}-01`;
  showDay(initialKey);
}

function initActivities() {
  const root = document.querySelector('[data-activities]');
  if (!root) return;

  const form = root.querySelector('[data-activity-form]');
  const editor = root.querySelector('[data-activity-editor]');
  const list = root.querySelector('[data-activity-list]');
  if (form?.dataset.bound === 'true') {
    renderActivitiesList(list);
    return;
  }
  if (form) form.dataset.bound = 'true';

  const btnDescargarWord = root.querySelector('#btn-descargar-word');
  const btnDescargarPdf = root.querySelector('#btn-descargar-pdf');
  const schoolSelect = form.colegio;
  const shiftSelect = form.turno;
  const courseSelect = form.cursoId;
  const subjectSelect = form.materiaId;

  function obtenerDatosDocumento() {
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
      if (!form.titulo.value) return alert('Por favor, ingresá un Título para la actividad antes de descargar.');
      const { html, titulo } = obtenerDatosDocumento();
      const wordContent = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>${titulo}</title></head>
        <body>${html}</body>
        </html>
      `;
      const blob = new Blob(['\ufeff', wordContent], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${String(form.titulo.value || 'Actividad').replace(/[^\w\s.-áéíóúñÁÉÍÓÚÑ]/gi, '').replace(/\s+/g, '_') || 'Actividad'}.doc`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }

  if (btnDescargarPdf) {
    btnDescargarPdf.addEventListener('click', () => {
      if (!form.titulo.value) return alert('Por favor, ingresá un Título para la actividad antes de exportar.');
      const { html, titulo } = obtenerDatosDocumento();
      const ventanaImpresion = window.open('', '_blank');
      if (!ventanaImpresion) {
        return alert('No se pudo abrir la ventana de impresión. Permití ventanas emergentes para esta página.');
      }
      ventanaImpresion.document.write(`
        <html>
          <head>
            <title>${titulo}</title>
            <style>
              body { margin: 0; }
              @media print {
                @page { margin: 2cm; }
                body { padding: 0; }
              }
            </style>
          </head>
          <body>
            ${html}
            <script>
              window.onload = () => {
                window.print();
                setTimeout(() => window.close(), 500);
              };
            </script>
          </body>
        </html>
      `);
      ventanaImpresion.document.close();
    });
  }

  const schools = [...new Set(read(KEYS.courses).map((course) => course.escuela).filter(Boolean))];
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
  courseSelect.addEventListener('change', syncCourseFields);
  syncCourseFields();
  root.querySelector('[name="fechaPublicacion"]').value = today();

  const renderEditor = () => {
    const tipo = new FormData(form).get('tipo') || 'evaluacion';
    editor.innerHTML = tipo === 'evaluacion' ? `
      <div class="section-title">
        <h2>Aviso de evaluación</h2>
        <p>Deja claro tema, modalidad y materiales necesarios.</p>
      </div>
      <label>
        <span>Descripción</span>
        <textarea rows="7" data-activity-questions placeholder="Tema, modalidad, material para traer o aclaraciones"></textarea>
      </label>
    ` : `
      <div class="section-title">
        <h2>Publicación del TP</h2>
        <p>Define consigna, criterios de seguimiento y fecha de entrega.</p>
      </div>
      <label>
        <span>Consigna</span>
        <textarea rows="7" data-activity-brief placeholder="Describe la actividad"></textarea>
      </label>
      <label>
        <span>Criterios de seguimiento</span>
        <input data-activity-criteria placeholder="Entrega, desarrollo, presentación" />
      </label>
    `;
  };

  form.querySelectorAll('[name="tipo"]').forEach((input) => input.addEventListener('change', renderEditor));
  renderEditor();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
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

    const response = await fetch('/api/actividades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo,
        colegio: data.colegio,
        turno: data.turno,
        cursoId: data.cursoId,
        materiaId: data.materiaId,
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
    await renderActivitiesList(list, { force: true });
  });

  renderActivitiesList(list);
}



async function renderActivitiesList(list, { force = false } = {}) {
  if (!list) return;

  if (!force) {
    const local = read(KEYS.activities);
    if (local.length) {
      paintActivitiesList(list, local);
      return;
    }

    const cached = await readLocalOrIndexed({
      localItems: [],
      cacheScope: 'activities',
      cacheParts: { scope: 'list' },
    });
    if (Array.isArray(cached) && cached.length) {
      write(KEYS.activities, cached);
      paintActivitiesList(list, cached);
      return;
    }

    paintActivitiesList(list, []);
    if (!navigator.onLine) return;

    const idbEmpty = await isIndexedDbEmpty();
    if (!idbEmpty) return;

    await fetchActivitiesFromServer(list);
    return;
  }

  await fetchActivitiesFromServer(list);
}

async function fetchActivitiesFromServer(list) {
  const response = await fetch('/api/actividades');
  if (!response.ok) {
    paintActivitiesList(list, read(KEYS.activities));
    return;
  }
  const data = await response.json();
  const actividades = Array.isArray(data.actividades) ? data.actividades : [];
  write(KEYS.activities, actividades);
  await writeIndexedCache('activities', { scope: 'list' }, actividades);
  paintActivitiesList(list, actividades);
}

function paintActivitiesList(list, actividades) {
  list.innerHTML = actividades.length ? actividades.map((item) => `
    <article class="event-card">
      <span class="tag">${esc(item.tipo === 'tp' ? 'TP' : 'Evaluación')}</span>
      <strong>${esc(item.titulo)}</strong>
      <small>${esc([item.colegio, item.curso, item.materia].filter(Boolean).join(' - '))}</small>
      <p>${item.fecha_publicacion ? `Publicación: ${esc(item.fecha_publicacion)}` : 'Sin fecha de publicación'}</p>
      <p>${item.fecha_vencimiento ? `Entrega: ${esc(item.fecha_vencimiento)}` : 'Sin fecha de entrega'}</p>
    </article>
  `).join('') : '<div class="empty"><h3>Sin actividades</h3><p>Prepara una evaluación o TP para empezar.</p></div>';
}

function formatSyncStatus(counts = {}) {
  const pending = (counts.pending || 0) + (counts.syncing || 0);
  const synced = counts.synced || 0;
  const error = counts.error || 0;
  return `${pending} pendientes · ${synced} sincronizadas · ${error} con error`;
}

function bootCurrentPage(path = window.location.pathname) {
  if (path === '/' || path.startsWith('/?')) {
    initDashboard();
    initTeacherContext();
    return;
  }
  if (path === '/registro') return initStudents();
  if (path === '/asistencia') return initAttendance();
  if (path === '/notas') return initGrades();
  if (path === '/cursos') return initCourses();
  if (path === '/actividades') {
    initActivities();
    initCalendar();
  }
}

async function pullRemoteData(scope = 'all') {
  await syncPendingOperations();

  if (scope === 'all' || scope === 'calendario') {
    const root = document.querySelector('[data-calendar]');
    if (root) {
      const monthInput = root.querySelector('[data-calendar-month]');
      const courseSelect = root.querySelector('[data-calendar-course]');
      const subjectSelect = root.querySelector('[data-calendar-subject]');
      await loadCalendar(root, monthInput?.value || today().slice(0, 7), courseSelect?.value || '', subjectSelect?.value || '', true);
    }
  }

  if (scope === 'all' || scope === 'actividades') {
    const list = document.querySelector('[data-activity-list]');
    if (list) await renderActivitiesList(list, { force: true });
  }
}

function registerSpaRefreshHandlers() {
  registerSpaViewRefresh('panel', () => {
    initDashboard();
    initTeacherContext();
  });
  registerSpaViewRefresh('registro', initStudents);
  registerSpaViewRefresh('cursos', initCourses);
  registerSpaViewRefresh('asistencia', initAttendance);
  registerSpaViewRefresh('notas', initGrades);
  registerSpaViewRefresh('actividades', () => {
    initActivities();
    initCalendar();
  });
}

const spaRuntime = window.__AULA_CLARA_SPA__ || { enabled: false, initialView: 'panel' };

seed();
initTheme();
initMobileNav();
initResponsiveTables();
startAutoSync();
initDashboard();
initTeacherContext();
initStudents();
initAttendance();
initGrades();
initCourses();
initSubjects();
initCalendar();
initActivities();

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-pull-remote]');
  if (!button) return;
  event.preventDefault();
  void pullRemoteData(button.dataset.pullScope || 'all');
});

if (spaRuntime.enabled) {
  registerSpaRefreshHandlers();
  initSpaRouter(spaRuntime.initialView);
}
