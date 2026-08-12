import { productGuidesKey, productTourKey } from '../lib/client-storage-keys.ts';
import { showSpaView } from './spa-router.ts';
import { navigateToToolsSection } from './tools-ui.js';
import { closeMenu, openMenu } from './ui-nav.js';

/**
 * Tutoriales guiados con barra de progreso.
 * La barra solo avanza cuando el usuario completa la acción del paso.
 * Tras el tutorial inicial se desbloquean guías temáticas en “?”.
 */

const BASIC_TOUR = {
  id: 'basico',
  title: 'Tutorial inicial',
  steps: [
    {
      id: 'bienvenida',
      view: 'panel',
      title: 'Empezamos acá',
      body: 'Este es tu Panel. Vas a elegir el curso, cargar alumnos y usar Asistencia o Notas.',
      bodyShort: 'Curso → Excel → Asistencia o Notas.',
      target: '[data-panel-hero], [data-onboarding]',
      require: 'next',
      nextLabel: 'Empezar',
    },
    {
      id: 'curso-actual',
      view: 'panel',
      title: 'Curso actual',
      body: 'Elegí curso y materia y tocá “Usar este curso”. La barra avanza cuando lo confirmás.',
      bodyShort: 'Elegí curso y materia y confirmá.',
      // Anclar al bloque entero (no solo al botón Cambiar): el form puede reflowear el sidebar.
      target: '[data-global-teaching-context]',
      openGtc: true,
      softChrome: true,
      require: 'teaching-context',
    },
    {
      id: 'resumen',
      view: 'panel',
      title: 'Resumen',
      body: 'Tocá una tarjeta del Resumen (Alumnos, Cursos, Promedio o Asistencia) para abrir esa sección.',
      bodyShort: 'Tocá una tarjeta del Resumen.',
      target: '[data-dashboard] .metric--link, [data-dashboard]',
      require: 'click',
      requireClick: '[data-dashboard] .metric--link, [data-dashboard] [data-spa-nav]',
    },
    {
      id: 'excel',
      view: 'registro',
      title: 'Cargar con Excel',
      body: 'Tocá la zona para subir el Excel o elegí un archivo. Así avanza la barra.',
      bodyShort: 'Tocá para subir el Excel o elegí un archivo.',
      target: '[data-spa-view="registro"] [data-excel-dropzone], [data-spa-view="registro"] [data-excel-file]',
      require: 'click',
      requireClick:
        '[data-spa-view="registro"] [data-excel-dropzone], [data-spa-view="registro"] [data-excel-file], [data-spa-view="registro"] [data-excel-workspace-form] input[type="file"]',
    },
    {
      id: 'asistencia',
      view: 'asistencia',
      title: 'Pasar lista',
      body: 'Marcá presente o ausente en un alumno. Si aún no hay alumnos, tocá el panel de pasar lista.',
      bodyShort: 'Marcá presente/ausente o tocá el panel.',
      target: '[data-spa-view="asistencia"] [data-attendance-list], [data-spa-view="asistencia"] [data-attendance-take-view]',
      require: 'click',
      requireClick:
        '[data-spa-view="asistencia"] [data-attendance-list] button, [data-spa-view="asistencia"] [data-attendance-take-view] button, [data-spa-view="asistencia"] [data-attendance-take-view]',
    },
    {
      id: 'notas',
      view: 'notas',
      title: 'Notas',
      body: 'Tocá el listado o un campo de calificación para practicar la carga de notas.',
      bodyShort: 'Tocá el listado o un campo de nota.',
      target: '[data-spa-view="notas"] [data-grade-bulk-list], [data-spa-view="notas"] [data-grades-take-view]',
      require: 'click',
      requireClick:
        '[data-spa-view="notas"] [data-grade-bulk-list] input, [data-spa-view="notas"] [data-grade-bulk-list] button, [data-spa-view="notas"] [data-grade-bulk-list], [data-spa-view="notas"] [data-grades-take-view]',
    },
    {
      id: 'menu-ayuda',
      view: 'panel',
      title: 'Más guías en “?”',
      body: 'Cuando termines, en Ayuda (?) vas a ver guías: curso, Excel, lista, notas, cursos, actividades y cuenta.',
      bodyShort: 'En “?” vas a ver más guías.',
      target: '[data-help-menu], [data-menu-toggle]',
      openMenuOnMobile: true,
      openHelpOnMobile: true,
      require: 'next',
      nextLabel: 'Listo',
    },
  ],
};

const TOPIC_GUIDES = {
  curso: {
    id: 'curso',
    title: 'Guía: Curso actual',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'curso-abrir',
        view: 'panel',
        title: 'Abrir curso actual',
        body: 'Tocá “Cambiar” para abrir escuela, curso y materia.',
        bodyShort: 'Tocá “Cambiar”.',
        target: '[data-gtc-toggle], [data-global-teaching-context]',
        softChrome: true,
        require: 'click',
        requireClick: '[data-gtc-toggle], [data-gtc-open]',
      },
      {
        id: 'curso-guardar',
        view: 'panel',
        title: 'Confirmar selección',
        body: 'Elegí curso y materia y tocá “Usar este curso”.',
        bodyShort: 'Confirmá curso y materia.',
        target: '[data-global-teaching-context]',
        openGtc: true,
        softChrome: true,
        require: 'teaching-context',
      },
    ],
  },
  excel: {
    id: 'excel',
    title: 'Guía: Importar Excel',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'excel-ir',
        view: 'registro',
        title: 'Ir a Alumnos',
        body: 'Acá se importa el listado. Revisá la estructura de referencia si hace falta.',
        bodyShort: 'Acá importás el listado.',
        target: '[data-spa-view="registro"] .excel-workspace, [data-spa-view="registro"] .page-header',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'excel-subir',
        view: 'registro',
        title: 'Subir archivo',
        body: 'Tocá la zona de carga o elegí un archivo Excel.',
        bodyShort: 'Tocá para subir el Excel.',
        target: '[data-spa-view="registro"] [data-excel-dropzone], [data-spa-view="registro"] [data-excel-file]',
        require: 'click',
        requireClick:
          '[data-spa-view="registro"] [data-excel-dropzone], [data-spa-view="registro"] [data-excel-file], [data-spa-view="registro"] [data-excel-workspace-form] input[type="file"]',
      },
      {
        id: 'excel-referencia',
        view: 'registro',
        title: 'Referencia',
        body: 'Abrí “Ver estructura de referencia” para ver columnas obligatorias.',
        bodyShort: 'Abrí la estructura de referencia.',
        target: '[data-spa-view="registro"] .excel-reference, [data-spa-view="registro"] .excel-workspace',
        require: 'click',
        requireClick: '[data-spa-view="registro"] .excel-reference summary, [data-spa-view="registro"] .excel-reference',
      },
    ],
  },
  asistencia: {
    id: 'asistencia',
    title: 'Guía: Pasar lista',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'asis-contexto',
        view: 'asistencia',
        title: 'Curso arriba',
        body: 'La lista usa el Curso actual. Si falta, cambialo arriba.',
        bodyShort: 'Revisá el Curso actual arriba.',
        target: '[data-global-teaching-context], [data-attendance-take-view]',
        softChrome: true,
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'asis-marcar',
        view: 'asistencia',
        title: 'Marcar alumnos',
        body: 'Tocá Presente o Ausente. Si no hay alumnos, importá con Excel antes.',
        bodyShort: 'Tocá Presente o Ausente.',
        target: '[data-spa-view="asistencia"] [data-attendance-list], [data-spa-view="asistencia"] [data-attendance-take-view]',
        require: 'click',
        requireClick:
          '[data-spa-view="asistencia"] [data-attendance-list] button, [data-spa-view="asistencia"] [data-attendance-take-view] button, [data-spa-view="asistencia"] [data-attendance-take-view]',
      },
      {
        id: 'asis-guardar',
        view: 'asistencia',
        title: 'Guardar',
        body: 'Cuando haya cambios, Guardar aparece abajo. Tocá la barra de guardar para practicar.',
        bodyShort: 'Tocá la barra Guardar abajo.',
        target: '[data-spa-view="asistencia"] [data-attendance-save-bar]',
        require: 'click',
        requireClick: '[data-spa-view="asistencia"] [data-attendance-save-bar]',
      },
    ],
  },
  notas: {
    id: 'notas',
    title: 'Guía: Cargar notas',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'notas-contexto',
        view: 'notas',
        title: 'Mismo curso',
        body: 'Las notas siguen el Curso actual del encabezado.',
        bodyShort: 'Usan el Curso actual.',
        target: '[data-global-teaching-context], [data-grades-take-view]',
        softChrome: true,
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'notas-cargar',
        view: 'notas',
        title: 'Cargar',
        body: 'Tocá un campo de calificación o el listado de alumnos.',
        bodyShort: 'Tocá un campo o el listado.',
        target: '[data-spa-view="notas"] [data-grade-bulk-list], [data-spa-view="notas"] [data-grades-take-view]',
        require: 'click',
        requireClick:
          '[data-spa-view="notas"] [data-grade-bulk-list] input, [data-spa-view="notas"] [data-grade-bulk-list], [data-spa-view="notas"] [data-grades-take-view]',
      },
      {
        id: 'notas-guardar',
        view: 'notas',
        title: 'Guardar',
        body: 'Cuando haya cambios, Guardar calificaciones aparece abajo. Tocá esa barra.',
        bodyShort: 'Tocá la barra Guardar abajo.',
        target: '[data-spa-view="notas"] [data-grades-save-bar]',
        require: 'click',
        requireClick: '[data-spa-view="notas"] [data-grades-save-bar]',
      },
    ],
  },
  cursos: {
    id: 'cursos',
    title: 'Guía: Crear cursos',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'cursos-ir',
        view: 'cursos',
        title: 'Sección Cursos',
        body: 'Acá creás escuelas, divisiones y cargás cursos desde Excel.',
        bodyShort: 'Acá creás cursos y escuelas.',
        target: '[data-spa-view="cursos"] .page-header, [data-spa-view="cursos"] [data-course-form]',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'cursos-escuela',
        view: 'cursos',
        title: 'Añadir escuela',
        body: 'Escribí el nombre y tocá “Añadir escuela”, o tocá el campo para practicar.',
        bodyShort: 'Tocá el campo o “Añadir escuela”.',
        target: '[data-spa-view="cursos"] [data-new-school], [data-spa-view="cursos"] [data-add-school]',
        require: 'click',
        requireClick:
          '[data-spa-view="cursos"] [data-new-school], [data-spa-view="cursos"] [data-add-school]',
      },
      {
        id: 'cursos-form',
        view: 'cursos',
        title: 'Nuevo curso',
        body: 'Completá escuela, nombre y turno. Tocá el formulario o “Crear curso”.',
        bodyShort: 'Tocá el formulario de nuevo curso.',
        target: '[data-spa-view="cursos"] [data-course-form]',
        require: 'click',
        requireClick: '[data-spa-view="cursos"] [data-course-form]',
      },
      {
        id: 'cursos-lista',
        view: 'cursos',
        title: 'Cursos activos',
        body: 'Los cursos creados aparecen en esta sección. Tocá el panel para ubicarlo.',
        bodyShort: 'Tocá el panel de cursos activos.',
        target: '[data-spa-view="cursos"] [data-course-list]',
        preferTarget: '[data-spa-view="cursos"] .responsive-grid > .panel',
        require: 'click',
        requireClick:
          '[data-spa-view="cursos"] [data-course-list], [data-spa-view="cursos"] .responsive-grid > .panel',
      },
    ],
  },
  actividades: {
    id: 'actividades',
    title: 'Guía: Actividades',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'act-ir',
        view: 'actividades',
        title: 'Flujo de actividades',
        body: 'Crear → clase virtual → entregas → corregir. Empezá en Crear.',
        bodyShort: 'Crear, clase, entregas y corregir.',
        target: '[data-spa-view="actividades"] [data-activity-flow-tabs], [data-spa-view="actividades"] .page-header',
        openActivityTab: 'contenido',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'act-crear',
        view: 'actividades',
        title: 'Crear actividad',
        body: 'Tocá el formulario o el título para practicar la carga de una actividad.',
        bodyShort: 'Tocá el formulario de crear.',
        target: '[data-spa-view="actividades"] [data-activity-form], [data-spa-view="actividades"] [data-activity-workspace]',
        openActivityTab: 'contenido',
        require: 'click',
        requireClick:
          '[data-spa-view="actividades"] [data-activity-form], [data-spa-view="actividades"] [data-activity-workspace]',
      },
      {
        id: 'act-clase',
        view: 'actividades',
        title: 'Clase virtual',
        body: 'Tocá la pestaña “Clase virtual” para armar un link de clase.',
        bodyShort: 'Tocá “Clase virtual”.',
        target: '[data-spa-view="actividades"] [data-activity-flow-tab="clase"]',
        openActivityTab: 'contenido',
        require: 'click',
        requireClick: '[data-spa-view="actividades"] [data-activity-flow-tab="clase"]',
      },
      {
        id: 'act-entregas',
        view: 'actividades',
        title: 'Entregas y corregir',
        body: 'Tocá “Recibir entregas” o “Corregir” para ver esas etapas.',
        bodyShort: 'Tocá Entregas o Corregir.',
        target: '[data-spa-view="actividades"] [data-activity-flow-tabs]',
        openActivityTab: 'clase',
        require: 'click',
        requireClick:
          '[data-spa-view="actividades"] [data-activity-flow-tab="entregas"], [data-spa-view="actividades"] [data-activity-flow-tab="corregir"]',
      },
    ],
  },
  herramientas: {
    id: 'herramientas',
    title: 'Guía: Cuenta e instalar',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'herr-ir',
        view: 'herramientas',
        title: 'Excel y cuenta',
        body: 'Acá están las importaciones avanzadas, la sincronización y la instalación de la app.',
        bodyShort: 'Excel avanzado, sync e instalar.',
        target: '[data-spa-view="herramientas"] .page-header, [data-spa-view="herramientas"] [data-tools-hub-tabs]',
        openToolsHub: 'excel',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'herr-cuenta',
        view: 'herramientas',
        title: 'Cuenta / instalar',
        body: 'Tocá la pestaña “Cuenta / instalar”.',
        bodyShort: 'Tocá “Cuenta / instalar”.',
        target: '[data-spa-view="herramientas"] [data-tools-hub-tab="cuenta"]',
        openToolsHub: 'excel',
        require: 'click',
        requireClick: '[data-spa-view="herramientas"] [data-tools-hub-tab="cuenta"]',
      },
      {
        id: 'herr-sync',
        view: 'herramientas',
        title: 'Sincronizar',
        body: 'Tocá “Sincronizar ahora” si ves cambios pendientes.',
        bodyShort: 'Tocá “Sincronizar ahora”.',
        target: '[data-spa-view="herramientas"] [data-sync-button], [data-spa-view="herramientas"] [data-sync-tools]',
        openToolsHub: 'cuenta',
        require: 'click',
        requireClick: '[data-spa-view="herramientas"] [data-sync-button]',
      },
      {
        id: 'herr-install',
        view: 'herramientas',
        title: 'Instalar app',
        body: 'Tocá Instalar o abrí “Cómo instalar según el dispositivo”.',
        bodyShort: 'Tocá Instalar o la ayuda.',
        target: '[data-spa-view="herramientas"] [data-pwa-install], [data-spa-view="herramientas"] [data-tools-section="install"]',
        openToolsHub: 'cuenta',
        require: 'click',
        requireClick:
          '[data-spa-view="herramientas"] [data-tools-section="install"] [data-pwa-install-btn], [data-spa-view="herramientas"] [data-pwa-install-help]',
      },
    ],
  },
  panel: {
    id: 'panel',
    title: 'Guía: Panel y resumen',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'panel-hoy',
        view: 'panel',
        title: 'Hoy',
        body: 'El Panel resume el día. Desde acá saltás a Asistencia, Actividades o Excel.',
        bodyShort: 'Atajos del día en el Panel.',
        target: '[data-spa-view="panel"] [data-panel-hero]',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'panel-resumen',
        view: 'panel',
        title: 'Resumen',
        body: 'Tocá una tarjeta del Resumen para abrir esa sección.',
        bodyShort: 'Tocá una tarjeta del Resumen.',
        target: '[data-spa-view="panel"] [data-dashboard], [data-spa-view="panel"] [data-panel-summary]',
        require: 'click',
        requireClick:
          '[data-spa-view="panel"] [data-dashboard] .metric--link, [data-spa-view="panel"] [data-dashboard] [data-spa-nav], [data-spa-view="panel"] [data-dashboard]',
      },
      {
        id: 'panel-seguimiento',
        view: 'panel',
        title: 'Seguimiento',
        body: 'Abajo está el seguimiento del curso. Tocá ese panel para ubicarlo.',
        bodyShort: 'Tocá Seguimiento.',
        target: '[data-spa-view="panel"] [data-seguimiento]',
        require: 'click',
        requireClick: '[data-spa-view="panel"] [data-seguimiento]',
      },
    ],
  },
};

function getTourStatus(userId) {
  if (!userId) return '';
  return localStorage.getItem(productTourKey(userId)) || '';
}

function setTourStatus(userId, value) {
  if (!userId) return;
  localStorage.setItem(productTourKey(userId), value);
}

function readGuides(userId) {
  if (!userId) return {};
  try {
    return JSON.parse(localStorage.getItem(productGuidesKey(userId)) || '{}') || {};
  } catch {
    return {};
  }
}

function markGuideDone(userId, guideId) {
  if (!userId || !guideId) return;
  const current = readGuides(userId);
  current[guideId] = 'done';
  localStorage.setItem(productGuidesKey(userId), JSON.stringify(current));
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

function gtcFormIsOpen() {
  return isVisible(document.querySelector('[data-gtc-form]'));
}

/**
 * Elige el ancla del spotlight.
 * Si el form de Curso actual ya está abierto (o el paso lo abre), priorizar el form
 * para no dejar el recuadro en la posición vieja del botón “Cambiar”.
 */
function resolveStepTarget(step) {
  if (!step) return null;
  const preferForm = Boolean(step.openGtc) || gtcFormIsOpen();
  if (preferForm) {
    return pickTarget(step.target) || pickTarget(step.preferTarget);
  }
  return pickTarget(step.preferTarget) || pickTarget(step.target);
}

function openGtcForTour() {
  const root = document.querySelector('[data-global-teaching-context]');
  const form = root?.querySelector('[data-gtc-form]');
  if (!(form instanceof HTMLElement) || !(root instanceof HTMLElement)) return;

  // Marcar antes de abrir: refreshGlobalTeachingContextUi respeta gtc--tour-open
  // y no vuelve a ocultar el form (si no, el spotlight queda flotando sobre el menú).
  root.classList.add('gtc--tour-open');

  // Abrir por el mismo camino que “Elegir ahora” (no togglear Cambiar: cerraría el form).
  const openTrigger = document.querySelector('[data-gtc-open]');
  if (openTrigger instanceof HTMLElement) {
    openTrigger.click();
  } else {
    form.classList.remove('is-hidden');
    form.hidden = false;
  }

  root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeGtcTourState() {
  const root = document.querySelector('[data-global-teaching-context]');
  if (!(root instanceof HTMLElement)) return;
  root.classList.remove('gtc--tour-open');
}

function teachingContextReady(detail) {
  if (detail?.cursoId && detail?.materiaId) return true;
  const summary = document.querySelector('[data-gtc-summary]')?.textContent || '';
  return Boolean(summary && !/elegí curso/i.test(summary));
}

/**
 * @param {{ getUserId: () => string | null }} options
 */
export function initProductTour({ getUserId }) {
  const overlay = ensureTourOverlay();
  const progress = ensureTourProgress();
  let activeTour = null;
  let stepIndex = 0;
  let running = false;
  let stepCompleted = false;
  let actionCleanup = null;
  let layoutCleanup = null;
  let spotlightSyncTimer = 0;

  const refreshHelpMenu = () => {
    const basicDone = Boolean(getTourStatus(getUserId()));
    document.querySelectorAll('[data-tour-guides]').forEach((block) => {
      block.hidden = !basicDone;
      block.classList.toggle('is-hidden', !basicDone);
    });
    const guides = readGuides(getUserId());
    document.querySelectorAll('[data-tour-start]').forEach((btn) => {
      const id = btn.getAttribute('data-tour-start');
      if (!id || id === 'basico') return;
      btn.classList.toggle('is-guide-done', guides[id] === 'done');
    });
  };

  const stopActionWatch = () => {
    actionCleanup?.();
    actionCleanup = null;
  };

  const stopLayoutWatch = () => {
    window.clearTimeout(spotlightSyncTimer);
    layoutCleanup?.();
    layoutCleanup = null;
  };

  const cheer = () => {
    progress.showCheer('¡Bien!');
  };

  const isMenuStep = (step) => Boolean(step?.openMenuOnMobile && isMobileViewport());

  const applySpotlight = (step, { scroll = false } = {}) => {
    if (!step) return;
    // Si el paso necesita el form y se cerró, reabrirlo antes de medir.
    if (step.openGtc && !gtcFormIsOpen()) {
      openGtcForTour();
    }
    const menuStep = isMenuStep(step);
    const target = resolveStepTarget(step);
    if (target && !menuStep) {
      if (scroll) {
        const inStickyChrome = Boolean(target.closest('.app-shell'));
        target.scrollIntoView({
          behavior: 'smooth',
          block: inStickyChrome ? 'nearest' : 'center',
          inline: 'nearest',
        });
      }
      overlay.setSpotlight(target);
      return;
    }
    if (target && menuStep) {
      overlay.clearSpotlight();
      overlay.rememberTarget(target);
      return;
    }
    overlay.clearSpotlight();
  };

  /** Reposiciona el spotlight tras abrir “Cambiar” / cambios de layout del sidebar. */
  const syncSpotlight = ({ scroll = false } = {}) => {
    if (!running || !activeTour) return;
    const step = activeTour.steps[stepIndex];
    if (!step) return;
    applySpotlight(step, { scroll });
  };

  const scheduleSpotlightSync = ({ scroll = false, delay = 0 } = {}) => {
    window.clearTimeout(spotlightSyncTimer);
    spotlightSyncTimer = window.setTimeout(() => {
      void (async () => {
        await waitForPaint();
        await wait(40);
        syncSpotlight({ scroll });
        // Segunda pasada: el flex del sidebar a veces termina de acomodarse después.
        await wait(160);
        await waitForPaint();
        syncSpotlight({ scroll: false });
      })();
    }, delay);
  };

  const watchLayoutForSpotlight = (step) => {
    stopLayoutWatch();
    if (!step || isMenuStep(step)) return;

    const cleanups = [];
    const onLayout = () => scheduleSpotlightSync({ delay: 16 });

    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    cleanups.push(() => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    });

    const shell = document.querySelector('.app-shell');
    const gtc = document.querySelector('[data-global-teaching-context]');
    const form = gtc?.querySelector('[data-gtc-form]');
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(onLayout);
      if (shell) ro.observe(shell);
      if (gtc) ro.observe(gtc);
      if (form) ro.observe(form);
      cleanups.push(() => ro.disconnect());
    }

    if (typeof MutationObserver !== 'undefined' && form) {
      const mo = new MutationObserver(onLayout);
      mo.observe(form, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
      cleanups.push(() => mo.disconnect());
    }

    // Al tocar Cambiar/Elegir, el form abre y el sidebar reflowea: el spotlight fijo
    // quedaba “congelado” a media altura (sobre Avanzado / Excel).
    const onGtcInteract = (event) => {
      const hit = event.target?.closest?.('[data-gtc-toggle], [data-gtc-open], [data-gtc-form]');
      if (!hit) return;
      scheduleSpotlightSync({ delay: 30 });
    };
    document.addEventListener('click', onGtcInteract, true);
    cleanups.push(() => document.removeEventListener('click', onGtcInteract, true));

    layoutCleanup = () => {
      cleanups.forEach((fn) => fn());
    };
  };

  const finishTour = (status) => {
    running = false;
    stopActionWatch();
    stopLayoutWatch();
    const tourId = activeTour?.id || 'basico';
    if (tourId === 'basico') setTourStatus(getUserId(), status);
    else if (status === 'done') markGuideDone(getUserId(), tourId);

    overlay.clearSpotlight();
    overlay.close();
    progress.hide();
    closeMenu();
    closeGtcTourState();
    showSpaView('panel');
    document.querySelector('[data-help-menu]')?.removeAttribute('open');
    document.body.classList.remove(
      'product-tour-active',
      'product-tour-menu-step',
      'product-tour-soft-chrome',
    );
    activeTour = null;
    refreshHelpMenu();
    window.dispatchEvent(new CustomEvent('aula-clara:local-data-changed'));
  };

  const completeStepAction = () => {
    if (!running || stepCompleted) return;
    stepCompleted = true;
    cheer();
    progress.setProgress(stepIndex + 1, activeTour.steps.length);
    overlay.setNextEnabled(true);
    const nextBtn = document.querySelector('[data-tour-next]');
    if (nextBtn instanceof HTMLButtonElement) {
      nextBtn.textContent = stepIndex >= activeTour.steps.length - 1 ? 'Listo' : 'Siguiente';
    }
    // Tras completar (ej. Cambiar), el layout puede haber movido el ancla.
    scheduleSpotlightSync({ delay: 30 });
  };

  const watchStepAction = (step) => {
    stopActionWatch();
    stepCompleted = false;

    if (!step.require || step.require === 'next') {
      stepCompleted = true;
      overlay.setNextEnabled(true);
      return;
    }

    overlay.setNextEnabled(false);

    if (step.require === 'teaching-context') {
      const onContext = (event) => {
        if (teachingContextReady(event.detail)) completeStepAction();
      };
      window.addEventListener('aula-clara:teaching-context-changed', onContext);
      // Si ya está listo, pedimos confirmación igual (submit); no auto-completar.
      actionCleanup = () => window.removeEventListener('aula-clara:teaching-context-changed', onContext);
      return;
    }

    if (step.require === 'click') {
      const selector = step.requireClick || step.target;
      const onClick = (event) => {
        const hit = event.target?.closest?.(selector);
        if (!hit) return;
        completeStepAction();
      };
      const onChange = (event) => {
        const hit = event.target?.closest?.(selector);
        if (!hit) return;
        completeStepAction();
      };
      document.addEventListener('click', onClick, true);
      document.addEventListener('change', onChange, true);
      actionCleanup = () => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('change', onChange, true);
      };
    }
  };

  const showStep = async (index) => {
    if (!activeTour) return;
    stepIndex = index;
    const step = activeTour.steps[index];
    if (!step) {
      finishTour('done');
      return;
    }

    running = true;
    stopLayoutWatch();
    document.body.classList.add('product-tour-active');
    closeMenu();
    closeGtcTourState();
    showSpaView(step.view);
    await waitForPaint();

    const menuStep = isMenuStep(step);
    const softChrome = Boolean(step.softChrome);
    document.body.classList.toggle('product-tour-menu-step', menuStep);
    document.body.classList.toggle('product-tour-soft-chrome', softChrome && !menuStep);
    overlay.setMenuMode(menuStep);
    overlay.setSoftChrome(softChrome && !menuStep);

    progress.show({
      label: activeTour.title,
      current: index,
      total: activeTour.steps.length,
    });

    if (step.openGtc) {
      openGtcForTour();
      await waitForPaint();
      await wait(40);
    }

    if (step.openToolsHub) {
      navigateToToolsSection(step.openToolsHub === 'cuenta' ? 'cuenta' : 'excel');
      await waitForPaint();
      await wait(40);
    }

    if (step.openActivityTab) {
      window.dispatchEvent(
        new CustomEvent('aula-clara:open-activity-flow', {
          detail: { tab: step.openActivityTab },
        }),
      );
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

    const target = resolveStepTarget(step);
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

    watchLayoutForSpotlight(step);
    watchStepAction(step);
    // Por si el scroll/smooth o el flex del shell terminan después del primer paint.
    scheduleSpotlightSync({ delay: 180 });

    const needsAction = step.require && step.require !== 'next';
    overlay.open({
      title: step.title,
      body: needsAction
        ? `${stepBody(step)} Completá la acción para avanzar.`
        : stepBody(step),
      stepLabel: `${index + 1}/${activeTour.steps.length}`,
      onNext: () => {
        if (!stepCompleted) {
          overlay.nudge('Completá el paso marcado para seguir.');
          return;
        }
        void showStep(index + 1);
      },
      onSkip: () => finishTour('skipped'),
      isLast: index === activeTour.steps.length - 1,
      nextLabel: step.nextLabel || (index === 0 ? 'Empezar' : 'Siguiente'),
      nextEnabled: stepCompleted,
    });
  };

  const startTourById = (tourId = 'basico') => {
    if (running) return;
    const tour = tourId === 'basico' ? BASIC_TOUR : TOPIC_GUIDES[tourId];
    if (!tour) return;
    if (tour.unlockAfterBasic && !getTourStatus(getUserId())) {
      window.alert('Primero completá o salí del tutorial inicial. Después se desbloquean las guías.');
      return;
    }
    activeTour = tour;
    document.querySelector('[data-help-menu]')?.removeAttribute('open');
    closeMenu();
    void showStep(0);
  };

  document.querySelectorAll('[data-product-tour-start], [data-setup-tutorial-start], [data-tour-start]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      if (btn.hasAttribute('data-setup-tutorial-start')) return;
      event.preventDefault();
      const id = btn.getAttribute('data-tour-start') || 'basico';
      startTourById(id);
    });
  });

  window.addEventListener('aula-clara:local-data-changed', refreshHelpMenu);
  refreshHelpMenu();

  return {
    startTour: () => startTourById('basico'),
    startTourById,
    refreshHelpMenu,
  };
}

function ensureTourProgress() {
  let root = document.querySelector('[data-tour-progress]');
  if (!root) {
    root = document.createElement('div');
    root.className = 'tour-progress is-hidden';
    root.setAttribute('data-tour-progress', '');
    root.setAttribute('hidden', '');
    root.innerHTML = `
      <div class="tour-progress-inner">
        <div class="tour-progress-meta">
          <span class="tour-progress-label" data-tour-progress-label>Tutorial</span>
          <span class="tour-progress-count" data-tour-progress-count>0/0</span>
          <span class="tour-progress-cheer is-hidden" data-tour-progress-cheer hidden>¡Bien!</span>
        </div>
        <div class="tour-progress-track" aria-hidden="true">
          <div class="tour-progress-fill" data-tour-progress-fill></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
  }

  const labelEl = root.querySelector('[data-tour-progress-label]');
  const countEl = root.querySelector('[data-tour-progress-count]');
  const fillEl = root.querySelector('[data-tour-progress-fill]');
  const cheerEl = root.querySelector('[data-tour-progress-cheer]');
  let cheerTimer = null;

  return {
    show({ label, current, total }) {
      if (labelEl) labelEl.textContent = label || 'Tutorial';
      if (countEl) countEl.textContent = `${Math.min(current + 1, total)}/${total}`;
      if (fillEl) fillEl.style.width = `${Math.round((current / Math.max(total, 1)) * 100)}%`;
      root.classList.remove('is-hidden');
      root.removeAttribute('hidden');
    },
    setProgress(completedSteps, total) {
      const safeTotal = Math.max(total, 1);
      const pct = Math.round((completedSteps / safeTotal) * 100);
      if (countEl) countEl.textContent = `${Math.min(completedSteps, total)}/${total}`;
      if (fillEl) fillEl.style.width = `${pct}%`;
    },
    showCheer(text = '¡Bien!') {
      if (!(cheerEl instanceof HTMLElement)) return;
      cheerEl.textContent = text;
      cheerEl.classList.remove('is-hidden');
      cheerEl.removeAttribute('hidden');
      cheerEl.classList.remove('is-pop');
      // reflow for animation restart
      void cheerEl.offsetWidth;
      cheerEl.classList.add('is-pop');
      window.clearTimeout(cheerTimer);
      cheerTimer = window.setTimeout(() => {
        cheerEl.classList.add('is-hidden');
        cheerEl.setAttribute('hidden', '');
        cheerEl.classList.remove('is-pop');
      }, 1600);
    },
    hide() {
      window.clearTimeout(cheerTimer);
      root.classList.add('is-hidden');
      root.setAttribute('hidden', '');
      if (cheerEl) {
        cheerEl.classList.add('is-hidden');
        cheerEl.setAttribute('hidden', '');
      }
      if (fillEl) fillEl.style.width = '0%';
    },
  };
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
        <p class="product-tour-nudge is-hidden" data-tour-nudge hidden></p>
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
  const nudgeEl = root.querySelector('[data-tour-nudge]');
  const nextBtn = root.querySelector('[data-tour-next]');
  const skipBtn = root.querySelector('[data-tour-skip]');
  const spotlight = root.querySelector('[data-tour-spotlight]');
  const backdrop = root.querySelector('[data-tour-backdrop]');
  let onNext = null;
  let onSkip = null;
  let spotlightTarget = null;
  let nudgeTimer = null;

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
    if (!(target instanceof HTMLElement) || !(spotlight instanceof HTMLElement)) {
      clearSpotlight();
      return;
    }

    // Reusar el mismo target evita parpadeo al reposicionar tras abrir “Cambiar”.
    if (spotlightTarget !== target) {
      spotlightTarget?.classList.remove('tour-target-active');
      spotlightTarget = target;
      spotlightTarget.classList.add('tour-target-active');
    }

    const pad = 10;
    const rect = target.getBoundingClientRect();
    // Si el ancla quedó sin tamaño real (p. ej. mid-reflow), ocultar en vez de
    // dejar un cuadrado mínimo “flotando” a media altura del menú.
    if (rect.width < 2 || rect.height < 2) {
      spotlight.classList.add('is-hidden');
      spotlight.setAttribute('hidden', '');
      return;
    }

    const top = Math.max(6, rect.top - pad);
    const left = Math.max(6, rect.left - pad);
    const width = Math.min(window.innerWidth - left - 6, rect.width + pad * 2);
    const height = Math.min(window.innerHeight - top - 6, rect.height + pad * 2);

    spotlight.style.top = `${top}px`;
    spotlight.style.left = `${left}px`;
    spotlight.style.width = `${width}px`;
    spotlight.style.height = `${height}px`;
    spotlight.classList.remove('is-hidden');
    spotlight.removeAttribute('hidden');
  };

  const setMenuMode = (enabled) => {
    root.classList.toggle('product-tour-overlay--menu', enabled);
  };

  const setSoftChrome = (enabled) => {
    root.classList.toggle('product-tour-overlay--soft-chrome', enabled);
  };

  const setNextEnabled = (enabled) => {
    if (!(nextBtn instanceof HTMLButtonElement)) return;
    nextBtn.disabled = !enabled;
    nextBtn.classList.toggle('is-waiting', !enabled);
  };

  const nudge = (message) => {
    if (!(nudgeEl instanceof HTMLElement)) return;
    nudgeEl.textContent = message;
    nudgeEl.classList.remove('is-hidden');
    nudgeEl.removeAttribute('hidden');
    window.clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(() => {
      nudgeEl.classList.add('is-hidden');
      nudgeEl.setAttribute('hidden', '');
    }, 2200);
  };

  nextBtn?.addEventListener('click', () => onNext?.());
  skipBtn?.addEventListener('click', () => onSkip?.());
  backdrop?.addEventListener('click', (event) => {
    if (root.classList.contains('product-tour-overlay--menu')) return;
    event.preventDefault();
  });

  return {
    open({ title, body, stepLabel, onNext: next, onSkip: skip, isLast, nextLabel, nextEnabled = true }) {
      onNext = next;
      onSkip = skip;
      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.textContent = body;
      if (stepEl) stepEl.textContent = stepLabel;
      if (nextBtn) nextBtn.textContent = isLast ? (nextLabel || 'Listo') : (nextLabel || 'Siguiente');
      setNextEnabled(nextEnabled);
      if (nudgeEl) {
        nudgeEl.classList.add('is-hidden');
        nudgeEl.setAttribute('hidden', '');
      }
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
    setNextEnabled,
    nudge,
  };
}

export { BASIC_TOUR, TOPIC_GUIDES };
