import { CLIENT_STORAGE_ENTRIES } from '../lib/client-storage-keys';
import { groupPendingMutations, mergeHydratedStorageValue } from '../lib/hydrate-merge';
import {
  clearCatalogLocalStorage,
  initClientDataStore,
  peekLocalCatalog,
  replaceClientDataSnapshot,
} from './client-data-store';
import {
  countPendingOperations,
  getPendingOperations,
  getOperationStatusCounts,
  markOperationError,
  markOperationSynced,
  markOperationSyncing,
  queueOfflineOperation,
  type PendingOperation,
} from './offline-db';

let syncInProgress = false;

function isEmptyFilters(value: unknown) {
  return !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value as object).length === 0;
}

function isEmptyList(value: unknown) {
  return !Array.isArray(value) || value.length === 0;
}

function hydrateMemoryFromLocalFallback(userId: string) {
  const snapshot: Record<string, unknown> = {};
  for (const { key, empty } of CLIENT_STORAGE_ENTRIES) {
    const local = peekLocalCatalog(key, userId);
    snapshot[key] = local ?? JSON.parse(empty);
  }
  replaceClientDataSnapshot(snapshot);
}

export async function hydrateFromServer(userId: string, options: { notify?: boolean } = {}) {
  const { notify = true } = options;
  if (!userId) return false;

  initClientDataStore(userId);

  try {
    const response = await fetch('/api/sync/pull', { credentials: 'same-origin' });
    if (!response.ok) {
      hydrateMemoryFromLocalFallback(userId);
      return false;
    }

    let pendingOperations: Awaited<ReturnType<typeof getPendingOperations>> = [];
    try {
      pendingOperations = await getPendingOperations();
    } catch {
      pendingOperations = [];
    }

    const data = await response.json() as Record<string, unknown>;
    const pendingByEntity = groupPendingMutations(pendingOperations);
    const pendingState = [...pendingOperations]
      .filter((operation) => operation.entity === 'clientState' && operation.action === 'upsert')
      .at(-1)?.payload as { dashboardFilters?: unknown; teacherContext?: unknown } | undefined;

    if (pendingState?.dashboardFilters && typeof pendingState.dashboardFilters === 'object') {
      data.dashboardFilters = pendingState.dashboardFilters;
    }
    if (Array.isArray(pendingState?.teacherContext)) {
      data.teacherContext = pendingState.teacherContext;
    }

    const snapshot: Record<string, unknown> = {};
    for (const { key: storageKey, pullField, empty } of CLIENT_STORAGE_ENTRIES) {
      snapshot[storageKey] = mergeHydratedStorageValue(
        storageKey,
        pullField,
        empty,
        data,
        null,
        pendingByEntity,
      );
    }

    let migratedClientState = false;
    const localFilters = peekLocalCatalog('aula_clara_dashboard_filters', userId);
    const localContext = peekLocalCatalog('aula_clara_teacher_context', userId);
    if (isEmptyFilters(snapshot.aula_clara_dashboard_filters) && localFilters && typeof localFilters === 'object') {
      snapshot.aula_clara_dashboard_filters = localFilters;
      migratedClientState = true;
    }
    if (isEmptyList(snapshot.aula_clara_teacher_context) && Array.isArray(localContext) && localContext.length) {
      snapshot.aula_clara_teacher_context = localContext;
      migratedClientState = true;
    }

    replaceClientDataSnapshot(snapshot);
    clearCatalogLocalStorage(userId);

    if (migratedClientState) {
      await queueOfflineOperation({
        entity: 'clientState',
        action: 'upsert',
        payload: {
          id: userId,
          docenteId: userId,
          dashboardFilters: snapshot.aula_clara_dashboard_filters,
          teacherContext: snapshot.aula_clara_teacher_context,
          updatedAt: new Date().toISOString(),
        },
      });
    }

    if (notify) {
      window.dispatchEvent(new CustomEvent('aula-clara:data-hydrated'));
    }
    return true;
  } catch {
    hydrateMemoryFromLocalFallback(userId);
    return false;
  }
}

/** @deprecated El catalogo autenticado ya no vive en localStorage. */
export const hydrateLocalStorageFromServer = hydrateFromServer;

const SYNC_ENTITY_ORDER: Record<string, number> = {
  school: 0,
  course: 1,
  subject: 2,
  student: 3,
  attendance: 4,
  grade: 5,
  clientState: 6,
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
