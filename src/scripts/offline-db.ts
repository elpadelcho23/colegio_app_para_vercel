export type SyncEntity = 'attendance' | 'student' | 'grade' | 'subject' | 'course';
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
const DB_VERSION = 1;
const ATTENDANCE_STORE = 'attendance_records';
const OPERATIONS_STORE = 'pending_operations';

let dbPromise: Promise<IDBDatabase> | null = null;

export function createId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function openOfflineDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(ATTENDANCE_STORE)) {
        const store = db.createObjectStore(ATTENDANCE_STORE, { keyPath: 'id' });
        store.createIndex('byNaturalKey', ['studentId', 'subjectId', 'fecha'], { unique: true });
        store.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(OPERATIONS_STORE)) {
        const store = db.createObjectStore(OPERATIONS_STORE, { keyPath: 'id' });
        store.createIndex('byStatus', 'status', { unique: false });
        store.createIndex('byClientMutationId', 'clientMutationId', { unique: true });
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
  tx.objectStore(ATTENDANCE_STORE).put(record);
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
