import { countPendingOperations, getOperationStatusCounts, queueOfflineOperation, saveAttendanceOffline } from './offline-db.ts';
import { hydrateLocalStorageFromServer, startAutoSync, syncPendingOperations } from './sync-client.ts';
import { initMobileNav, openMenu, closeMenu } from './ui-nav.js';
import { initSpaRouter, registerSpaViewRefresh } from './spa-router.ts';

const currentUser = window.__AULA_CLARA_USER__ || null;

const KEYS = {
  students: 'aula_clara_students',
  courses: 'aula_clara_courses',
  subjects: 'aula_clara_subjects',
  attendance: 'aula_clara_attendance',
  grades: 'aula_clara_grades',
  dashboardFilters: 'aula_clara_dashboard_filters',
  teacherContext: 'aula_clara_teacher_context',
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
  if (!context) return 'Configur├í tu horario para ver sugerencias autom├íticas.';
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
      ? '<div class="empty"><h3>Sin alertas en este contexto</h3><p>El filtro actual no muestra riesgo acad├®mico o de asistencia.</p></div>'
      : `<div class="empty"><h3>${risk} alumnos requieren seguimiento</h3><p>El c├ílculo respeta escuela, curso y materia seleccionados.</p></div>`;
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
  const schools = [...new Set(read(KEYS.courses).map((course) => course.escuela).filter(Boolean))];

  fillSelect(schoolSelect, schools.map((school) => ({ id: school, nombre: school })), 'Escuela');
  fillSelect(courseSelect, read(KEYS.courses), 'Curso', 'id', courseLabel);
  fillSelect(subjectSelect, activeSubjects(), 'Materia');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const dias = data.getAll('dias').map(String);
    if (!dias.length) {
      alert('Eleg├¡ al menos un d├¡a.');
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
    list.innerHTML = '<div class="empty"><h3>Sin horario cargado</h3><p>Agreg├í tus clases habituales para activar sugerencias autom├íticas.</p></div>';
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
      <input type="search" data-subject-filter placeholder="Ej: Matem├ítica, Programaci├│n" autocomplete="off" />
    </label>
    <div class="selected-subjects" data-selected-subjects>
      ${subjects.filter((subject) => selected.has(subject.id)).map((subject) => `
        <span class="subject-chip" data-subject-id="${esc(subject.id)}">
          ${esc(subject.nombre)}
          <button type="button" aria-label="Eliminar ${esc(subject.nombre)}" data-remove-subject>├ù</button>
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
          <small>DNI ${esc(student.dni || '-')} ┬À ${esc(course?.nombre || 'Sin curso')} ┬À ${esc(course?.turno || '')}</small>
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

  [courseSelect, subjectSelect, dateInput].forEach((control) => control.addEventListener('change', renderAttendance));
  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-attendance-state]');
    if (!button) return;
    await saveAttendance(button.dataset.studentId, button.dataset.attendanceState, dateInput.value, subjectSelect.value);
    renderAttendance();
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
            <small>${esc(course?.nombre || '')} ┬À ${esc(subjectById(subjectId)?.nombre || 'Materia')}</small>
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
  const deliveriesSummary = root.querySelector('[data-grade-deliveries-summary]');
  const deliveryTypeFilter = root.querySelector('[data-delivery-type-filter]');
  const deliveryStatusFilter = root.querySelector('[data-delivery-status-filter]');
  const deliveryFromFilter = root.querySelector('[data-delivery-from-filter]');
  const deliveryToFilter = root.querySelector('[data-delivery-to-filter]');
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

  const deliveryFilters = () => ({
    tipo: deliveryTypeFilter?.value || '',
    estado: deliveryStatusFilter?.value || '',
    desde: deliveryFromFilter?.value || '',
    hasta: deliveryToFilter?.value || '',
  });

  const renderAll = async () => {
    if (subjectSelect) subjectSelect.value = subjectFilter?.value || '';
    refreshStudentOptions();
    renderGrades(table, subjectFilter?.value || '', courseFilter?.value || '');

    await renderUpcomingActivities(
      deliveries,
      deliveriesSummary,
      subjectFilter?.value || '',
      courseFilter?.value || '',
      deliveryFilters(),
    );

    if (contextText) {
      const course = courseById(courseFilter?.value);
      const subject = subjectById(subjectFilter?.value);
      contextText.textContent = [course?.nombre, subject?.nombre].filter(Boolean).join(' - ') || 'Elegir curso y materia.';
    }
  };

  subjectFilter?.addEventListener('change', () => {
    if (subjectFilter.value) subjectSelect.value = subjectFilter.value;
    renderAll();
  });
  courseFilter?.addEventListener('change', () => {
    renderAll();
  });
  typeSelect?.addEventListener('change', () => {
    importanceSelect.value = String(importanceByType(typeSelect.value));
    if (!form.titulo.value.trim()) form.titulo.value = typeSelect.value;
  });
  modeSelect?.addEventListener('change', updateMode);

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
    await queue('subject', 'upsert', payload);
    inlineSubjectForm.reset();
    refreshSubjectOptions();
    renderAll();
  });

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
      alert('Eleg├¡ una materia.');
      return;
    }
    if (payload.valor !== null && (Number.isNaN(payload.valor) || payload.valor < 1 || payload.valor > 10)) {
      alert('La nota num├®rica debe estar entre 1 y 10.');
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
    form.querySelector('button[type="submit"]').textContent = 'Guardar calificaci├│n';
    renderAll();
  });

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
      form.querySelector('button[type="submit"]').textContent = 'Actualizar calificaci├│n';
    }
    if (remove) {
      const id = remove.dataset.deleteGrade;
      if (!confirm('┬┐Eliminar esta calificaci├│n? El promedio se recalcular├í autom├íticamente.')) return;
      write(KEYS.grades, grades.filter((grade) => grade.id !== id));
      await queue('grade', 'delete', { id, updatedAt: nowIso() });
      renderAll();
    }
  });

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

async function renderUpcomingActivities(list, summary, subjectId = '', courseId = '', filters = {}) {
  if (!list) return;

  list.innerHTML = '<div class="empty"><h3>Cargando actividades...</h3></div>';

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
    summary.innerHTML = `
      <article class="metric panel">
        <span>Total filtradas</span>
        <strong>${items.length}</strong>
      </article>
      <article class="metric panel">
        <span>Pr├│ximas</span>
        <strong>${proximas}</strong>
      </article>
      <article class="metric panel">
        <span>En progreso</span>
        <strong>${enProgreso}</strong>
      </article>
    `;
  }

  list.innerHTML = items.length ? items.map((item) => {
    const fecha = item.fecha_vencimiento || item.fecha_publicacion || 'Sin fecha';
    const tipoLabel = item.tipo === 'tp' ? 'TP' : 'Evaluaci├│n';
    const proxima = item.fecha_vencimiento && new Date(`${item.fecha_vencimiento}T23:59:59`).getTime() >= Date.now();
    const cardClass = proxima ? 'event-card--warning' : item.seguimiento === 'completado' ? 'event-card--info' : '';
    return `
      <article class="event-card ${cardClass}">
        <div>
          <span class="tag">${esc(tipoLabel)}</span>
          <span class="tag ${deliveryStatusClass(item.seguimiento)}">${esc(deliveryStatusLabel(item.seguimiento))}</span>
          ${proxima ? '<span class="tag warning">Pr├│xima</span>' : ''}
        </div>
        <strong>${esc(item.titulo)}</strong>
        <small>${esc([item.curso, item.materia].filter(Boolean).join(' ┬À '))}</small>
        <p>Entrega: ${esc(fecha)} ┬À ${item.entregasCount} trabajo(s) cargado(s)</p>
      </article>
    `;
  }).join('') : `
    <div class="empty">
      <h3>Sin actividades para este filtro</h3>
      <p>Cre├í actividades en la secci├│n Actividades o ajust├í curso/materia.</p>
    </div>
  `;

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
  list.innerHTML = '<div class="empty"><h3>Cargando trabajos...</h3></div>';

  let entregas = await fetchTrabajosForContext(courseId, subjectId, estado === 'enviado' ? { estado } : {});
  if (estado === 'calificado') {
    entregas = entregas.filter((item) => trabajoTieneCalificacion(item));
  } else if (estado === 'enviado') {
    entregas = entregas.filter((item) => !trabajoTieneCalificacion(item));
  }

  list.innerHTML = entregas.length ? entregas.map((item) => {
    const archivos = Array.isArray(item.archivos) ? item.archivos : [];
    const archivosHtml = archivos.map((archivo) => `
      <span class="tag">
        ${esc(archivo.filename)} (${formatFileSize(archivo.size_bytes)})
        <a href="/api/trabajos/archivos/${esc(archivo.id)}" target="_blank" rel="noopener">Descargar</a>
        <a href="/api/trabajos/archivos/${esc(archivo.id)}?preview=1" target="_blank" rel="noopener">Vista previa</a>
      </span>
    `).join('');

    return `
      <article class="student-row">
        <div>
          <strong>${esc(item.titulo)}</strong>
          <small>${esc([item.curso, item.materia, item.alumno].filter(Boolean).join(' ┬À '))}</small>
          <small>${esc(item.submitted_at?.slice(0, 10) || '')} ┬À ${esc(trabajoEstadoLabel(item))}</small>
        </div>
        <div class="notes-list">${archivosHtml || '<span class="tag">Sin archivos</span>'}</div>
        <div class="actions-group">
          <button class="btn btn-secondary btn-sm" type="button" data-reenviar-trabajo="${esc(item.id)}">Reenviar</button>
        </div>
      </article>
    `;
  }).join('') : `
    <div class="empty">
      <h3>Sin trabajos cargados</h3>
      <p>Us├í el formulario para subir entregas de alumnos o docentes.</p>
    </div>
  `;

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
  select.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    filtered.map((item) => `<option value="${esc(item.id)}">${esc(item.titulo)} (${activityTipoLabel(item)})</option>`).join('');
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
    fillSelect(trabajoAlumnoSelect, students, 'Sin alumno espec├¡fico');
  };

  const refresh = async () => {
    const cursoId = getCourseId();
    const materiaId = getMateriaId();
    if (!cursoId || !materiaId) {
      fillActividadSelect(trabajoActividadSelect, [], {
        placeholder: 'Eleg├¡ curso y materia arriba',
        required: true,
      });
      if (trabajoHistory) {
        trabajoHistory.innerHTML = '<div class="empty"><h3>Eleg├¡ curso y materia</h3><p>Defin├¡ el contexto arriba para cargar entregas.</p></div>';
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
      placeholder: 'Eleg├¡ una actividad',
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
    fillSelect(reenviarAlumno, students, 'Sin alumno espec├¡fico');
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
      alert('Complet├í colegio, turno, curso y materia antes de cargar un trabajo.');
      return;
    }

    const fileCheck = validateTrabajoFiles(trabajoFilesInput, trabajoFileFeedback, {
      maxFiles: Number(trabajoForm.dataset.maxFiles || 5),
      maxFileMb: Number(trabajoForm.dataset.maxFileMb || 15),
    });
    if (!fileCheck.ok) return;

    const data = Object.fromEntries(new FormData(trabajoForm));
    if (!data.actividadId) {
      alert('Eleg├¡ la actividad del curso a la que corresponde la entrega.');
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
      alert('Complet├í curso, materia y t├¡tulo.');
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
    const msg = `M├íximo ${maxFiles} archivos por carga.`;
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
          <span><strong>${esc(course.nombre)}</strong><small>${esc(course.escuela)} ┬À Turno ${esc(course.turno)}</small></span>
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
    evaluacion: { icon: '­ƒôØ', label: 'Evaluaci├│n', tone: 'neutral' },
    tp: { icon: '­ƒôÿ', label: 'TP', tone: 'neutral' },
    cierre_tp: { icon: '­ƒôñ', label: 'Entrega', tone: 'neutral' },
    asistencia: { icon: '­ƒº¥', label: 'Asistencia', tone: 'neutral' },
    nota: { icon: '­ƒÅÀ´©Å', label: 'Nota', tone: 'neutral' },
    evento: { icon: '­ƒôà', label: 'Evento', tone: 'neutral' },
    ausencia: { icon: 'Ô£û', label: 'Falta docente', tone: 'danger' },
    lluvia: { icon: '­ƒîº´©Å', label: 'D├¡a de lluvia', tone: 'info' },
    salida_educativa: { icon: '­ƒÜî', label: 'Salida educativa', tone: 'warning' },
    acto: { icon: '­ƒÅø´©Å', label: 'Acto escolar', tone: 'warning' },
    jornada: { icon: 'ÔÅ▒´©Å', label: 'Jornada institucional', tone: 'warning' },
  };
  return meta[normalized] || { icon: '­ƒôà', label: 'Evento', tone: 'neutral' };
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
        descripcion: `${context.escuela || course?.escuela || 'Escuela'} ┬À ${course?.nombre || 'Curso'}`,
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
  // Si falla o el script no carga, cae al fallback de impresi├│n.
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
      container.innerHTML = wrappedHtml;
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
      // Fallback: abrir ventana de impresi├│n como antes
      const ventanaImpresion = window.open('', '_blank');
      if (!ventanaImpresion) {
        alert('No se pudo abrir la ventana de impresi├│n. Permit├¡ ventanas emergentes para esta p├ígina.');
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
      aiFileFeedback.innerHTML = '';
      return;
    }

    const issues = [];
    if (files.length > maxFiles) issues.push(`Seleccionaste ${files.length} archivos. El m├íximo es ${maxFiles}.`);
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
    aiFileFeedback.innerHTML = `
      <p><strong>${files.length} archivo${files.length === 1 ? '' : 's'} seleccionado${files.length === 1 ? '' : 's'}</strong> ┬À ${totalMb.toFixed(1)} MB en total</p>
      <p class="muted">La IA usar├í como m├íximo ${formatChars(maxInputChars)} caracteres del material extra├¡do (~10-15 p├íginas). Si hay m├ís texto, se resume o se recorta autom├íticamente.</p>
      ${issues.length ? `<ul>${issues.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
    `;
  };

  const renderAiSourceReport = (meta) => {
    if (!aiSourceReport) return;
    const source = meta?.source;
    if (!source) {
      aiSourceReport.classList.add('is-hidden');
      aiSourceReport.innerHTML = '';
      return;
    }

    const tags = [];
    if (source.summarized) tags.push('Resumido con modelo liviano');
    if (source.extractionTruncated) tags.push('Extracci├│n recortada');
    if (source.inputTruncated) tags.push('Texto final recortado');

    aiSourceReport.classList.remove('is-hidden');
    aiSourceReport.innerHTML = `
      <div class="ai-source-report-head">
        <strong>Material procesado para la IA</strong>
        ${tags.length ? `<div class="tag-row">${tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>` : ''}
      </div>
      <p>
        Extra├¡dos <strong>${formatChars(source.extractedChars)}</strong> caracteres de
        <strong>${source.filesProcessed}</strong> archivo${source.filesProcessed === 1 ? '' : 's'}.
        Se enviaron <strong>${formatChars(source.usedChars)}</strong> a la generaci├│n
        (tope ${formatChars(source.maxInputChars)}).
      </p>
      ${Array.isArray(source.messages) && source.messages.length
        ? `<ul>${source.messages.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
        : '<p class="muted">No fue necesario resumir ni recortar el material.</p>'}
    `;
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
        alert('Adjunt├í al menos un documento PDF, DOCX o TXT.');
        return;
      }
      const maxFiles = Number(aiForm.dataset.maxFiles || 6);
      const maxFileBytes = Number(aiForm.dataset.maxFileBytes || 8 * 1024 * 1024);
      const invalidCount = files.length > maxFiles;
      const invalidSize = Array.from(files).some((file) => file.size > maxFileBytes);
      if (invalidCount || invalidSize) {
        renderAiFileFeedback();
        alert('Revis├í los archivos seleccionados: superan los l├¡mites permitidos.');
        return;
      }
      if (!mainData.get('colegio') || !mainData.get('turno') || !mainData.get('cursoId') || !mainData.get('materiaId')) {
        alert('Complet├í colegio, turno, curso y materia antes de generar con IA.');
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

      setAiLoading(true, 'Sincronizando cursos y generando material con IAÔÇª');
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
        if (aiPreviewBody) aiPreviewBody.innerHTML = data.html || '';
        aiPreview?.classList.remove('is-hidden');
        setAiLoading(false, '');
      } catch (error) {
        setAiLoading(false, '');
        alert(error instanceof Error ? error.message : 'Error al generar la actividad.');
      }
    });
  }

  aiWord?.addEventListener('click', () => {
    if (!lastGenerated?.html) return alert('Gener├í una actividad antes de exportar.');
    downloadActivityWord(lastGenerated.html, lastGenerated.titulo);
  });

  aiPdf?.addEventListener('click', () => {
    if (!lastGenerated?.html) return alert('Gener├í una actividad antes de exportar.');
    downloadActivityPdf(lastGenerated.html, lastGenerated.titulo);
  });

  aiApply?.addEventListener('click', () => {
    if (!lastGenerated) return alert('No hay contenido generado para aplicar.');
    applyGeneratedToForm(lastGenerated);
    alert('Contenido aplicado. Revis├í en ┬½Realizar a mano┬╗ y guard├í la actividad.');
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
    const tituloDoc = data.titulo ? data.titulo.toUpperCase() : 'ACTIVIDAD SIN T├ìTULO';

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
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>${data.tipo === 'tp' ? 'Publicaci├│n del TP' : 'Aviso'}:</strong> ${data.fechaPublicacion || '-'}</td>
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
        <h3 style="color: #2c3e50; margin-top: 30px;">Consigna del Trabajo Pr├íctico:</h3>
        <p style="white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-left: 4px solid #3498db; font-size: 15px; line-height: 1.6;">${consigna || 'Sin consigna detallada.'}</p>
      `;
      if (criterios) {
        html += `
          <h4 style="color: #2c3e50; margin-top: 20px;">Criterios de Evaluaci├│n:</h4>
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
        return alert('Ingres├í un t├¡tulo o gener├í una actividad con IA antes de descargar.');
      }
      downloadActivityWord(html, titulo || form.titulo.value);
    });
  }

  if (btnDescargarPdf) {
    btnDescargarPdf.addEventListener('click', () => {
      const { html, titulo } = obtenerDatosDocumento();
      if (!titulo && !form.titulo.value) {
        return alert('Ingres├í un t├¡tulo o gener├í una actividad con IA antes de exportar.');
      }
      downloadActivityPdf(html, titulo || form.titulo.value);
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
    editor.innerHTML = tipo === 'evaluacion' ? `
      <div class="section-title">
        <h2>Aviso de evaluaci├│n</h2>
        <p>Deja claro tema, modalidad y materiales necesarios.</p>
      </div>
      <label>
        <span>Descripci├│n</span>
        <textarea rows="7" data-activity-questions placeholder="Tema, modalidad, material para traer o aclaraciones"></textarea>
      </label>
    ` : `
      <div class="section-title">
        <h2>Publicaci├│n del TP</h2>
        <p>Define consigna, criterios de seguimiento y fecha de entrega.</p>
      </div>
      <label>
        <span>Consigna</span>
        <textarea rows="7" data-activity-brief placeholder="Describe la actividad"></textarea>
      </label>
      <label>
        <span>Criterios de seguimiento</span>
        <input data-activity-criteria placeholder="Entrega, desarrollo, presentaci├│n" />
      </label>
    `;
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

  const schoolsForEnviar = [...new Set(read(KEYS.courses).map((course) => course.escuela).filter(Boolean))];
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
      enviarSourceLabel.textContent = `Vas a enviar ┬½${actividad.titulo}┬╗ (${activityTipoLabel(actividad)}) desde ${[actividad.curso, actividad.materia].filter(Boolean).join(' ┬À ')}.`;
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
      alert('Complet├í colegio, turno, curso y materia destino.');
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
  return item?.tipo === 'tp' ? 'TP' : 'Evaluaci├│n';
}

async function renderActivitiesList(list, onLoaded) {
  if (!list) return [];
  const response = await fetch('/api/actividades');
  if (!response.ok) {
    list.innerHTML = '<div class="empty"><h3>Sin actividades</h3><p>Todavia no se pudieron cargar actividades.</p></div>';
    if (onLoaded) onLoaded([]);
    return [];
  }
  const data = await response.json();
  const actividades = Array.isArray(data.actividades) ? data.actividades : [];
  if (onLoaded) onLoaded(actividades);

  list.innerHTML = actividades.length ? actividades.map((item) => `
    <article class="event-card">
      <div>
        <span class="tag">${esc(activityTipoLabel(item))}</span>
        ${item.estado === 'publicado' ? '<span class="tag ok">Publicado</span>' : '<span class="tag">Borrador</span>'}
      </div>
      <strong>${esc(item.titulo)}</strong>
      <small>${esc([item.colegio, item.turno, item.curso, item.materia].filter(Boolean).join(' ┬À '))}</small>
      <p>${item.fecha_publicacion ? `Publicaci├│n: ${esc(item.fecha_publicacion)}` : 'Sin fecha de publicaci├│n'}</p>
      <p>${item.fecha_vencimiento ? `Entrega: ${esc(item.fecha_vencimiento)}` : 'Sin fecha de entrega'}</p>
      <div class="actions-group">
        <button class="btn btn-primary btn-sm" type="button" data-cargar-entrega-actividad="${esc(item.id)}">Cargar entrega</button>
        <button class="btn btn-secondary btn-sm" type="button" data-enviar-actividad="${esc(item.id)}">Enviar a curso</button>
      </div>
    </article>
  `).join('') : '<div class="empty"><h3>Sin actividades</h3><p>Prepara una evaluaci├│n o TP para empezar.</p></div>';

  return actividades;
}

function formatSyncStatus(counts = {}) {
  const pending = (counts.pending || 0) + (counts.syncing || 0);
  const synced = counts.synced || 0;
  const error = counts.error || 0;
  return `${pending} pendientes ┬À ${synced} sincronizadas ┬À ${error} con error`;
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

async function pullRemoteData(scope = 'all') {
  await syncPendingOperations();

  if (scope === 'all' || scope === 'calendario') {
    const root = document.querySelector('[data-activities][data-calendar]') || document.querySelector('[data-calendar]');
    if (root) {
      const monthInput = root.querySelector('[data-calendar-month]');
      const courseSelect = root.querySelector('[data-calendar-course]');
      const subjectSelect = root.querySelector('[data-calendar-subject]');
      await loadCalendar(
        root,
        monthInput?.value || today().slice(0, 7),
        courseSelect?.value || '',
        subjectSelect?.value || '',
      );
    }
  }

  if (scope === 'all' || scope === 'actividades') {
    const list = document.querySelector('[data-activity-list]');
    if (list) await renderActivitiesList(list);
  }
}

const spaRuntime = window.__AULA_CLARA_SPA__ || { enabled: false, initialView: 'panel' };

async function bootstrap() {
  if (currentUser?.id) {
    await hydrateLocalStorageFromServer(currentUser.id);
  }
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
}

void bootstrap();
