import {
  buildAttendanceMatrix,
  buildStudentSituations,
  situationsNeedingFollowUp,
} from '../lib/student-situation.ts';
import {
  CURRICULUM_LITE,
  curriculumContextText,
} from '../lib/curriculum-lite.ts';
import {
  hasFeature,
  readTeacherPreferences,
  updateTeacherPreferences,
} from '../lib/teacher-preferences.ts';
import { printStudentNotes } from './print-student-notes.js';
import { showAppToast } from './app-feedback.js';
import { el, emptyState, replaceContent, tag } from './dom-utils.js';

/**
 * @param {{
 *  getStudents: () => any[],
 *  getCourses: () => any[],
 *  getSubjects: () => any[],
 *  getAttendance: () => any[],
 *  getGrades: () => any[],
 *  getDashboardFilters: () => { escuela?: string, curso?: string, materia?: string },
 *  showSpaView: (view: string, opts?: object) => void,
 *  onPanelRefresh: (fn: () => void) => void,
 * }} deps
 */
export function initTeacherFeatures(deps) {
  let cachedActivities = [];
  let cachedDeliveries = [];

  const loadActivities = async () => {
    try {
      const response = await fetch('/api/actividades');
      if (!response.ok) return [];
      const data = await response.json();
      const list = Array.isArray(data) ? data : (data.actividades || data.items || []);
      return list.map((item) => ({
        id: item.id,
        titulo: item.titulo,
        tipo: item.tipo,
        cursoId: item.cursoId || item.curso_id,
        materiaId: item.materiaId || item.materia_id,
        fechaPublicacion: item.fechaPublicacion || item.fecha_publicacion,
        fechaVencimiento: item.fechaVencimiento || item.fecha_vencimiento,
      }));
    } catch {
      return [];
    }
  };

  const computeSituations = (filters = {}) => {
    const prefs = readTeacherPreferences();
    return buildStudentSituations({
      students: deps.getStudents(),
      courses: deps.getCourses(),
      subjects: deps.getSubjects(),
      attendance: deps.getAttendance(),
      grades: deps.getGrades(),
      activities: cachedActivities,
      deliveries: cachedDeliveries,
      filters: {
        escuela: filters.escuela || '',
        cursoId: filters.curso || filters.cursoId || '',
        subjectId: filters.materia || filters.subjectId || '',
        attendanceThreshold: prefs.attendanceThreshold,
      },
    });
  };

  const refreshSeguimiento = () => {
    const root = document.querySelector('[data-seguimiento]');
    const list = root?.querySelector('[data-seguimiento-list]');
    if (!list) return;

    const filters = deps.getDashboardFilters();
    const followUp = situationsNeedingFollowUp(computeSituations(filters));

    if (!followUp.length) {
      replaceContent(list, emptyState(
        'Sin alumnos en seguimiento',
        'Con el filtro actual nadie está libre ni en riesgo. Tomá más asistencia o cargá trabajos para afinar sugerencias.',
      ));
      return;
    }

    replaceContent(list, ...followUp.map((item) => {
      const statusLabel = item.status === 'libre' ? 'Libre' : item.status === 'riesgo' ? 'Riesgo' : 'Atención';
      const statusClass = item.status === 'libre' || item.status === 'riesgo' ? 'danger' : 'warning';
      const attendanceText = item.attendanceRate === null ? 'Sin datos' : `${item.attendanceRate.toFixed(0)}%`;
      const pendingText = item.pendingWorks.length
        ? item.pendingWorks.map((work) => work.titulo).slice(0, 3).join(' · ')
        : 'Sin TP sugerido aún';
      const absentText = item.absentDates.slice(-4).join(', ') || '—';

      return el('article', { className: 'student-row seguimiento-row' },
        el('div', {},
          el('strong', {}, item.student.nombre),
          el('small', {}, `${item.course?.nombre || ''} ${item.course?.turno || ''} · ${item.subjectName}`),
          el('small', {}, `Asistencia ${attendanceText} · Faltas recientes: ${absentText}`),
          el('small', {}, `Recuperar: ${pendingText}`),
        ),
        el('div', { className: 'row-actions' },
          tag(statusLabel, `tag ${statusClass}`),
          el('button', {
            className: 'btn btn-ghost',
            type: 'button',
            dataset: {
              printStudentNote: item.student.id,
              printSubjectId: item.subjectId,
            },
          }, 'Imprimir ficha'),
          el('button', {
            className: 'btn btn-secondary',
            type: 'button',
            dataset: {
              createRecovery: item.student.id,
              recoverySubjectId: item.subjectId,
              recoveryCourseId: item.course?.id || item.student.cursoId,
              recoveryTitle: item.pendingWorks[0]?.titulo || 'Recuperatorio',
            },
          }, 'Crear recuperatorio'),
        ),
      );
    }));
  };

  const printForFilters = (studentId = '') => {
    const dashboard = deps.getDashboardFilters();
    const gradesRoot = document.querySelector('[data-grades]');
    const filters = {
      escuela: dashboard.escuela
        || gradesRoot?.querySelector('[data-grade-school-filter]')?.value
        || '',
      curso: dashboard.curso
        || gradesRoot?.querySelector('[data-grade-course-filter]')?.value
        || '',
      materia: dashboard.materia
        || gradesRoot?.querySelector('[data-grade-subject-filter]')?.value
        || '',
    };
    let situations = computeSituations(filters);
    if (studentId) {
      situations = situations.filter((item) => item.student.id === studentId);
    }
    // Si no hay filtro y se imprimió desde notas, preferir alumnos con notas recientes
    if (!situations.length) {
      showAppToast('No hay alumnos para imprimir con el filtro actual.', 'warning');
      return;
    }
    const courseLabel = situations[0]?.course
      ? `${situations[0].course.nombre} ${situations[0].course.turno || ''}`.trim()
      : 'Curso';
    const ok = printStudentNotes(situations, {
      title: `Notas del curso — ${courseLabel}`,
      periodLabel: 'Ciclo lectivo actual',
    });
    if (!ok) {
      showAppToast('Permití ventanas emergentes para imprimir.', 'error');
      return;
    }
    showAppToast('Documento de impresión abierto.', 'ok');
  };

  document.addEventListener('click', (event) => {
    const printCourse = event.target.closest('[data-print-course-notes]');
    if (printCourse) {
      printForFilters();
      return;
    }

    const printOne = event.target.closest('[data-print-student-note]');
    if (printOne) {
      printForFilters(printOne.dataset.printStudentNote);
      return;
    }

    const recovery = event.target.closest('[data-create-recovery]');
    if (recovery) {
      const courseId = recovery.dataset.recoveryCourseId || '';
      const subjectId = recovery.dataset.recoverySubjectId || '';
      const title = recovery.dataset.recoveryTitle || 'Recuperatorio';
      sessionStorage.setItem('aula_clara_recovery_draft', JSON.stringify({
        courseId,
        subjectId,
        title: `Recuperatorio: ${title}`,
        periodo: 'recuperatorio',
        studentId: recovery.dataset.createRecovery || '',
      }));
      deps.showSpaView('notas');
      showAppToast('Abrí calificaciones con recuperatorio listo para completar.', 'ok');
      window.setTimeout(() => applyRecoveryDraft(), 200);
    }
  });

  const applyRecoveryDraft = () => {
    try {
      const raw = sessionStorage.getItem('aula_clara_recovery_draft');
      if (!raw) return;
      const draft = JSON.parse(raw);
      const root = document.querySelector('[data-grades]');
      if (!root) return;
      const courseFilter = root.querySelector('[data-grade-course-filter]');
      const subjectFilter = root.querySelector('[data-grade-subject-filter]');
      const periodSelect = root.querySelector('[data-grade-period]');
      const titleInput = root.querySelector('[name="titulo"]');
      if (courseFilter && draft.courseId) {
        courseFilter.value = draft.courseId;
        courseFilter.dispatchEvent(new Event('change'));
      }
      if (subjectFilter && draft.subjectId) {
        subjectFilter.value = draft.subjectId;
        subjectFilter.dispatchEvent(new Event('change'));
      }
      if (periodSelect) periodSelect.value = 'recuperatorio';
      if (titleInput) titleInput.value = draft.title || 'Recuperatorio';
      sessionStorage.removeItem('aula_clara_recovery_draft');
      titleInput?.focus();
    } catch {
      /* ignore */
    }
  };

  const initMatrix = () => {
    const root = document.querySelector('[data-attendance]');
    if (!root) return;
    const monthInput = root.querySelector('[data-attendance-matrix-month]');
    const thresholdInput = root.querySelector('[data-attendance-threshold]');
    const matrixHost = root.querySelector('[data-attendance-matrix]');
    const exportBtn = root.querySelector('[data-attendance-matrix-export]');
    if (!monthInput || !matrixHost) return;

    const prefs = readTeacherPreferences();
    if (thresholdInput) thresholdInput.value = String(prefs.attendanceThreshold);
    if (!monthInput.value) {
      const now = new Date();
      monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const renderMatrix = () => {
      const courseId = root.querySelector('[data-filter-course]')?.value
        || root.querySelector('[data-history-filter-course]')?.value
        || '';
      const subjectId = root.querySelector('[data-filter-subject]')?.value
        || root.querySelector('[data-history-filter-subject]')?.value
        || '';
      if (!courseId || !subjectId) {
        replaceContent(matrixHost, emptyState('Elegí curso y materia', 'La planilla mensural necesita curso y materia.'));
        return;
      }
      const [year, month] = monthInput.value.split('-').map(Number);
      const matrix = buildAttendanceMatrix({
        students: deps.getStudents(),
        attendance: deps.getAttendance(),
        courseId,
        subjectId,
        year,
        month,
      });
      const threshold = Number(thresholdInput?.value) || prefs.attendanceThreshold;

      const table = document.createElement('table');
      table.className = 'attendance-matrix-table';
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      headRow.appendChild(el('th', {}, 'Alumno'));
      matrix.days.forEach((day) => {
        headRow.appendChild(el('th', {}, day.slice(-2)));
      });
      headRow.appendChild(el('th', {}, '%'));
      headRow.appendChild(el('th', {}, 'Estado'));
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      matrix.rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.appendChild(el('td', {}, row.student.nombre));
        row.cells.forEach((estado) => {
          const letter = estado === 'presente' ? 'P' : estado === 'ausente' ? 'A' : '';
          tr.appendChild(el('td', { className: letter === 'A' ? 'is-absent' : letter === 'P' ? 'is-present' : '' }, letter));
        });
        const rate = row.rate === null ? '-' : `${row.rate.toFixed(0)}%`;
        tr.appendChild(el('td', {}, rate));
        const ok = row.rate !== null && row.rate >= threshold;
        tr.appendChild(el('td', {}, ok ? 'Acredita' : row.rate === null ? '-' : 'Libre'));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      replaceContent(matrixHost, table);
    };

    monthInput.addEventListener('change', renderMatrix);
    thresholdInput?.addEventListener('change', () => {
      const value = Number(thresholdInput.value);
      if (value >= 50 && value <= 100) {
        updateTeacherPreferences({ attendanceThreshold: value });
        showAppToast(`Umbral de asistencia: ${value}%`, 'ok');
      }
      renderMatrix();
      refreshSeguimiento();
    });

    ['[data-filter-course]', '[data-filter-subject]', '[data-history-filter-course]', '[data-history-filter-subject]'].forEach((selector) => {
      root.querySelector(selector)?.addEventListener('change', renderMatrix);
    });

    exportBtn?.addEventListener('click', () => {
      const courseId = root.querySelector('[data-filter-course]')?.value
        || root.querySelector('[data-history-filter-course]')?.value
        || '';
      const subjectId = root.querySelector('[data-filter-subject]')?.value
        || root.querySelector('[data-history-filter-subject]')?.value
        || '';
      if (!courseId || !subjectId) {
        showAppToast('Elegí curso y materia para exportar.', 'warning');
        return;
      }
      const [year, month] = monthInput.value.split('-').map(Number);
      const matrix = buildAttendanceMatrix({
        students: deps.getStudents(),
        attendance: deps.getAttendance(),
        courseId,
        subjectId,
        year,
        month,
      });
      const header = ['Alumno', ...matrix.days, 'Presentes', 'Total', '%'];
      const lines = [header.join(';')];
      matrix.rows.forEach((row) => {
        const cells = row.cells.map((estado) => (estado === 'presente' ? 'P' : estado === 'ausente' ? 'A' : ''));
        lines.push([
          row.student.nombre,
          ...cells,
          row.present,
          row.total,
          row.rate === null ? '' : row.rate.toFixed(0),
        ].join(';'));
      });
      const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `planilla-asistencia-${monthInput.value}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showAppToast('Planilla CSV descargada.', 'ok');
    });

    renderMatrix();
    deps.onPanelRefresh(renderMatrix);
  };

  const initKitAndPlan = () => {
    const syncKitVisibility = () => {
      const locked = document.querySelector('[data-kit-locked]');
      const content = document.querySelector('[data-kit-content]');
      const pro = hasFeature('kitDocente');
      locked?.classList.toggle('is-hidden', pro);
      content?.classList.toggle('is-hidden', !pro);
      document.querySelector('[data-kit-pro-badge]')?.classList.toggle('is-hidden', pro);
    };

    const renderPlanSummary = () => {
      const host = document.querySelector('[data-plan-summary]');
      if (!host) return;
      const prefs = readTeacherPreferences();
      replaceContent(host,
        el('div', { className: 'metric' }, el('strong', {}, prefs.features.plan.toUpperCase()), el('span', {}, 'Plan actual')),
        el('div', { className: 'metric' }, el('strong', {}, prefs.features.trialEndsAt || '—'), el('span', {}, 'Fin de prueba')),
        el('div', { className: 'metric' }, el('strong', {}, `${prefs.attendanceThreshold}%`), el('span', {}, 'Umbral asistencia')),
        el('div', { className: 'metric' }, el('strong', {}, hasFeature('curriculo') ? 'Sí' : 'No'), el('span', {}, 'Pro activo')),
      );
      syncKitVisibility();
    };

    document.querySelectorAll('[data-plan-set]').forEach((button) => {
      button.addEventListener('click', async () => {
        const plan = button.getAttribute('data-plan-set');
        if (plan === 'trial') {
          const date = new Date();
          date.setDate(date.getDate() + 30);
          updateTeacherPreferences({
            features: { plan: 'trial', trialEndsAt: date.toISOString().slice(0, 10) },
          });
          showAppToast('Prueba Pro activada por 30 días.', 'ok');
        } else if (plan === 'pro') {
          updateTeacherPreferences({ features: { plan: 'pro', trialEndsAt: null } });
          showAppToast('Plan Pro activado (demo local).', 'ok');
        } else {
          updateTeacherPreferences({ features: { plan: 'free', trialEndsAt: null } });
          showAppToast('Volviste al plan gratis.', 'ok');
        }
        const prefs = readTeacherPreferences();
        try {
          await fetch('/api/billing/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              plan: prefs.features.plan,
              trialEndsAt: prefs.features.trialEndsAt,
            }),
          });
        } catch {
          /* offline: queda en local */
        }
        renderPlanSummary();
      });
    });

    fetch('/api/billing/plan')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data?.plan) return;
        updateTeacherPreferences({
          features: {
            plan: data.plan,
            trialEndsAt: data.trialEndsAt || null,
          },
        });
        renderPlanSummary();
      })
      .catch(() => {});

    document.querySelector('[data-open-plan]')?.addEventListener('click', () => {
      const toolsRoot = document.querySelector('[data-herramientas]');
      toolsRoot?.querySelector('[data-tools-hub-tab="cuenta"]')?.click();
      window.setTimeout(() => {
        document.querySelector('[data-billing-plan]')?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    });

    const searchInput = document.querySelector('[data-kit-estatuto-search]');
    const results = document.querySelector('[data-kit-estatuto-results]');
    searchInput?.addEventListener('input', () => {
      if (!results) return;
      const needle = searchInput.value.trim().toLowerCase();
      [...results.children].forEach((li) => {
        li.hidden = Boolean(needle) && !li.textContent?.toLowerCase().includes(needle);
      });
    });

    document.querySelector('[data-download-planificacion]')?.addEventListener('click', () => {
      if (!hasFeature('kitDocente')) {
        showAppToast('Activá Pro o la prueba para descargar.', 'warning');
        return;
      }
      downloadHtmlTemplate('planificacion-aula-clara.html', `
        <h1>Planificación anual / unidad</h1>
        <p><strong>Materia:</strong> ____________ &nbsp; <strong>Curso:</strong> ____________</p>
        <h2>1. Fundamentación</h2><p>...</p>
        <h2>2. Objetivos de enseñanza</h2><ul><li></li></ul>
        <h2>3. Objetivos de aprendizaje</h2><ul><li></li></ul>
        <h2>4. Contenidos</h2><ul><li>Unidad 1</li><li>Unidad 2</li></ul>
        <h2>5. Estrategias y recursos</h2><p>...</p>
        <h2>6. Evaluación</h2><p>...</p>
      `);
    });

    document.querySelector('[data-download-salida]')?.addEventListener('click', () => {
      if (!hasFeature('kitDocente')) {
        showAppToast('Activá Pro o la prueba para descargar.', 'warning');
        return;
      }
      downloadHtmlTemplate('solicitud-salida-educativa.html', `
        <h1>Solicitud de salida educativa</h1>
        <p><strong>Escuela:</strong> ____ &nbsp; <strong>Curso:</strong> ____ &nbsp; <strong>Fecha:</strong> ____</p>
        <p><strong>Destino:</strong> ______________________________</p>
        <p><strong>Objetivos pedagógicos:</strong></p><p>...</p>
        <p><strong>Docentes a cargo:</strong></p><p>...</p>
        <p><strong>Autorización de familias:</strong> pendiente / completa</p>
      `);
    });

    const curriculumSelect = document.querySelector('[data-curriculum-subject]');
    const curriculumPreview = document.querySelector('[data-curriculum-preview]');
    if (curriculumSelect) {
      replaceContent(curriculumSelect,
        el('option', { attrs: { value: '' } }, 'Elegir materia del catálogo'),
        ...CURRICULUM_LITE.map((entry) =>
          el('option', { attrs: { value: entry.id } }, `${entry.materia} (${entry.anio} · ${entry.modalidad})`)
        ),
      );
      curriculumSelect.addEventListener('change', () => {
        const entry = CURRICULUM_LITE.find((item) => item.id === curriculumSelect.value);
        if (!curriculumPreview) return;
        if (!entry) {
          curriculumPreview.textContent = 'Elegí una materia para ver unidades sugeridas.';
          return;
        }
        curriculumPreview.textContent = entry.unidades
          .map((unit) => `${unit.titulo}: ${unit.temas.join(', ')}`)
          .join('\n');
        sessionStorage.setItem('aula_clara_curriculum_context', curriculumContextText(entry.materia));
      });
    }

    document.querySelector('[data-recovery-ai-goto]')?.addEventListener('click', () => {
      if (!hasFeature('recuperacionIa') && !hasFeature('curriculo')) {
        showAppToast('La recuperación con IA es parte de Pro / prueba.', 'warning');
        return;
      }
      const context = sessionStorage.getItem('aula_clara_curriculum_context') || '';
      if (context) {
        sessionStorage.setItem('aula_clara_ai_extra_prompt', `Recuperatorio alineado al diseño curricular. ${context}`);
      }
      showAppToast('Abrí la IA con contexto curricular de recuperación.', 'ok');
    });

    renderPlanSummary();
  };

  const hydrate = async () => {
    cachedActivities = await loadActivities();
    refreshSeguimiento();
  };

  document.querySelector('[data-dashboard-filters]')?.addEventListener('change', () => {
    refreshSeguimiento();
  });

  document.querySelector('[data-print-course-notes]') && hydrate();
  deps.onPanelRefresh(() => {
    refreshSeguimiento();
  });
  window.addEventListener('aula-clara:data-hydrated', () => {
    hydrate();
  });

  initMatrix();
  initKitAndPlan();
  hydrate();

  return {
    refreshSeguimiento,
    applyRecoveryDraft,
    getAttendanceThreshold: () => readTeacherPreferences().attendanceThreshold,
  };
}

function downloadHtmlTemplate(filename, innerHtml) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${filename}</title>
  <style>body{font-family:Segoe UI,Arial,sans-serif;max-width:800px;margin:2rem auto;line-height:1.45}</style>
  </head><body>${innerHtml}</body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showAppToast('Plantilla descargada.', 'ok');
}

export { curriculumContextText, hasFeature, readTeacherPreferences };
