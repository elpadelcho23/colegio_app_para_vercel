import { registerSpaViewRefresh, showSpaView } from './spa-router.ts';
import { initExcelImportWorkspaces } from './excel-import-ui.js';
import { showAppToast } from './app-feedback.js';

export function initToolsView({ onImported, getCicloLectivo } = {}) {
  const root = document.querySelector('[data-herramientas]');
  if (!root) return;

  initToolsHubTabs(root);
  initToolsTabs(root);
  initSimpleExcelImport(root, onImported);
  initExcelImportWorkspaces({
    onImported: (importType, result) => onImported?.(importType, result),
    getCicloLectivo,
  });
  registerSpaViewRefresh('herramientas', () => {
    const tab = root.querySelector('.tools-tab.is-active')?.getAttribute('data-tools-tab');
    if (tab) activateToolsTab(root, tab);
  });
}

export function scrollToToolsSection(section) {
  const target = document.querySelector(`[data-tools-section="${section}"]`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function navigateToToolsSection(section, tab) {
  if (section === 'ai' || section === 'entregas' || section === 'corregir' || section === 'contenido') {
    showSpaView('actividades');
    window.dispatchEvent(new CustomEvent('aula-clara:open-activity-flow', {
      detail: { tab: section === 'ai' ? 'contenido' : section },
    }));
    return;
  }
  showSpaView('herramientas');
  const root = document.querySelector('[data-herramientas]');
  if (section === 'sync' || section === 'plan' || section === 'kit' || section === 'cuenta') {
    activateToolsHubTab(root, 'cuenta');
  } else {
    activateToolsHubTab(root, 'excel');
  }
  if (tab && root) activateToolsTab(root, tab);
  window.requestAnimationFrame(() => scrollToToolsSection(section));
}

function initToolsHubTabs(root) {
  root.querySelectorAll('[data-tools-hub-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      activateToolsHubTab(root, tab.getAttribute('data-tools-hub-tab') || 'excel');
    });
  });
}

function activateToolsHubTab(root, tabId) {
  if (!root) return;
  root.querySelectorAll('[data-tools-hub-tab]').forEach((tab) => {
    const active = tab.getAttribute('data-tools-hub-tab') === tabId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  root.querySelectorAll('[data-tools-hub-panel]').forEach((panel) => {
    const active = panel.getAttribute('data-tools-hub-panel') === tabId;
    panel.classList.toggle('is-hidden', !active);
    panel.hidden = !active;
  });
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

function activateToolsTab(root, tabId) {
  root.querySelectorAll('[data-tools-tab]').forEach((tab) => {
    const active = tab.getAttribute('data-tools-tab') === tabId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  root.querySelectorAll('[data-tools-panel]').forEach((panel) => {
    const active = panel.getAttribute('data-tools-panel') === tabId;
    panel.classList.toggle('is-hidden', !active);
    if (active) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
  });
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
