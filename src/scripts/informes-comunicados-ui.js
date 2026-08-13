import {
  applyComunicadoTemplate,
  COMUNICADO_VARIABLES,
  deleteCustomComunicadoTemplate,
  formatComunicadoDate,
  getComunicadoTemplate,
  listComunicadoTemplates,
  saveCustomComunicadoTemplate,
} from '../lib/comunicados-templates.ts';
import { openPrintDocument } from './print-student-notes.js';
import { showAppToast } from './app-feedback.js';
import { fillSelectOptions } from './dom-utils.js';

/**
 * @param {{
 *  getSchools: () => string[],
 *  getCourses: (escuela?: string) => any[],
 *  getSubjects: (course?: any) => any[],
 *  getStudents: (escuela?: string, cursoId?: string, subjectId?: string) => any[],
 *  getStudentAverage: (studentId: string, subjectId?: string) => number | null,
 *  getStudentAttendance: (studentId: string, subjectId?: string) => number | null,
 *  courseLabel?: (course: any) => string,
 *  getUserId?: () => string,
 *  onRefresh?: (fn: () => void) => void,
 * }} deps
 */
export function initInformesComunicados(deps) {
  const root = document.querySelector('[data-herramientas] [data-informes-comunicados]');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  const schoolSelect = root.querySelector('[data-informe-school]');
  const courseSelect = root.querySelector('[data-informe-course]');
  const subjectSelect = root.querySelector('[data-informe-subject]');
  const studentSelect = root.querySelector('[data-informe-student]');
  const motivoSelect = root.querySelector('[data-informe-motivo]');
  const editor = root.querySelector('[data-informe-editor]');
  const metrics = root.querySelector('[data-informe-metrics]');
  const promedioEl = root.querySelector('[data-informe-promedio]');
  const asistenciaEl = root.querySelector('[data-informe-asistencia]');
  const copyBtn = root.querySelector('[data-informe-copy]');
  const printBtn = root.querySelector('[data-informe-print]');
  const generateBtn = root.querySelector('[data-informe-generate]');
  const saveTemplateBtn = root.querySelector('[data-informe-save-template]');
  const deleteTemplateBtn = root.querySelector('[data-informe-delete-template]');
  const templateNameInput = root.querySelector('[data-informe-template-name]');
  const variablesHint = root.querySelector('[data-informe-variables]');

  let dirty = false;
  let lastGenerated = '';

  const userId = () => deps.getUserId?.() || '';

  const courseLabel = (course) => {
    if (deps.courseLabel) return deps.courseLabel(course);
    if (!course) return 'Sin curso';
    return `${course.nombre || ''} - ${course.turno || ''}`.trim();
  };

  const fillMotivos = (selected = '') => {
    const templates = listComunicadoTemplates(userId());
    fillSelectOptions(motivoSelect, templates, 'Elegí un motivo', 'id', (item) => item.label);
    if (selected) motivoSelect.value = selected;
    if (!motivoSelect.value && templates[0]) motivoSelect.value = templates[0].id;
    const current = getComunicadoTemplate(motivoSelect.value, userId());
    if (deleteTemplateBtn) {
      deleteTemplateBtn.disabled = !current || Boolean(current.builtin);
      deleteTemplateBtn.hidden = !current || Boolean(current.builtin);
    }
  };

  const fillSchools = (selected = '') => {
    const schools = (deps.getSchools() || []).map((nombre) => ({ id: nombre, nombre }));
    fillSelectOptions(schoolSelect, schools, 'Seleccionar escuela');
    if (selected) schoolSelect.value = selected;
  };

  const fillCourses = (selected = '') => {
    const courses = deps.getCourses(schoolSelect?.value || '') || [];
    fillSelectOptions(courseSelect, courses, schoolSelect?.value ? 'Seleccionar curso' : 'Elegí una escuela primero', 'id', courseLabel);
    if (selected) courseSelect.value = selected;
    if (courseSelect) courseSelect.disabled = !schoolSelect?.value || courses.length === 0;
  };

  const fillSubjects = (selected = '') => {
    const course = (deps.getCourses(schoolSelect?.value || '') || []).find((item) => item.id === courseSelect?.value);
    const subjects = deps.getSubjects(course) || [];
    fillSelectOptions(subjectSelect, subjects, courseSelect?.value ? 'Seleccionar materia' : 'Elegí un curso primero');
    if (selected) subjectSelect.value = selected;
    if (subjectSelect) subjectSelect.disabled = !courseSelect?.value || subjects.length === 0;
  };

  const fillStudents = (selected = '') => {
    const students = deps.getStudents(
      schoolSelect?.value || '',
      courseSelect?.value || '',
      subjectSelect?.value || '',
    ) || [];
    fillSelectOptions(
      studentSelect,
      students,
      subjectSelect?.value ? 'Seleccionar alumno' : 'Elegí materia primero',
      'id',
      (item) => item.nombre || 'Sin nombre',
    );
    if (selected) studentSelect.value = selected;
    if (studentSelect) {
      studentSelect.disabled = !subjectSelect?.value || students.length === 0;
    }
  };

  const formatMetric = (value, suffix = '') => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Sin datos';
    const numeric = Number(value);
    if (suffix === '%') return `${numeric.toFixed(0)}%`;
    return numeric.toFixed(1);
  };

  const currentContext = () => {
    const courses = deps.getCourses(schoolSelect?.value || '') || [];
    const course = courses.find((item) => item.id === courseSelect?.value) || null;
    const subjects = deps.getSubjects(course) || [];
    const subject = subjects.find((item) => item.id === subjectSelect?.value) || null;
    const students = deps.getStudents(schoolSelect?.value || '', courseSelect?.value || '', subjectSelect?.value || '') || [];
    const student = students.find((item) => item.id === studentSelect?.value) || null;
    const promedio = student ? deps.getStudentAverage(student.id, subject?.id || '') : null;
    const asistencia = student ? deps.getStudentAttendance(student.id, subject?.id || '') : null;
    return {
      school: schoolSelect?.value || '',
      course,
      subject,
      student,
      promedio,
      asistencia,
    };
  };

  const refreshMetrics = () => {
    const ctx = currentContext();
    const hasStudent = Boolean(ctx.student);
    if (metrics) metrics.hidden = !hasStudent;
    if (promedioEl) promedioEl.textContent = formatMetric(ctx.promedio);
    if (asistenciaEl) asistenciaEl.textContent = formatMetric(ctx.asistencia, '%');
  };

  const buildVariables = () => {
    const ctx = currentContext();
    return {
      alumno: ctx.student?.nombre || '',
      escuela: ctx.school || ctx.course?.escuela || '',
      curso: ctx.course?.nombre || '',
      turno: ctx.course?.turno || '',
      materia: ctx.subject?.nombre || '',
      promedio: formatMetric(ctx.promedio),
      asistencia: formatMetric(ctx.asistencia, '%'),
      fecha: formatComunicadoDate(),
    };
  };

  const generateFromTemplate = ({ force = false } = {}) => {
    const template = getComunicadoTemplate(motivoSelect?.value || '', userId());
    if (!template) {
      showAppToast('Elegí un motivo de comunicado.', 'warning');
      return;
    }
    const ctx = currentContext();
    if (!ctx.student) {
      showAppToast('Seleccioná escuela, curso, materia y alumno.', 'warning');
      return;
    }
    if (dirty && !force && editor?.value && editor.value !== lastGenerated) {
      const ok = window.confirm('Hay cambios en el texto. ¿Querés regenerarlo y reemplazarlos?');
      if (!ok) return;
    }
    const text = applyComunicadoTemplate(template.body, buildVariables());
    if (editor) editor.value = text;
    lastGenerated = text;
    dirty = false;
  };

  const refreshAll = () => {
    const selected = {
      school: schoolSelect?.value || '',
      course: courseSelect?.value || '',
      subject: subjectSelect?.value || '',
      student: studentSelect?.value || '',
      motivo: motivoSelect?.value || '',
    };
    fillSchools(selected.school);
    fillCourses(selected.course);
    fillSubjects(selected.subject);
    fillStudents(selected.student);
    fillMotivos(selected.motivo);
    refreshMetrics();
  };

  if (variablesHint) {
    variablesHint.textContent = `Variables disponibles: ${COMUNICADO_VARIABLES.join(' · ')}`;
  }

  schoolSelect?.addEventListener('change', () => {
    fillCourses();
    fillSubjects();
    fillStudents();
    refreshMetrics();
  });
  courseSelect?.addEventListener('change', () => {
    fillSubjects();
    fillStudents();
    refreshMetrics();
  });
  subjectSelect?.addEventListener('change', () => {
    fillStudents();
    refreshMetrics();
  });
  studentSelect?.addEventListener('change', () => {
    refreshMetrics();
    if (motivoSelect?.value) generateFromTemplate({ force: true });
  });
  motivoSelect?.addEventListener('change', () => {
    const current = getComunicadoTemplate(motivoSelect.value, userId());
    if (deleteTemplateBtn) {
      deleteTemplateBtn.disabled = !current || Boolean(current.builtin);
      deleteTemplateBtn.hidden = !current || Boolean(current.builtin);
    }
    if (currentContext().student) generateFromTemplate();
  });
  editor?.addEventListener('input', () => {
    dirty = true;
  });

  generateBtn?.addEventListener('click', () => generateFromTemplate({ force: true }));

  copyBtn?.addEventListener('click', async () => {
    const text = String(editor?.value || '').trim();
    if (!text) {
      showAppToast('No hay texto para copiar. Generá el comunicado primero.', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showAppToast('Comunicado copiado. Ya podés pegarlo en WhatsApp o el mail.', 'ok');
    } catch {
      editor?.focus();
      editor?.select?.();
      showAppToast('No se pudo copiar automáticamente. Seleccioná el texto y copiá a mano.', 'warning');
    }
  });

  printBtn?.addEventListener('click', () => {
    const text = String(editor?.value || '').trim();
    if (!text) {
      showAppToast('No hay texto para imprimir. Generá el comunicado primero.', 'warning');
      return;
    }
    const vars = buildVariables();
    const paragraphs = text
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p>${escapeHtml(block).replaceAll('\n', '<br />')}</p>`)
      .join('');

    const bodyHtml = `
      <div class="comunicado-sheet" style="max-width:720px;margin:0 auto;border:1px solid #222;padding:1.5rem 1.75rem;">
        <header style="border-bottom:2px solid #222;padding-bottom:0.75rem;margin-bottom:1rem;">
          <p style="margin:0;font-size:0.8rem;letter-spacing:0.04em;text-transform:uppercase;">Cuaderno de comunicaciones</p>
          <h2 style="margin:0.35rem 0 0;font-size:1.2rem;">${escapeHtml(vars.escuela || 'Escuela')}</h2>
          <p style="margin:0.35rem 0 0;color:#444;font-size:0.92rem;">
            ${escapeHtml(vars.curso || '—')} · Turno ${escapeHtml(vars.turno || '—')} · ${escapeHtml(vars.materia || '—')}
          </p>
          <p style="margin:0.25rem 0 0;color:#444;font-size:0.92rem;">Fecha: ${escapeHtml(vars.fecha || formatComunicadoDate())}</p>
        </header>
        <p style="margin:0 0 1rem;"><strong>Alumno/a:</strong> ${escapeHtml(vars.alumno || '—')}</p>
        <p style="margin:0 0 1rem;font-size:0.92rem;color:#444;">
          Promedio: ${escapeHtml(vars.promedio)} · Asistencia: ${escapeHtml(vars.asistencia)}
        </p>
        <div class="comunicado-body" style="line-height:1.55;font-size:1rem;">
          ${paragraphs}
        </div>
        <footer style="margin-top:2.5rem;display:grid;gap:1.75rem;">
          <div style="border-top:1px solid #999;padding-top:0.4rem;max-width:14rem;">Firma del docente</div>
          <div style="border-top:1px solid #999;padding-top:0.4rem;max-width:14rem;">Acuse de recibo / firma familiar</div>
        </footer>
      </div>
    `;

    const ok = openPrintDocument(`Comunicado — ${vars.alumno || 'Alumno'}`, bodyHtml);
    if (!ok) showAppToast('Permití ventanas emergentes para imprimir o guardar PDF.', 'warning');
  });

  saveTemplateBtn?.addEventListener('click', () => {
    const label = String(templateNameInput?.value || '').trim();
    const body = String(editor?.value || '').trim();
    if (!label) {
      showAppToast('Escribí un nombre para guardar la plantilla.', 'warning');
      templateNameInput?.focus();
      return;
    }
    if (!body) {
      showAppToast('El texto del comunicado está vacío.', 'warning');
      return;
    }
    try {
      // Guardamos con variables: si el texto ya está resuelto, el docente puede pegar plantilla con {tags}.
      const saved = saveCustomComunicadoTemplate({ label, body }, userId());
      fillMotivos(saved.id);
      if (templateNameInput) templateNameInput.value = '';
      showAppToast('Plantilla guardada en este dispositivo.', 'ok');
    } catch (error) {
      showAppToast(error?.message || 'No se pudo guardar la plantilla.', 'error');
    }
  });

  deleteTemplateBtn?.addEventListener('click', () => {
    const current = getComunicadoTemplate(motivoSelect?.value || '', userId());
    if (!current || current.builtin) return;
    if (!window.confirm(`¿Eliminar la plantilla “${current.label}”?`)) return;
    deleteCustomComunicadoTemplate(current.id, userId());
    fillMotivos('personalizada');
    showAppToast('Plantilla eliminada.', 'ok');
  });

  refreshAll();
  deps.onRefresh?.(refreshAll);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
