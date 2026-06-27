import { closeMenu } from './ui-nav.js';
import {
  PATH_TO_VIEW,
  SPA_VIEWS,
  VIEW_TO_PATH,
  resolveInitialView,
  type SpaViewId,
} from './spa-config.ts';

export { PATH_TO_VIEW, SPA_VIEWS, VIEW_TO_PATH, resolveInitialView, type SpaViewId };

const refreshHandlers = new Map<SpaViewId, () => void>();
let activeView: SpaViewId = 'panel';

export function registerSpaViewRefresh(view: SpaViewId, handler: () => void) {
  refreshHandlers.set(view, handler);
}

export function getActiveSpaView() {
  return activeView;
}

function updateDocumentTitle(view: SpaViewId) {
  const section = document.querySelector(`[data-spa-view="${view}"]`);
  const viewTitle = section?.getAttribute('data-spa-title') || 'Aula Clara';
  document.title = `${viewTitle} | Aula Clara`;
}

function updateNavState(view: SpaViewId) {
  document.querySelectorAll('[data-spa-nav]').forEach((control) => {
    const target = control.getAttribute('data-spa-nav') as SpaViewId;
    const isActive = target === view;
    control.classList.toggle('active', isActive);
    if (isActive) control.setAttribute('aria-current', 'page');
    else control.removeAttribute('aria-current');
  });
}

export function showSpaView(view: SpaViewId, options: { replace?: boolean; skipHistory?: boolean } = {}) {
  if (!SPA_VIEWS.includes(view)) view = 'panel';

  document.querySelectorAll('[data-spa-view]').forEach((section) => {
    const isTarget = section.getAttribute('data-spa-view') === view;
    section.classList.toggle('spa-view--hidden', !isTarget);
    if (isTarget) section.removeAttribute('hidden');
    else section.setAttribute('hidden', '');
  });

  activeView = view;
  updateNavState(view);
  updateDocumentTitle(view);

  const path = VIEW_TO_PATH[view];
  if (!options.skipHistory) {
    const state = { spaView: view };
    if (options.replace) history.replaceState(state, '', path);
    else history.pushState(state, '', path);
  }

  refreshHandlers.get(view)?.();
  document.dispatchEvent(new CustomEvent('aula-clara:spa-view', { detail: { view } }));
  closeMenu();
}

export function initSpaRouter(initialView: SpaViewId) {
  const root = document.querySelector('[data-spa-root]');
  if (!root) return;

  document.addEventListener('click', (event) => {
    const trigger = (event.target as Element | null)?.closest('[data-spa-nav]');
    if (!trigger) return;

    const view = trigger.getAttribute('data-spa-nav') as SpaViewId;
    if (!view || !SPA_VIEWS.includes(view)) return;

    event.preventDefault();
    if (view === activeView) {
      refreshHandlers.get(view)?.();
      return;
    }
    showSpaView(view);
  });

  window.addEventListener('popstate', () => {
    const view = resolveInitialView(window.location.pathname, window.location.search);
    showSpaView(view, { skipHistory: true });
  });

  showSpaView(initialView, { replace: true, skipHistory: true });
  history.replaceState({ spaView: initialView }, '', VIEW_TO_PATH[initialView]);
}
