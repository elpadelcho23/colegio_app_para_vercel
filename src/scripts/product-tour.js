import { productTourKey } from '../lib/client-storage-keys.ts';
import { showSpaView } from './spa-router.ts';

const TOUR_STEPS = [
  {
    id: 'asistencia',
    view: 'asistencia',
    title: 'Asistencia',
    body: 'Acá pasás lista del curso que elegiste arriba. Marcá presente o ausente y guardá. Más abajo está el historial.',
    target: '[data-spa-nav="asistencia"]',
  },
  {
    id: 'notas',
    view: 'notas',
    title: 'Notas',
    body: 'Acá cargás calificaciones del mismo curso. El detalle por período queda en la misma pantalla.',
    target: '[data-spa-nav="notas"]',
  },
];

function setTourStatus(userId, value) {
  if (!userId) return;
  localStorage.setItem(productTourKey(userId), value);
}

/**
 * Tour opcional (Asistencia y Notas).
 * Solo se inicia desde el menú de ayuda "?" — no se ofrece solo.
 */
export function initProductTour({ getUserId }) {
  const startButtons = [...document.querySelectorAll('[data-product-tour-start]')];
  if (!startButtons.length) return { startTour: () => {} };

  const overlay = ensureTourOverlay();
  let stepIndex = 0;

  const finishTour = (status) => {
    setTourStatus(getUserId(), status);
    overlay.close();
    showSpaView('panel');
    document.querySelector('[data-help-menu]')?.removeAttribute('open');
  };

  const showStep = (index) => {
    stepIndex = index;
    const step = TOUR_STEPS[index];
    if (!step) {
      finishTour('done');
      return;
    }
    showSpaView(step.view);
    window.requestAnimationFrame(() => {
      const targets = [...document.querySelectorAll(step.target)]
        .filter((node) => node.offsetParent !== null || node.getBoundingClientRect().width > 0);
      const target = targets[0] || document.querySelector(`[data-spa-view="${step.view}"]`);
      overlay.open({
        title: step.title,
        body: step.body,
        stepLabel: `${index + 1} de ${TOUR_STEPS.length}`,
        target,
        onNext: () => showStep(index + 1),
        onSkip: () => finishTour('skipped'),
        isLast: index === TOUR_STEPS.length - 1,
      });
    });
  };

  const startTour = () => {
    document.querySelector('[data-help-menu]')?.removeAttribute('open');
    showStep(0);
  };

  startButtons.forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      startTour();
    });
  });

  return { startTour };
}

function ensureTourOverlay() {
  let root = document.querySelector('[data-product-tour-overlay]');
  if (!root) {
    root = document.createElement('div');
    root.className = 'product-tour-overlay is-hidden';
    root.setAttribute('data-product-tour-overlay', '');
    root.setAttribute('hidden', '');
    root.innerHTML = `
      <div class="product-tour-backdrop" data-tour-backdrop></div>
      <div class="product-tour-card" role="dialog" aria-modal="true" aria-labelledby="product-tour-title">
        <p class="product-tour-step" data-tour-step></p>
        <h2 id="product-tour-title" data-tour-title></h2>
        <p data-tour-body></p>
        <div class="product-tour-actions">
          <button type="button" class="btn btn-ghost" data-tour-skip>Salir</button>
          <button type="button" class="btn btn-primary" data-tour-next>Siguiente</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
  }

  const titleEl = root.querySelector('[data-tour-title]');
  const bodyEl = root.querySelector('[data-tour-body]');
  const stepEl = root.querySelector('[data-tour-step]');
  const nextBtn = root.querySelector('[data-tour-next]');
  const skipBtn = root.querySelector('[data-tour-skip]');
  let onNext = null;
  let onSkip = null;

  nextBtn?.addEventListener('click', () => onNext?.());
  skipBtn?.addEventListener('click', () => onSkip?.());
  root.querySelector('[data-tour-backdrop]')?.addEventListener('click', () => onSkip?.());

  return {
    open({ title, body, stepLabel, onNext: next, onSkip: skip, isLast }) {
      onNext = next;
      onSkip = skip;
      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.textContent = body;
      if (stepEl) stepEl.textContent = stepLabel;
      if (nextBtn) nextBtn.textContent = isLast ? 'Listo' : 'Siguiente';
      root.classList.remove('is-hidden');
      root.removeAttribute('hidden');
    },
    close() {
      onNext = null;
      onSkip = null;
      root.classList.add('is-hidden');
      root.setAttribute('hidden', '');
    },
  };
}
