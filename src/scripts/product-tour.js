import { productTourKey } from '../lib/client-storage-keys.ts';
import { showSpaView } from './spa-router.ts';
import { closeMenu, openMenu } from './ui-nav.js';

/**
 * Flujo completo de uso (pensado también para celular).
 * Cada paso navega a la pantalla real y destaca el control útil.
 */
const TOUR_STEPS = [
  {
    id: 'bienvenida',
    view: 'panel',
    title: 'Empezamos por el Panel',
    body: 'Acá ves el día de trabajo. Primero elegís el curso arriba; después usás Asistencia, Notas o importás alumnos.',
    target: '[data-panel-hero], [data-onboarding]',
  },
  {
    id: 'curso-actual',
    view: 'panel',
    title: 'Curso actual',
    body: 'Tocá “Cambiar” y elegí escuela, curso y materia. Asistencia, Notas y Actividades usan siempre esta elección.',
    target: '[data-global-teaching-context], [data-gtc-toggle]',
  },
  {
    id: 'resumen',
    view: 'panel',
    title: 'Resumen del curso',
    body: 'Estas 4 tarjetas muestran alumnos, cursos, promedio y asistencia. Tocá cualquiera para saltar a esa sección.',
    target: '[data-dashboard], [data-panel-summary]',
  },
  {
    id: 'excel',
    view: 'registro',
    title: 'Cargá alumnos con Excel',
    body: 'Lo más rápido: subí la planilla, confirmá las columnas y guardá. Escuela, curso, materias y alumnos entran juntos.',
    target: '[data-spa-view="registro"] [data-student-mode-panel="excel"], [data-spa-view="registro"] .excel-workspace',
  },
  {
    id: 'alumnos',
    view: 'registro',
    title: 'Lista de alumnos',
    body: 'Abajo ves quién ya está cargado. Si hace falta, también podés agregar uno a uno en “Cargar uno a uno”.',
    target: '[data-spa-view="registro"] [data-student-list], [data-spa-view="registro"] .page-header',
  },
  {
    id: 'cursos',
    view: 'cursos',
    title: 'Organizá cursos',
    body: 'Acá gestionás divisiones y materias. Si importaste con Excel, suele estar casi listo; si no, creá el curso antes de pasar lista.',
    target: '[data-spa-view="cursos"] .page-header, [data-spa-view="cursos"] [data-course-form]',
  },
  {
    id: 'asistencia',
    view: 'asistencia',
    title: 'Pasá lista',
    body: 'Marcá presente o ausente para el curso elegido arriba. En el celular cada alumno es una tarjeta fácil de tocar.',
    target: '[data-spa-view="asistencia"] [data-attendance-take-view], [data-spa-view="asistencia"] .page-header',
  },
  {
    id: 'asistencia-guardar',
    view: 'asistencia',
    title: 'Guardá la asistencia',
    body: 'Cuando termines, confirmá con Guardar. En el teléfono la barra queda fija abajo para no perderla al scrollear.',
    target: '[data-spa-view="asistencia"] [data-attendance-save-bar]',
  },
  {
    id: 'notas',
    view: 'notas',
    title: 'Cargá calificaciones',
    body: 'Acá cargás notas del mismo curso actual. Revisá el listado y guardá cuando termines; el promedio del Panel se actualiza solo.',
    target: '[data-spa-view="notas"] [data-grades-take-view], [data-spa-view="notas"] .page-header',
  },
  {
    id: 'actividades',
    view: 'actividades',
    title: 'Actividades y trabajos',
    body: 'Desde acá armás contenidos, entregas y seguimiento. Si usás IA, también está en este panel.',
    target: '[data-spa-view="actividades"] .page-header, [data-spa-view="actividades"] .activity-flow-tabs',
  },
  {
    id: 'menu',
    view: 'panel',
    title: 'Menú de paneles',
    body: 'En el celular abrís el menú ☰ para cambiar de sección. En pantallas grandes el menú queda a la izquierda.',
    target: '[data-menu-toggle], [data-nav-menu] .nav-tab.active, [data-nav-menu]',
    openMenuOnMobile: true,
  },
  {
    id: 'ayuda',
    view: 'panel',
    title: 'Ayuda cuando la necesites',
    body: 'El botón “?” vuelve a abrir este tutorial o te lleva a instalar la app. Ya podés usar el flujo completo del aula.',
    target: '[data-help-menu], [data-panel-summary]',
  },
];

function setTourStatus(userId, value) {
  if (!userId) return;
  localStorage.setItem(productTourKey(userId), value);
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 1023px)').matches;
}

function waitForPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

function pickTarget(selector) {
  if (!selector) return null;
  return [...document.querySelectorAll(selector)].find((node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.closest('.spa-view--hidden')) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }) || null;
}

/**
 * Tour guiado de uso completo.
 * Se inicia desde el panel (“¿Arrancamos con el tutorial?”) o desde el menú “?”.
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
    showSpaView('panel');
    document.querySelector('[data-help-menu]')?.removeAttribute('open');
    document.body.classList.remove('product-tour-active', 'product-tour-menu-step');
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
    showSpaView(step.view);
    await waitForPaint();

    const menuStep = Boolean(step.openMenuOnMobile && isMobileViewport());
    document.body.classList.toggle('product-tour-menu-step', menuStep);
    overlay.setMenuMode(menuStep);

    if (menuStep) {
      openMenu();
      await waitForPaint();
    }

    const target = pickTarget(step.target);
    if (target && !menuStep) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
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
      body: step.body,
      stepLabel: `${index + 1} de ${TOUR_STEPS.length}`,
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
    const target = pickTarget(step.target);
    if (target) overlay.setSpotlight(target);
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

    const pad = 8;
    const rect = target.getBoundingClientRect();
    const top = Math.max(8, rect.top - pad);
    const left = Math.max(8, rect.left - pad);
    const width = Math.min(window.innerWidth - left - 8, rect.width + pad * 2);
    const height = Math.min(window.innerHeight - top - 8, rect.height + pad * 2);

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

  nextBtn?.addEventListener('click', () => onNext?.());
  skipBtn?.addEventListener('click', () => onSkip?.());
  // Solo el botón Salir cierra: así se puede tocar la zona destacada (curso, Excel, etc.).
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
      root.classList.add('is-hidden');
      root.setAttribute('hidden', '');
    },
    setSpotlight,
    clearSpotlight,
    rememberTarget,
    setMenuMode,
  };
}
