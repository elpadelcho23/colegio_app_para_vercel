import { registerSpaViewRefresh, showSpaView } from './spa-router.ts';
import { initExcelImportWorkspaces } from './excel-import-ui.js';
import { initInformesComunicados, syncInformesComunicadosFromContext } from './informes-comunicados-ui.js';
import { showAppToast } from './app-feedback.js';

const HUB_TABS = new Set(['importar', 'cuenta', 'informes']);
const IMPORT_TYPES = new Set(['alumnos', 'asistencias', 'notas']);

function normalizeHubTab(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'excel' || raw === 'import' || raw === 'importar-datos') return 'importar';
  if (HUB_TABS.has(raw)) return raw;
  return 'importar';
}

function normalizeImportType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (IMPORT_TYPES.has(raw)) return raw;
  return '';
}

function buildToolsSearch(hubTab, importType = '') {
  const params = new URLSearchParams();
  params.set('tab', normalizeHubTab(hubTab));
  const tipo = normalizeImportType(importType);
  if (params.get('tab') === 'importar' && tipo) params.set('tipo', tipo);
  return params.toString();
}

function syncToolsUrl(hubTab, importType = '', { replace = true } = {}) {
  const search = buildToolsSearch(hubTab, importType);
  const url = `/herramientas?${search}`;
  const state = { spaView: 'herramientas' };
  if (replace) history.replaceState(state, '', url);
  else history.pushState(state, '', url);
}

export function initToolsView({ onImported, getCicloLectivo, informes } = {}) {
  const root = document.querySelector('[data-herramientas]');
  if (!root) return;

  initToolsHubTabs(root);
  initToolsTabs(root);
  initSimpleExcelImport(root, onImported);
  initExcelImportWorkspaces({
    onImported: (importType, result) => onImported?.(importType, result),
    getCicloLectivo,
  });
  if (informes) initInformesComunicados(informes);

  applyToolsQueryFromLocation(root);

  registerSpaViewRefresh('herramientas', () => {
    applyToolsQueryFromLocation(root);
  });
}

export function applyToolsQueryFromLocation(root = document.querySelector('[data-herramientas]')) {
  if (!root) return;
  const params = new URLSearchParams(window.location.search);
  const hub = normalizeHubTab(params.get('tab') || 'importar');
  const tipo = normalizeImportType(params.get('tipo') || '') || 'alumnos';
  activateToolsHubTab(root, hub, { syncUrl: false });
  if (hub === 'importar') activateToolsTab(root, tipo, { syncUrl: false });
  // Normaliza la URL visible (tab=importar por defecto).
  syncToolsUrl(hub, hub === 'importar' ? tipo : '');
}

export function scrollToToolsSection(section) {
  const target = document.querySelector(`[data-tools-section="${section}"]`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * @param {string} section - importar|excel|cuenta|sync|install|plan|kit|informes|...
 * @param {string} [tab] - alumnos|asistencias|notas
 */
export function navigateToToolsSection(section, tab) {
  if (section === 'ai' || section === 'entregas' || section === 'corregir' || section === 'contenido') {
    showSpaView('actividades');
    window.dispatchEvent(new CustomEvent('aula-clara:open-activity-flow', {
      detail: { tab: section === 'ai' ? 'contenido' : section },
    }));
    return;
  }

  const hub = sectionToHub(section);
  const tipo = normalizeImportType(tab) || (hub === 'importar' ? 'alumnos' : '');
  const search = buildToolsSearch(hub, tipo);
  showSpaView('herramientas', { search });

  const root = document.querySelector('[data-herramientas]');
  activateToolsHubTab(root, hub, { syncUrl: false });
  if (hub === 'importar') activateToolsTab(root, tipo || 'alumnos', { syncUrl: false });
  window.requestAnimationFrame(() => scrollToToolsSection(section === 'excel' ? 'excel' : section));
}

function sectionToHub(section) {
  const value = String(section || '').toLowerCase();
  if (value === 'sync' || value === 'plan' || value === 'kit' || value === 'cuenta' || value === 'install') {
    return 'cuenta';
  }
  if (value === 'informes' || value === 'comunicados') return 'informes';
  return 'importar';
}

function initToolsHubTabs(root) {
  root.querySelectorAll('[data-tools-hub-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      activateToolsHubTab(root, tab.getAttribute('data-tools-hub-tab') || 'importar');
    });
  });
}

function activateToolsHubTab(root, tabId, { syncUrl = true } = {}) {
  if (!root) return;
  const hub = normalizeHubTab(tabId);
  root.querySelectorAll('[data-tools-hub-tab]').forEach((tab) => {
    const active = tab.getAttribute('data-tools-hub-tab') === hub;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  root.querySelectorAll('[data-tools-hub-panel]').forEach((panel) => {
    const active = panel.getAttribute('data-tools-hub-panel') === hub;
    panel.classList.toggle('is-hidden', !active);
    panel.hidden = !active;
  });
  if (hub === 'informes') {
    syncInformesComunicadosFromContext();
  }
  if (syncUrl) {
    const tipo = hub === 'importar'
      ? (root.querySelector('.tools-tab.is-active')?.getAttribute('data-tools-tab') || 'alumnos')
      : '';
    syncToolsUrl(hub, tipo);
  }
}

function initToolsTabs(root) {
  const tabs = root.querySelectorAll('[data-tools-tab]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.getAttribute('data-tools-tab');
      if (id) activateToolsTab(root, id);
    });
  });
}

function activateToolsTab(root, tabId, { syncUrl = true } = {}) {
  if (!root) return;
  const tipo = normalizeImportType(tabId) || 'alumnos';
  root.querySelectorAll('[data-tools-tab]').forEach((tab) => {
    const active = tab.getAttribute('data-tools-tab') === tipo;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  root.querySelectorAll('[data-tools-panel]').forEach((panel) => {
    const active = panel.getAttribute('data-tools-panel') === tipo;
    panel.classList.toggle('is-hidden', !active);
    if (active) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
  });

  if (syncUrl) syncToolsUrl('importar', tipo);
}

export function initSimpleExcelImport(root, onImported) {
  if (!root) return;
  root.querySelectorAll('[data-excel-import]').forEach((panel) => {
    const type = panel.getAttribute('data-excel-import');
    const fileInput = panel.querySelector('[data-import-file]');
    const submit = panel.querySelector('[data-import-submit]');
    const result = panel.querySelector('[data-import-result]');
    if (!type || !fileInput || !submit || submit.dataset.importBound === 'true') return;
    submit.dataset.importBound = 'true';

    submit.addEventListener('click', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        showAppToast('Seleccioná un archivo Excel.', 'warning');
        fileInput.focus();
        return;
      }

      const previousLabel = submit.textContent;
      submit.disabled = true;
      submit.textContent = 'Importando...';
      if (result) {
        result.hidden = true;
        result.textContent = '';
      }

      try {
        const formData = new FormData();
        formData.append('type', type);
        formData.append('file', file);

        const response = await fetch('/api/import', {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
        });
        const payload = await response.json().catch(() => ({}));

        if (result) {
          result.hidden = false;
          result.className = `import-result ${response.ok ? 'import-result-ok' : 'import-result-error'}`;
          result.textContent = response.ok
            ? payload.message || 'Importación completada.'
            : payload.error || 'No se pudo importar el archivo.';
        }

        if (response.ok) {
          fileInput.value = '';
          onImported?.(type);
        }
      } catch (error) {
        console.error('[aula-clara] simple excel import failed', error);
        if (result) {
          result.hidden = false;
          result.className = 'import-result import-result-error';
          result.textContent = 'No se pudo importar el archivo.';
        }
      } finally {
        submit.disabled = false;
        submit.textContent = previousLabel || 'Importar';
      }
    });
  });
}
