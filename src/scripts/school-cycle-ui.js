import {
  cloneSchoolCycle,
  currentCalendarYear,
  formatCicloLabel,
  listAvailableCycles,
} from '../lib/school-cycle.ts';
import { showAppToast } from './app-feedback.js';

export function initSchoolCycleUi(deps) {
  const {
    readFilters,
    writeFilters,
    readCourses,
    writeCourses,
    readTeacherContext,
    writeTeacherContext,
    schoolNamesForSelect,
    queueCourseUpsert,
    uid,
    nowIso,
    onChanged,
  } = deps;

  document.querySelectorAll('[data-school-cycle]').forEach((panel) => initPanel(panel));
  document.querySelectorAll('[data-global-cycle]').forEach((select) => initGlobalSelect(select));

  function activeCiclo() {
    const filters = readFilters() || {};
    const ciclo = Number(filters.cicloLectivo);
    return Number.isFinite(ciclo) && ciclo > 0 ? ciclo : currentCalendarYear();
  }

  function setActiveCiclo(ciclo) {
    const filters = readFilters() || {};
    writeFilters({ ...filters, cicloLectivo: ciclo });
    window.dispatchEvent(new CustomEvent('aula-clara:ciclo-changed', { detail: { cicloLectivo: ciclo } }));
    onChanged?.({ cicloLectivo: ciclo });
  }

  function fillCycleSelect(select, selected) {
    if (!select) return;
    const cycles = listAvailableCycles(readCourses());
    select.innerHTML = cycles.map((ciclo) => {
      const label = formatCicloLabel(ciclo);
      const isSelected = ciclo === selected ? ' selected' : '';
      return `<option value="${ciclo}"${isSelected}>${label}</option>`;
    }).join('');
    if (!cycles.includes(selected)) {
      select.insertAdjacentHTML('afterbegin', `<option value="${selected}" selected>${formatCicloLabel(selected)}</option>`);
    }
    select.value = String(selected);
  }

  function refreshAllCycleSelects() {
    const ciclo = activeCiclo();
    document.querySelectorAll('[data-cycle-active], [data-global-cycle]').forEach((select) => {
      fillCycleSelect(select, ciclo);
    });
    document.querySelectorAll('[data-cycle-active-hint]').forEach((hint) => {
      hint.textContent = `Mostrando cursos y horarios del ciclo ${ciclo}.`;
    });
    document.querySelectorAll('[data-cycle-clone-source]').forEach((select) => {
      const cycles = listAvailableCycles(readCourses()).filter((year) => year !== activeCiclo());
      select.innerHTML = cycles.map((year) => `<option value="${year}">${formatCicloLabel(year)}</option>`).join('')
        || `<option value="${currentCalendarYear() - 1}">${formatCicloLabel(currentCalendarYear() - 1)}</option>`;
    });
    document.querySelectorAll('[data-cycle-clone-school]').forEach((select) => {
      const schools = schoolNamesForSelect();
      const current = select.value;
      select.innerHTML = ['<option value="">Todas las escuelas</option>']
        .concat(schools.map((school) => `<option value="${school}">${school}</option>`))
        .join('');
      if (current && schools.includes(current)) select.value = current;
    });
  }

  function initGlobalSelect(select) {
    fillCycleSelect(select, activeCiclo());
    select.addEventListener('change', () => {
      setActiveCiclo(Number(select.value));
      refreshAllCycleSelects();
    });
  }

  function initPanel(panel) {
    const activeSelect = panel.querySelector('[data-cycle-active]');
    const cloneSubmit = panel.querySelector('[data-cycle-clone-submit]');
    const cloneResult = panel.querySelector('[data-cycle-clone-result]');

    if (activeSelect) {
      fillCycleSelect(activeSelect, activeCiclo());
      activeSelect.addEventListener('change', () => {
        setActiveCiclo(Number(activeSelect.value));
        refreshAllCycleSelects();
      });
    }

    cloneSubmit?.addEventListener('click', async () => {
      const sourceCiclo = Number(panel.querySelector('[data-cycle-clone-source]')?.value);
      const targetCiclo = Number(panel.querySelector('[data-cycle-clone-target]')?.value);
      const escuela = String(panel.querySelector('[data-cycle-clone-school]')?.value || '').trim();
      const includeSchedules = panel.querySelector('[data-cycle-clone-schedules]')?.checked !== false;

      if (!Number.isFinite(sourceCiclo) || !Number.isFinite(targetCiclo)) {
        showAppToast('Completá los ciclos origen y destino.', 'warning');
        return;
      }
      if (sourceCiclo === targetCiclo) {
        showAppToast('El ciclo destino debe ser distinto al origen.', 'warning');
        return;
      }

      const previewCount = readCourses().filter((course) => {
        const ciclo = Number(course.cicloLectivo) || currentCalendarYear();
        if (ciclo !== sourceCiclo) return false;
        if (escuela && course.escuela !== escuela) return false;
        return true;
      }).length;

      if (!previewCount) {
        showAppToast('No hay cursos en el ciclo origen para la escuela seleccionada.', 'warning');
        return;
      }

      const confirmMsg = includeSchedules
        ? `Se crearán hasta ${previewCount} curso(s) en el ciclo ${targetCiclo} y se copiarán los bloques de horario vinculados. ¿Continuar?`
        : `Se crearán hasta ${previewCount} curso(s) en el ciclo ${targetCiclo} con sus materias predeterminadas. ¿Continuar?`;
      if (!confirm(confirmMsg)) return;

      cloneSubmit.disabled = true;
      const previousLabel = cloneSubmit.textContent;
      cloneSubmit.textContent = 'Clonando...';

      try {
        const result = cloneSchoolCycle({
          courses: readCourses(),
          teacherContext: readTeacherContext(),
          sourceCiclo,
          targetCiclo,
          escuela: escuela || undefined,
          includeSchedules,
          createId: uid,
          nowIso,
        });

        if (!result.courses.length && !result.skipped.length) {
          throw new Error('No se pudo clonar ningún curso.');
        }

        writeCourses([...readCourses(), ...result.courses]);
        if (result.teacherContext.length) {
          writeTeacherContext([...readTeacherContext(), ...result.teacherContext]);
        }

        for (const course of result.courses) {
          await queueCourseUpsert(course);
        }

        setActiveCiclo(targetCiclo);
        refreshAllCycleSelects();

        if (cloneResult) {
          cloneResult.hidden = false;
          cloneResult.className = 'import-result import-result-ok';
          const lines = [
            `Ciclo ${targetCiclo}: ${result.summary.coursesCreated} curso(s) creado(s).`,
            includeSchedules ? `${result.summary.schedulesCreated} bloque(s) de horario copiado(s).` : '',
            result.skipped.length ? `${result.skipped.length} curso(s) ya existían y se omitieron.` : '',
          ].filter(Boolean);
          cloneResult.textContent = lines.join(' ');
        }

        onChanged?.({ cicloLectivo: targetCiclo, cloned: result.summary });
      } catch (error) {
        console.error('[aula-clara] school cycle clone failed', error);
        if (cloneResult) {
          cloneResult.hidden = false;
          cloneResult.className = 'import-result import-result-error';
          cloneResult.textContent = error instanceof Error ? error.message : 'No se pudo clonar el ciclo.';
        } else {
          showAppToast(error instanceof Error ? error.message : 'No se pudo clonar el ciclo.', 'error');
        }
      } finally {
        cloneSubmit.disabled = false;
        cloneSubmit.textContent = previousLabel;
      }
    });
  }

  window.addEventListener('aula-clara:ciclo-changed', refreshAllCycleSelects);
  window.addEventListener('aula-clara:local-data-changed', refreshAllCycleSelects);
  refreshAllCycleSelects();
}
