export type SyncEntity = 'attendance' | 'student' | 'grade' | 'subject' | 'school' | 'course';
export type SyncAction = 'upsert' | 'delete';
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';

export interface AttendancePayload {
  id: string;
  docenteId: string;
  studentId: string;
  subjectId: string;
  fecha: string;
  estado: 'presente' | 'ausente';
  updatedAt: string;
}

export interface PendingOperation<TPayload = unknown> {
  id: string;
  clientMutationId: string;
  entity: SyncEntity;
  action: SyncAction;
  payload: TPayload;
  status: SyncStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

const DB_NAME = 'aula_clara_offline';
const DB_VERSION = 2;
const ATTENDANCE_STORE = 'attendance_records';
const OPERATIONS_STORE = 'pending_operations';
const ATTENDANCE_NATURAL_KEY = ['docenteId', 'studentId', 'subjectId', 'fecha'] as const;
const OFFLINE_DB_RESET_FLAG = 'aula_clara_offline_reset_v2';

let dbPromise: Promise<IDBDatabase> | null = null;

function closeOfflineDbConnection() {
  if (!dbPromise) return Promise.resolve();
  return dbPromise
    .then((db) => db.close())
    .catch(() => undefined)
    .finally(() => {
      dbPromise = null;
    });
}

function deleteOfflineDatabase() {
  return closeOfflineDbConnection().then(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onblocked = () => {
      console.warn('[aula-clara] IndexedDB delete blocked; close other tabs with Aula Clara open.');
    };
    request.onerror = () => reject(request.error ?? new Error('No se pudo borrar IndexedDB offline.'));
  }));
}

/** One-time wipe of corrupted offline storage (equivalent to DevTools → Delete database). */
export async function resetOfflineDatabaseOnce() {
  if (typeof indexedDB === 'undefined') return false;
  if (localStorage.getItem(OFFLINE_DB_RESET_FLAG) === '1') return false;

  try {
    await deleteOfflineDatabase();
    await openOfflineDb();
    localStorage.setItem(OFFLINE_DB_RESET_FLAG, '1');
    console.info('[aula-clara] IndexedDB offline reset to schema v2.');
    return true;
  } catch (error) {
    console.error('[aula-clara] offline database reset failed', error);
    return false;
  }
}

function parseDocenteIdFromAttendanceId(id: string) {
  const parts = id.split(':');
  if (parts[0] !== 'attendance' || parts.length < 5) return '';
  return parts[1] || '';
}

function attendanceNaturalKey(record: Pick<AttendancePayload, 'docenteId' | 'studentId' | 'subjectId' | 'fecha'>) {
  return `${record.docenteId}|${record.studentId}|${record.subjectId}|${record.fecha}`;
}

function dedupeAttendanceRecords(records: AttendancePayload[]) {
  const map = new Map<string, AttendancePayload>();

  for (const record of records) {
    const docenteId = record.docenteId || parseDocenteIdFromAttendanceId(record.id);
    const normalized: AttendancePayload = {
      ...record,
      docenteId,
      id: docenteId
        ? `attendance:${docenteId}:${record.studentId}:${record.subjectId}:${record.fecha}`
        : record.id,
    };
    const key = attendanceNaturalKey(normalized);
    const current = map.get(key);
    if (!current || new Date(normalized.updatedAt).getTime() >= new Date(current.updatedAt).getTime()) {
      map.set(key, normalized);
    }
  }

  return [...map.values()];
}

function createAttendanceStore(db: IDBDatabase) {
  const store = db.createObjectStore(ATTENDANCE_STORE, { keyPath: 'id' });
  store.createIndex('byNaturalKey', [...ATTENDANCE_NATURAL_KEY], { unique: true });
  store.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
  return store;
}

function migrateAttendanceStoreToV2(store: IDBObjectStore) {
  if (store.indexNames.contains('byNaturalKey')) {
    store.deleteIndex('byNaturalKey');
  }

  const getAllRequest = store.getAll();
  getAllRequest.onsuccess = () => {
    const deduped = dedupeAttendanceRecords(getAllRequest.result as AttendancePayload[]);
    store.clear();
    for (const record of deduped) {
      store.put(record);
    }
    store.createIndex('byNaturalKey', [...ATTENDANCE_NATURAL_KEY], { unique: true });
  };
}

export function createId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function openOfflineDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains(ATTENDANCE_STORE)) {
        createAttendanceStore(db);
      } else if (oldVersion > 0 && oldVersion < 2) {
        migrateAttendanceStoreToV2(tx.objectStore(ATTENDANCE_STORE));
      }

      if (!db.objectStoreNames.contains(OPERATIONS_STORE)) {
        const store = db.createObjectStore(OPERATIONS_STORE, { keyPath: 'id' });
        store.createIndex('byStatus', 'status', { unique: false });
        store.createIndex('byClientMutationId', 'clientMutationId', { unique: true });
      }

      if (!db.objectStoreNames.contains(VIEW_CACHE_STORE)) {
        const store = db.createObjectStore(VIEW_CACHE_STORE, { keyPath: 'key' });
        store.createIndex('byFetchedAt', 'fetchedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function removeConflictingAttendanceRecord(
  store: IDBObjectStore,
  input: Pick<AttendancePayload, 'docenteId' | 'studentId' | 'subjectId' | 'fecha'>,
  id: string,
) {
  return new Promise<void>((resolve, reject) => {
    const index = store.index('byNaturalKey');
    const lookupKey = [input.docenteId, input.studentId, input.subjectId, input.fecha];
    const getRequest = index.get(lookupKey);

    getRequest.onsuccess = () => {
      const existing = getRequest.result as AttendancePayload | undefined;
      if (!existing || existing.id === id) {
        resolve();
        return;
      }

      const deleteRequest = store.delete(existing.id);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

export async function saveAttendanceOffline(input: {
  docenteId: string;
  studentId: string;
  subjectId: string;
  fecha: string;
  estado: 'presente' | 'ausente';
}) {
  const db = await openOfflineDb();
  const now = new Date().toISOString();
  const id = `attendance:${input.docenteId}:${input.studentId}:${input.subjectId}:${input.fecha}`;
  const record: AttendancePayload = { id, ...input, updatedAt: now };
  const operation: PendingOperation<AttendancePayload> = {
    id: createId('op'),
    clientMutationId: createId('mutation'),
    entity: 'attendance',
    action: 'upsert',
    payload: record,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  const tx = db.transaction([ATTENDANCE_STORE, OPERATIONS_STORE], 'readwrite');
  const attendanceStore = tx.objectStore(ATTENDANCE_STORE);
  await removeConflictingAttendanceRecord(attendanceStore, input, id);
  attendanceStore.put(record);
  tx.objectStore(OPERATIONS_STORE).put(operation);
  await transactionDone(tx);

  return { record, operation };
}

export async function queueOfflineOperation<TPayload>(input: {
  entity: SyncEntity;
  action: SyncAction;
  payload: TPayload;
}) {
  const db = await openOfflineDb();
  const now = new Date().toISOString();
  const operation: PendingOperation<TPayload> = {
    id: createId('op'),
    clientMutationId: createId('mutation'),
    entity: input.entity,
    action: input.action,
    payload: input.payload,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  const tx = db.transaction(OPERATIONS_STORE, 'readwrite');
  tx.objectStore(OPERATIONS_STORE).put(operation);
  await transactionDone(tx);
  window.dispatchEvent(new CustomEvent('aula-clara:operation-queued'));
  return operation;
}

export async function getPendingOperations() {
  const db = await openOfflineDb();
  const tx = db.transaction(OPERATIONS_STORE, 'readonly');
  const index = tx.objectStore(OPERATIONS_STORE).index('byStatus');
  const pending = await requestToPromise(index.getAll('pending'));
  const error = await requestToPromise(index.getAll('error'));
  await transactionDone(tx);
  return [...pending, ...error].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) as PendingOperation[];
}

export async function markOperationSyncing(id: string) {
  await patchOperation(id, (operation) => ({
    ...operation,
    status: 'syncing',
    attempts: operation.attempts + 1,
    updatedAt: new Date().toISOString(),
  }));
}

export async function markOperationSynced(id: string) {
  await patchOperation(id, (operation) => ({
    ...operation,
    status: 'synced',
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  }));
}

export async function markOperationError(id: string, message: string) {
  await patchOperation(id, (operation) => ({
    ...operation,
    status: 'error',
    lastError: message,
    updatedAt: new Date().toISOString(),
  }));
}

export async function countPendingOperations() {
  return (await getPendingOperations()).length;
}

export async function getOperationStatusCounts() {
  const db = await openOfflineDb();
  const tx = db.transaction(OPERATIONS_STORE, 'readonly');
  const store = tx.objectStore(OPERATIONS_STORE);
  const all = await requestToPromise(store.getAll()) as PendingOperation[];
  await transactionDone(tx);

  return all.reduce((acc, operation) => {
    acc[operation.status] = (acc[operation.status] || 0) + 1;
    return acc;
  }, {} as Record<SyncStatus, number>);
}

async function patchOperation(
  id: string,
  patcher: (operation: PendingOperation) => PendingOperation,
) {
  const db = await openOfflineDb();
  const tx = db.transaction(OPERATIONS_STORE, 'readwrite');
  const store = tx.objectStore(OPERATIONS_STORE);
  const operation = await requestToPromise(store.get(id)) as PendingOperation | undefined;
  if (operation) store.put(patcher(operation));
  await transactionDone(tx);
}

export interface ViewCacheEntry<T = unknown> {
  key: string;
  data: T;
  fetchedAt: number;
}

export function buildViewCacheKey(scope: string, parts: Record<string, string>) {
  return `${scope}:${Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('|')}`;
}

export async function getViewCache<T = unknown>(key: string) {
  const db = await openOfflineDb();
  const tx = db.transaction(VIEW_CACHE_STORE, 'readonly');
  const entry = await requestToPromise(tx.objectStore(VIEW_CACHE_STORE).get(key)) as ViewCacheEntry<T> | undefined;
  await transactionDone(tx);
  return entry ?? null;
}

export async function setViewCache<T = unknown>(key: string, data: T, fetchedAt = Date.now()) {
  const db = await openOfflineDb();
  const tx = db.transaction(VIEW_CACHE_STORE, 'readwrite');
  tx.objectStore(VIEW_CACHE_STORE).put({ key, data, fetchedAt } satisfies ViewCacheEntry<T>);
  await transactionDone(tx);
}

export async function invalidateViewCache(prefix = '') {
  const db = await openOfflineDb();
  const tx = db.transaction(VIEW_CACHE_STORE, 'readwrite');
  const store = tx.objectStore(VIEW_CACHE_STORE);
  const keys = await requestToPromise(store.getAllKeys()) as string[];

  for (const key of keys) {
    if (!prefix || key.startsWith(prefix)) store.delete(key);
  }

  await transactionDone(tx);
}
