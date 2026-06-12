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

const HYDRATE_STORAGE_KEYS = [
  ['aula_clara_students', 'students'],
  ['aula_clara_courses', 'courses'],
  ['aula_clara_subjects', 'subjects'],
  ['aula_clara_attendance', 'attendance'],
  ['aula_clara_grades', 'grades'],
  ['aula_clara_dashboard_filters', null],
  ['aula_clara_teacher_context', null],
] as const;

const HYDRATE_EMPTY_VALUES: Record<string, string> = {
  aula_clara_dashboard_filters: '{}',
  aula_clara_teacher_context: '[]',
};

export async function hydrateLocalStorageFromServer(userId: string) {
  if (!userId) return false;

  const scoped = (key: string) => `${key}:${userId}`;
  if (localStorage.getItem(scoped('aula_clara_students'))) return false;

  try {
    const response = await fetch('/api/sync/pull', { credentials: 'same-origin' });
    if (!response.ok) return false;

    const data = await response.json();
    for (const [storageKey, field] of HYDRATE_STORAGE_KEYS) {
      const value = field && Object.prototype.hasOwnProperty.call(data, field)
        ? data[field]
        : JSON.parse(HYDRATE_EMPTY_VALUES[storageKey] || '[]');
      localStorage.setItem(scoped(storageKey), JSON.stringify(value));
    }

    return true;
  } catch {
    return false;
  }
}

export async function syncPendingOperations() {
  if (syncInProgress || !navigator.onLine) {
    return { synced: 0, failed: 0, pending: await countPendingOperations(), counts: await getOperationStatusCounts() };
  }

  syncInProgress = true;
  let synced = 0;
  let failed = 0;

  try {
    const operations = await getPendingOperations();

    for (const operation of operations) {
      try {
        await markOperationSyncing(operation.id);
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: [operation] satisfies PendingOperation[] }),
        });

        if (response.status === 401) {
          window.location.href = '/login';
          throw new Error('Sesion expirada. Inicia sesion para sincronizar.');
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();
        const item = result.results?.[0];

        if (item?.status === 'synced' || item?.status === 'duplicate') {
          await markOperationSynced(operation.id);
          synced++;
        } else {
          throw new Error(item?.message || 'No se pudo sincronizar la operacion.');
        }
      } catch (error) {
        failed++;
        await markOperationError(operation.id, error instanceof Error ? error.message : 'Error desconocido');
      }
    }
  } finally {
    syncInProgress = false;
    window.dispatchEvent(new CustomEvent('aula-clara:sync-finished', {
      detail: { synced, failed, pending: await countPendingOperations(), counts: await getOperationStatusCounts() },
    }));
  }

  return { synced, failed, pending: await countPendingOperations(), counts: await getOperationStatusCounts() };
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
