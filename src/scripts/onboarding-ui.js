import { onboardingDismissedKey } from '../lib/client-storage-keys.ts';
import { registerSpaViewRefresh } from './spa-router.ts';

/**
 * Checklist de 3 pasos en el panel docente.
 * Paso 1: al menos un curso en el ciclo lectivo activo.
 * Paso 2: al menos un alumno activo.
 * Paso 3: al menos un registro de asistencia guardado.
 */
const STEPS = [
  { id: 1, label: 'Creá un curso', nav: 'cursos', cta: 'Crear curso' },
  { id: 2, label: 'Cargá alumnos', nav: 'registro', cta: 'Cargar alumnos' },
  { id: 3, label: 'Tomá asistencia', nav: 'asistencia', cta: 'Tomar asistencia' },
];

export function initOnboarding({ getUserId, hasCourse, hasStudents, hasAttendance, onPanelRefresh }) {
  const root = document.querySelector('[data-onboarding]');
  const hero = document.querySelector('[data-panel-hero]');
  const resume = document.querySelector('[data-onboarding-resume]');
  if (!root) return;

  const stepsList = root.querySelector('[data-onboarding-steps]');
  const progressNode = root.querySelector('[data-onboarding-progress]');
  const cta = root.querySelector('[data-onboarding-cta]');
  const dismiss = root.querySelector('[data-onboarding-dismiss]');

  function getProgress() {
    const completed = [hasCourse(), hasStudents(), hasAttendance()];
    const complete = completed.every(Boolean);
    const currentStep = completed[0]
      ? completed[1]
        ? completed[2]
          ? 4
          : 3
        : 2
      : 1;
    return { completed, complete, currentStep };
  }

  function isDismissed() {
    const userId = getUserId();
    if (!userId) return false;
    return localStorage.getItem(onboardingDismissedKey(userId)) === 'true';
  }

  function setDismissed(value) {
    const userId = getUserId();
    if (!userId) return;
    localStorage.setItem(onboardingDismissedKey(userId), value ? 'true' : 'false');
  }

  function showNode(node) {
    if (!node) return;
    node.classList.remove('is-hidden');
    node.removeAttribute('hidden');
  }

  function hideNode(node) {
    if (!node) return;
    node.classList.add('is-hidden');
    node.setAttribute('hidden', '');
  }

  function renderSteps(completed, currentStep) {
    if (!stepsList) return;

    stepsList.innerHTML = STEPS.map((step, index) => {
      const done = completed[index];
      const isCurrent = step.id === currentStep;
      const locked = !done && step.id > currentStep;

      let stateClass = '';
      let indicator = '○';
      let statusText = 'Pendiente';

      if (done) {
        stateClass = 'onboarding-step--done';
        indicator = '✓';
        statusText = 'Completado';
      } else if (isCurrent) {
        stateClass = 'onboarding-step--current';
        indicator = '●';
        statusText = 'Paso actual';
      } else if (locked) {
        stateClass = 'onboarding-step--locked';
        statusText = 'Completá el paso anterior';
      }

      return `<li class="onboarding-step ${stateClass}"${isCurrent ? ' aria-current="step"' : ''}>
        <span class="onboarding-step-indicator" aria-hidden="true">${indicator}</span>
        <span class="onboarding-step-label">${step.label}</span>
        <span class="sr-only">${statusText}</span>
      </li>`;
    }).join('');
  }

  function updateCta(currentStep) {
    if (!cta) return;
    const step = STEPS.find((item) => item.id === currentStep);
    if (!step) return;
    cta.textContent = step.cta;
    cta.setAttribute('data-spa-nav', step.nav);
  }

  function render() {
    const userId = getUserId();
    if (!userId) {
      hideNode(root);
      showNode(hero);
      hideNode(resume);
      return;
    }

    const { completed, complete, currentStep } = getProgress();

    if (complete) {
      hideNode(root);
      showNode(hero);
      hideNode(resume);
      return;
    }

    if (isDismissed()) {
      hideNode(root);
      showNode(hero);
      showNode(resume);
      return;
    }

    showNode(root);
    hideNode(hero);
    hideNode(resume);

    if (progressNode) {
      progressNode.textContent = `Paso ${Math.min(currentStep, 3)} de 3`;
    }
    renderSteps(completed, currentStep);
    updateCta(currentStep);
  }

  dismiss?.addEventListener('click', () => {
    setDismissed(true);
    render();
  });

  resume?.addEventListener('click', () => {
    setDismissed(false);
    render();
  });

  onPanelRefresh(render);
  registerSpaViewRefresh('panel', render);
  window.addEventListener('aula-clara:local-data-changed', render);

  render();
}
