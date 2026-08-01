import { CLIENT_STORAGE_ENTRIES } from '../lib/client-storage-keys';
import { groupPendingMutations, mergeHydratedStorageValue } from '../lib/hydrate-merge';
import {
  countPendingOperations,
  getPendingOperations,
  getOperationStatusCounts,
  markOperationError,
  markOperationSynced,
  markOperationSyncing,
  type PendingOperation,
} from './offline-db';

let syncInProgress = false;

export async function hydrateLocalStorageFromServer(userId: string, options: { notify?: boolean } = {}) {
  const { notify = true } = options;
  if (!userId) return false;

  const scoped = (key: string) => `${key}:${userId}`;

  try {
    const response = await fetch('/api/sync/pull', { credentials: 'same-origin' });
    if (!response.ok) return false;

    let pendingOperations: Awaited<ReturnType<typeof getPendingOperations>> = [];
    try {
      pendingOperations = await getPendingOperations();
    } catch {
      // IndexedDB puede fallar tras wipe de invitado; igual hidratamos desde el servidor.
      pendingOperations = [];
    }

    const data = await response.json();
    const pendingByEntity = groupPendingMutations(pendingOperations);

    for (const { key: storageKey, pullField, empty } of CLIENT_STORAGE_ENTRIES) {
      const merged = mergeHydratedStorageValue(
        storageKey,
        pullField,
        empty,
        data,
        localStorage.getItem(scoped(storageKey)),
        pendingByEntity,
      );
      localStorage.setItem(scoped(storageKey), JSON.stringify(merged));
    }

    if (notify) {
      window.dispatchEvent(new CustomEvent('aula-clara:data-hydrated'));
    }
    return true;
  } catch {
    return false;
  }
}

const SYNC_ENTITY_ORDER: Record<string, number> = {
  school: 0,
  course: 1,
  subject: 2,
  student: 3,
  attendance: 4,
  grade: 5,
};

export async function syncPendingOperations() {
  if (syncInProgress || !navigator.onLine) {
    return {
      synced: 0,
      failed: 0,
      pending: await countPendingOperations(),
      counts: await getOperationStatusCounts(),
      lastError: undefined as string | undefined,
    };
  }

  syncInProgress = true;
  let synced = 0;
  let failed = 0;
  let lastError: string | undefined;

  try {
    const operations = (await getPendingOperations()).sort((a, b) => {
      const order = (SYNC_ENTITY_ORDER[a.entity] ?? 99) - (SYNC_ENTITY_ORDER[b.entity] ?? 99);
      if (order !== 0) return order;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });

    for (const operation of operations) {
      try {
        await markOperationSyncing(operation.id);
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ operations: [operation] satisfies PendingOperation[] }),
        });

        if (response.status === 401) {
          window.location.href = '/login';
          throw new Error('Sesion expirada. Inicia sesion para sincronizar.');
        }

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.error || result?.results?.[0]?.message || `HTTP ${response.status}`);
        }

        const item = result.results?.[0];

        if (item?.status === 'synced' || item?.status === 'duplicate') {
          await markOperationSynced(operation.id);
          synced++;
        } else {
          throw new Error(item?.message || result?.error || 'No se pudo sincronizar la operacion.');
        }
      } catch (error) {
        failed++;
        lastError = error instanceof Error ? error.message : 'Error desconocido';
        await markOperationError(operation.id, lastError);
      }
    }
  } finally {
    syncInProgress = false;
    window.dispatchEvent(new CustomEvent('aula-clara:sync-finished', {
      detail: { synced, failed, pending: await countPendingOperations(), counts: await getOperationStatusCounts(), lastError },
    }));
  }

  return { synced, failed, pending: await countPendingOperations(), counts: await getOperationStatusCounts(), lastError };
}

export function startAutoSync() {
  window.addEventListener('online', () => {
    void syncPendingOperations();
  });

  window.addEventListener('aula-clara:operation-queued', () => {
    if (navigator.onLine) void syncPendingOperations();
  });

  if (navigator.onLine) {
    window.setTimeout(() => void syncPendingOperations(), 400);
  }
}
