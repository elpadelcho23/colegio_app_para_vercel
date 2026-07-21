import { countPendingOperations, getOperationStatusCounts } from './offline-db.ts';
import { syncPendingOperations } from './sync-client.ts';
import { registerSpaViewRefresh } from './spa-router.ts';
import { navigateToToolsSection } from './tools-ui.js';
import { showAppToast } from './app-feedback.js';

export function initSyncUi({ formatSyncStatus }) {
  const toolsRoot = document.querySelector('[data-sync-tools]');
  const syncStatus = toolsRoot?.querySelector('[data-sync-status]');
  const connectionStatus = toolsRoot?.querySelector('[data-connection-status]');
  const syncButton = toolsRoot?.querySelector('[data-sync-button]');
  const indicator = document.querySelector('[data-sync-indicator]');
  const indicatorLabel = indicator?.querySelector('[data-sync-indicator-label]');

  const updateConnectionStatus = () => {
    if (connectionStatus) {
      connectionStatus.textContent = navigator.onLine ? 'En línea' : 'Sin conexión';
      connectionStatus.className = `tag ${navigator.onLine ? 'ok' : 'warning'}`;
    }
    updateIndicator(lastCounts);
  };

  let lastCounts = {};

  const updateIndicator = (counts = {}) => {
    if (!indicator) return;
    lastCounts = counts;
    const pending = (counts.pending || 0) + (counts.syncing || 0);
    const errors = counts.error || 0;
    const offline = !navigator.onLine;

    let state = 'ok';
    let label = 'Todo guardado en la nube';

    if (offline) {
      state = 'offline';
      label = 'Sin conexión — los cambios quedan en este dispositivo';
    } else if (errors > 0) {
      state = 'error';
      label = `${errors} cambio${errors === 1 ? '' : 's'} con error — tocá para revisar`;
    } else if (pending > 0) {
      state = 'pending';
      label = `Hay ${pending} cambio${pending === 1 ? '' : 's'} sin subir — tocá para sincronizar`;
    }

    indicator.dataset.syncState = state;
    indicator.setAttribute('aria-label', label);
    indicator.title = label;
    indicator.classList.remove('is-hidden');
    if (indicatorLabel) {
      indicatorLabel.textContent = state === 'ok'
        ? 'Guardado'
        : state === 'pending'
          ? `${pending} sin subir`
          : state === 'error'
            ? 'Error'
            : 'Sin conexión';
    }
  };

  const refreshCounts = async () => {
    const [, counts] = await Promise.all([countPendingOperations(), getOperationStatusCounts()]);
    if (syncStatus) syncStatus.textContent = formatSyncStatus(counts);
    updateIndicator(counts);
    return counts;
  };

  window.addEventListener('aula-clara:sync-finished', (event) => {
    const counts = event.detail?.counts || {};
    if (syncStatus) syncStatus.textContent = formatSyncStatus(counts);
    updateIndicator(counts);
  });

  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  updateConnectionStatus();

  syncButton?.addEventListener('click', async () => {
    syncButton.disabled = true;
    const previousLabel = syncButton.textContent;
    syncButton.textContent = 'Sincronizando…';
    try {
      const result = await syncPendingOperations();
      if (syncStatus) syncStatus.textContent = formatSyncStatus(result.counts);
      updateIndicator(result.counts);
      const pending = (result.counts?.pending || 0) + (result.counts?.syncing || 0);
      const errors = result.counts?.error || 0;
      if (errors > 0) showAppToast('Algunos cambios no se pudieron subir.', 'warning');
      else if (pending > 0) showAppToast('Todavía hay cambios sin subir.', 'warning');
      else showAppToast('Todo guardado en la nube.', 'ok');
    } finally {
      syncButton.disabled = false;
      syncButton.textContent = previousLabel || 'Sincronizar ahora';
    }
  });

  indicator?.addEventListener('click', async () => {
    const pending = (lastCounts.pending || 0) + (lastCounts.syncing || 0);
    if (navigator.onLine && pending > 0 && !lastCounts.error) {
      indicator.disabled = true;
      try {
        const result = await syncPendingOperations();
        updateIndicator(result.counts);
        if (syncStatus) syncStatus.textContent = formatSyncStatus(result.counts);
        showAppToast('Todo guardado en la nube.', 'ok');
      } finally {
        indicator.disabled = false;
      }
      return;
    }
    navigateToToolsSection('sync');
  });

  registerSpaViewRefresh('herramientas', () => { void refreshCounts(); });
  void refreshCounts();
}
