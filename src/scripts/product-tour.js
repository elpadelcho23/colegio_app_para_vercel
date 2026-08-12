import { productTourKey } from '../lib/client-storage-keys.ts';
import { showSpaView } from './spa-router.ts';
import { closeMenu, openMenu } from './ui-nav.js';

/**
 * Tour guiado: pocos pasos, cada uno abre/marca el control real.
 * Menos invasivo: dim suave + spotlight preciso (no pantallas enteras).
 */
const TOUR_STEPS = [
  {
    id: 'bienvenida',
    view: 'panel',
    title: 'Empezamos acá',
    body: 'Este es tu Panel. El orden típico: elegí el curso arriba, cargá alumnos y pasá lista o notas.',
    bodyShort: 'Curso arriba → Excel → Asistencia o Notas.',
    target: '[data-panel-hero], [data-onboarding]',
  },
  {
    id: 'curso-actual',
    view: 'panel',
    title: 'Curso actual',
    body: 'Tocá “Cambiar”, elegí curso y materia, y confirmá. Todo el trabajo del día usa esta elección.',
    bodyShort: 'Tocá “Cambiar”, elegí curso y materia, y confirmá.',
    target: '[data-gtc-form], [data-global-teaching-context]',
    preferTarget: '[data-gtc-toggle]',
    openGtc: true,
    softChrome: true,
  },
  {
    id: 'resumen',
    view: 'panel',
    title: 'Resumen',
    body: 'Estas tarjetas resumen el curso. Tocá una para ir a Alumnos, Cursos, Notas o Asistencia.',
    bodyShort: 'Tocá una tarjeta para abrir esa sección.',
    target: '[data-dashboard] .metric--link, [data-dashboard], [data-panel-summary]',
  },
  {
    id: 'excel',
    view: 'registro',
    title: 'Cargar con Excel',
    body: 'Lo más rápido para armar el aula: subí la planilla, confirmá columnas y guardá.',
    bodyShort: 'Subí el Excel, confirmá columnas y guardá.',
    target: '[data-spa-view="registro"] [data-excel-dropzone], [data-spa-view="registro"] [data-student-mode-panel="excel"], [data-spa-view="registro"] .excel-workspace',
  },
  {
    id: 'asistencia',
    view: 'asistencia',
    title: 'Pasar lista',
    body: 'Marcá presente o ausente y tocá Guardar abajo. En el celular la barra queda fija.',
    bodyShort: 'Marcá presente/ausente y Guardá abajo.',
    target: '[data-spa-view="asistencia"] [data-attendance-take-view], [data-spa-view="asistencia"] .page-header',
  },
  {
    id: 'notas',
    view: 'notas',
    title: 'Notas',
    body: 'Cargá calificaciones del mismo curso actual y guardá. El promedio del Panel se actualiza solo.',
    bodyShort: 'Cargá notas del curso y Guardá.',
    target: '[data-spa-view="notas"] [data-grades-take-view] .grade-bulk-list, [data-spa-view="notas"] [data-grades-take-view], [data-spa-view="notas"] .page-header',
  },
  {
    id: 'actividades',
    view: 'actividades',
    title: 'Actividades',
    body: 'Acá están contenidos, entregas y seguimiento. Podés volver cuando lo necesites.',
    bodyShort: 'Contenidos, entregas y seguimiento.',
    target: '[data-spa-view="actividades"] .activity-flow-tabs, [data-spa-view="actividades"] .page-header',
  },
  {
    id: 'menu-ayuda',
    view: 'panel',
    title: 'Menú y ayuda',
    body: 'Con ☰ cambiás de sección. En “?” reabrís este tutorial o instalás la app.',
    bodyShort: '☰ cambia de sección. “?” reabre el tutorial.',
    target: '[data-help-tour-item], [data-help-menu], [data-menu-toggle]',
    openMenuOnMobile: true,
    openHelpOnMobile: true,
  },
];

function setTourStatus(userId, value) {
  if (!userId) return;
  localStorage.setItem(productTourKey(userId), value);
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 1023px)').matches;
}

function stepBody(step) {
  if (isMobileViewport() && step.bodyShort) return step.bodyShort;
  return step.body;
}

function waitForPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isVisible(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.closest('.spa-view--hidden')) return false;
  if (node.hasAttribute('hidden') || node.classList.contains('is-hidden')) return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function pickTarget(selector) {
  if (!selector) return null;
  return [...document.querySelectorAll(selector)].find((node) => isVisible(node)) || null;
}

function openGtcForTour() {
  const root = document.querySelector('[data-global-teaching-context]');
  const form = root?.querySelector('[data-gtc-form]');
  if (!(form instanceof HTMLElement) || !(root instanceof HTMLElement)) return;

  // Abrir el selector sin depender de botones ocultos (ej. gate ya cerrado).
  form.classList.remove('is-hidden');
  form.hidden = false;
  root.classList.add('gtc--tour-open');
  root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeGtcTourState() {
  document.querySelector('[data-global-teaching-context]')?.classList.remove('gtc--tour-open');
}

/**
 * Tour guiado de uso.
 * Se inicia desde el panel o desde el menú “?”.
 */
export function initProductTour({ getUserId }) {
  const startButtons = [
    ...document.querySelectorAll('[data-product-tour-start], [data-setup-tutorial-start]'),
  ];
  const overlay = ensureTourOverlay();
  let stepIndex = 0;
  let running = false;

  const finishTour = (status) => {
    running = false;
    setTourStatus(getUserId(), status);
    overlay.clearSpotlight();
    overlay.close();
    closeMenu();
    closeGtcTourState();
    showSpaView('panel');
    document.querySelector('[data-help-menu]')?.removeAttribute('open');
    document.body.classList.remove(
      'product-tour-active',
      'product-tour-menu-step',
      'product-tour-soft-chrome',
    );
    window.dispatchEvent(new CustomEvent('aula-clara:local-data-changed'));
  };

  const showStep = async (index) => {
    stepIndex = index;
    const step = TOUR_STEPS[index];
    if (!step) {
      finishTour('done');
      return;
    }

    running = true;
    document.body.classList.add('product-tour-active');
    closeMenu();
    closeGtcTourState();
    showSpaView(step.view);
    await waitForPaint();

    const menuStep = Boolean(step.openMenuOnMobile && isMobileViewport());
    const softChrome = Boolean(step.softChrome);
    document.body.classList.toggle('product-tour-menu-step', menuStep);
    document.body.classList.toggle('product-tour-soft-chrome', softChrome && !menuStep);
    overlay.setMenuMode(menuStep);
    overlay.setSoftChrome(softChrome && !menuStep);

    if (step.openGtc) {
      openGtcForTour();
      await waitForPaint();
      await wait(40);
    }

    if (menuStep) {
      openMenu();
      await waitForPaint();
      if (step.openHelpOnMobile) {
        document.querySelector('[data-help-menu]')?.setAttribute('open', '');
        await waitForPaint();
      }
    } else {
      document.querySelector('[data-help-menu]')?.removeAttribute('open');
    }

    // Primero el control puntual (ej. Cambiar); si el form ya está abierto, priorizarlo.
    const target = pickTarget(step.target) || pickTarget(step.preferTarget);
    if (target && !menuStep) {
      const inStickyChrome = Boolean(target.closest('.app-shell'));
      target.scrollIntoView({
        behavior: 'smooth',
        block: inStickyChrome ? 'nearest' : 'center',
        inline: 'nearest',
      });
      await wait(120);
      await waitForPaint();
      overlay.setSpotlight(target);
    } else if (target && menuStep) {
      target.classList.add('tour-target-active');
      overlay.clearSpotlight();
      overlay.rememberTarget(target);
    } else {
      overlay.clearSpotlight();
    }

    overlay.open({
      title: step.title,
      body: stepBody(step),
      stepLabel: `${index + 1}/${TOUR_STEPS.length}`,
      onNext: () => {
        void showStep(index + 1);
      },
      onSkip: () => finishTour('skipped'),
      isLast: index === TOUR_STEPS.length - 1,
      nextLabel: index === 0 ? 'Empezar' : undefined,
    });
  };

  const startTour = () => {
    if (running) return;
    document.querySelector('[data-help-menu]')?.removeAttribute('open');
    void showStep(0);
  };

  startButtons.forEach((btn) => {
    btn.addEventListener('click', (event) => {
      // El onboarding ya llama startTour; evitamos doble arranque en ese botón.
      if (btn.hasAttribute('data-setup-tutorial-start')) return;
      event.preventDefault();
      startTour();
    });
  });

  window.addEventListener('resize', () => {
    if (!running) return;
    const step = TOUR_STEPS[stepIndex];
    if (!step) return;
    const target = pickTarget(step.target) || pickTarget(step.preferTarget);
    if (target && !step.openMenuOnMobile) overlay.setSpotlight(target);
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
      <div class="product-tour-spotlight is-hidden" data-tour-spotlight hidden></div>
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
  const spotlight = root.querySelector('[data-tour-spotlight]');
  const backdrop = root.querySelector('[data-tour-backdrop]');
  let onNext = null;
  let onSkip = null;
  let spotlightTarget = null;

  const clearSpotlight = () => {
    spotlightTarget?.classList.remove('tour-target-active');
    spotlightTarget = null;
    if (spotlight instanceof HTMLElement) {
      spotlight.classList.add('is-hidden');
      spotlight.setAttribute('hidden', '');
      spotlight.style.cssText = '';
    }
  };

  const rememberTarget = (target) => {
    spotlightTarget?.classList.remove('tour-target-active');
    spotlightTarget = target instanceof HTMLElement ? target : null;
    spotlightTarget?.classList.add('tour-target-active');
  };

  const setSpotlight = (target) => {
    clearSpotlight();
    if (!(target instanceof HTMLElement) || !(spotlight instanceof HTMLElement)) return;
    rememberTarget(target);

    const pad = 10;
    const rect = target.getBoundingClientRect();
    const top = Math.max(6, rect.top - pad);
    const left = Math.max(6, rect.left - pad);
    const width = Math.min(window.innerWidth - left - 6, rect.width + pad * 2);
    const height = Math.min(window.innerHeight - top - 6, rect.height + pad * 2);

    spotlight.style.top = `${top}px`;
    spotlight.style.left = `${left}px`;
    spotlight.style.width = `${Math.max(width, 44)}px`;
    spotlight.style.height = `${Math.max(height, 44)}px`;
    spotlight.classList.remove('is-hidden');
    spotlight.removeAttribute('hidden');
  };

  const setMenuMode = (enabled) => {
    root.classList.toggle('product-tour-overlay--menu', enabled);
  };

  const setSoftChrome = (enabled) => {
    root.classList.toggle('product-tour-overlay--soft-chrome', enabled);
  };

  nextBtn?.addEventListener('click', () => onNext?.());
  skipBtn?.addEventListener('click', () => onSkip?.());
  backdrop?.addEventListener('click', (event) => {
    if (root.classList.contains('product-tour-overlay--menu')) return;
    event.preventDefault();
  });

  return {
    open({ title, body, stepLabel, onNext: next, onSkip: skip, isLast, nextLabel }) {
      onNext = next;
      onSkip = skip;
      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.textContent = body;
      if (stepEl) stepEl.textContent = stepLabel;
      if (nextBtn) nextBtn.textContent = isLast ? 'Listo' : (nextLabel || 'Siguiente');
      root.classList.remove('is-hidden');
      root.removeAttribute('hidden');
    },
    close() {
      onNext = null;
      onSkip = null;
      clearSpotlight();
      setMenuMode(false);
      setSoftChrome(false);
      root.classList.add('is-hidden');
      root.setAttribute('hidden', '');
    },
    setSpotlight,
    clearSpotlight,
    rememberTarget,
    setMenuMode,
    setSoftChrome,
  };
}
