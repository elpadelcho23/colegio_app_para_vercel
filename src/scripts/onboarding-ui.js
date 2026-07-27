import { onboardingDismissedKey } from '../lib/client-storage-keys.ts';
import { registerSpaViewRefresh } from './spa-router.ts';

/**
 * Checklist de estado real en el panel docente.
 * Cada paso se completa según datos locales / contexto.
 */
const STEPS = [
  { id: 1, label: 'Creá un curso', nav: 'cursos', cta: 'Crear curso' },
  { id: 2, label: 'Creá o asigná una materia', nav: 'cursos', cta: 'Ver cursos y materias' },
  { id: 3, label: 'Cargá alumnos', nav: 'registro', cta: 'Cargar alumnos' },
  { id: 4, label: 'Elegí el curso actual', nav: 'panel', cta: 'Elegir curso actual', openContext: true },
  { id: 5, label: 'Creá la primera actividad', nav: 'actividades', cta: 'Ir a Actividades' },
];

export function initOnboarding({
  getUserId,
  hasCourse,
  hasSubject,
  hasStudents,
  hasTeachingContext,
  hasActivity,
  openTeachingContextPicker,
  onPanelRefresh,
}) {
  const root = document.querySelector('[data-onboarding]');
  const hero = document.querySelector('[data-panel-hero]');
  const resume = document.querySelector('[data-onboarding-resume]');
  if (!root) return;

  const stepsList = root.querySelector('[data-onboarding-steps]');
  const progressNode = root.querySelector('[data-onboarding-progress]');
  const cta = root.querySelector('[data-onboarding-cta]');
  const dismiss = root.querySelector('[data-onboarding-dismiss]');

  function getCompletedFlags() {
    return [
      Boolean(hasCourse?.()),
      Boolean(hasSubject?.()),
      Boolean(hasStudents?.()),
      Boolean(hasTeachingContext?.()),
      Boolean(hasActivity?.()),
    ];
  }

  function getProgress() {
    const completed = getCompletedFlags();
    const complete = completed.every(Boolean);
    let currentStep = STEPS.length + 1;
    for (let i = 0; i < completed.length; i += 1) {
      if (!completed[i]) {
        currentStep = i + 1;
        break;
      }
    }
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
    if (step.openContext) {
      cta.removeAttribute('data-spa-nav');
      cta.dataset.onboardingOpenContext = '1';
    } else {
      delete cta.dataset.onboardingOpenContext;
      cta.setAttribute('data-spa-nav', step.nav);
    }
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
      progressNode.textContent = `Paso ${Math.min(currentStep, STEPS.length)} de ${STEPS.length}`;
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

  cta?.addEventListener('click', (event) => {
    if (cta.dataset.onboardingOpenContext !== '1') return;
    event.preventDefault();
    openTeachingContextPicker?.();
  });

  onPanelRefresh(render);
  registerSpaViewRefresh('panel', render);
  window.addEventListener('aula-clara:local-data-changed', render);
  window.addEventListener('aula-clara:teaching-context-changed', render);

  render();
}
