import { countPendingOperations, getOperationStatusCounts } from './offline-db.ts';
import { syncPendingOperations } from './sync-client.ts';
import { registerSpaViewRefresh } from './spa-router.ts';
import { navigateToToolsSection } from './tools-ui.js';

export function initSyncUi({ formatSyncStatus }) {
  const toolsRoot = document.querySelector('[data-sync-tools]');
  const syncStatus = toolsRoot?.querySelector('[data-sync-status]');
  const connectionStatus = toolsRoot?.querySelector('[data-connection-status]');
  const syncButton = toolsRoot?.querySelector('[data-sync-button]');
  const indicator = document.querySelector('[data-sync-indicator]');

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
    let label = 'Sincronización al día';

    if (offline) {
      state = 'offline';
      label = 'Sin conexión';
    } else if (errors > 0) {
      state = 'error';
      label = `${errors} error${errors === 1 ? '' : 'es'} de sincronización`;
    } else if (pending > 0) {
      state = 'pending';
      label = `${pending} cambio${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'}`;
    }

    indicator.dataset.syncState = state;
    indicator.setAttribute('aria-label', label);
    indicator.title = label;
    indicator.classList.toggle('is-hidden', state === 'ok');
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
    syncButton.textContent = 'Sincronizando...';
    try {
      const result = await syncPendingOperations();
      if (syncStatus) syncStatus.textContent = formatSyncStatus(result.counts);
      updateIndicator(result.counts);
    } finally {
      syncButton.disabled = false;
      syncButton.textContent = previousLabel || 'Sincronizar ahora';
    }
  });

  indicator?.addEventListener('click', () => {
    navigateToToolsSection('sync');
  });

  registerSpaViewRefresh('herramientas', () => { void refreshCounts(); });
  void refreshCounts();
}
