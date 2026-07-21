import { productTourKey } from '../lib/client-storage-keys.ts';
import { showSpaView } from './spa-router.ts';

const TOUR_STEPS = [
  {
    id: 'asistencia',
    view: 'asistencia',
    title: 'Asistencia',
    body: 'Acá pasás lista del curso que elegiste arriba. Marcá presente o ausente y guardá.',
    target: '[data-spa-nav="asistencia"]',
  },
  {
    id: 'notas',
    view: 'notas',
    title: 'Notas',
    body: 'Acá cargás calificaciones del mismo curso. Podés volver al Panel cuando quieras.',
    target: '[data-spa-nav="notas"]',
  },
];

function tourStatus(userId) {
  if (!userId) return 'done';
  return localStorage.getItem(productTourKey(userId)) || '';
}

function setTourStatus(userId, value) {
  if (!userId) return;
  localStorage.setItem(productTourKey(userId), value);
}

/**
 * Tour opcional de ~60s: Asistencia y Notas.
 * Se ofrece una sola vez cuando el setup inicial está completo.
 */
export function initProductTour({ getUserId, isSetupComplete }) {
  const invite = document.querySelector('[data-product-tour-invite]');
  if (!invite) return { maybeOfferTour: () => {} };

  const startBtn = invite.querySelector('[data-product-tour-start]');
  const skipBtn = invite.querySelector('[data-product-tour-skip]');
  const overlay = ensureTourOverlay();

  const hideInvite = () => {
    invite.classList.add('is-hidden');
    invite.setAttribute('hidden', '');
  };

  const showInvite = () => {
    invite.classList.remove('is-hidden');
    invite.removeAttribute('hidden');
  };

  const maybeOfferTour = () => {
    const userId = getUserId();
    if (!userId || !isSetupComplete()) {
      hideInvite();
      return;
    }
    const status = tourStatus(userId);
    if (status === 'done' || status === 'skipped') {
      hideInvite();
      return;
    }
    showInvite();
  };

  const finishTour = (status) => {
    setTourStatus(getUserId(), status);
    hideInvite();
    overlay.close();
    showSpaView('panel');
  };

  let stepIndex = 0;

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

  startBtn?.addEventListener('click', () => {
    hideInvite();
    showStep(0);
  });

  skipBtn?.addEventListener('click', () => {
    finishTour('skipped');
  });

  window.addEventListener('aula-clara:local-data-changed', maybeOfferTour);
  window.addEventListener('aula-clara:data-hydrated', maybeOfferTour);

  maybeOfferTour();

  return { maybeOfferTour };
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
