import { registerSpaViewRefresh, showSpaView } from './spa-router.ts';
import { initExcelImportWorkspaces } from './excel-import-ui.js';

export function initToolsView({ onImported } = {}) {
  const root = document.querySelector('[data-herramientas]');
  if (!root) return;

  initToolsTabs(root);
  initSimpleExcelImport(root, onImported);
  initExcelImportWorkspaces({
    onImported: (importType) => onImported?.(importType),
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
  showSpaView('herramientas');
  if (tab) {
    const root = document.querySelector('[data-herramientas]');
    if (root) activateToolsTab(root, tab);
  }
  window.requestAnimationFrame(() => scrollToToolsSection(section));
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

function initSimpleExcelImport(root, onImported) {
  root.querySelectorAll('[data-excel-import]').forEach((panel) => {
    const type = panel.getAttribute('data-excel-import');
    const fileInput = panel.querySelector('[data-import-file]');
    const submit = panel.querySelector('[data-import-submit]');
    const result = panel.querySelector('[data-import-result]');
    if (!type || !fileInput || !submit) return;

    submit.addEventListener('click', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        alert('Seleccioná un archivo Excel.');
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
