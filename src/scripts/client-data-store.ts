import { CLIENT_STORAGE_ENTRIES } from '../lib/client-storage-keys';

const SERVER_BACKED_KEYS = new Set(CLIENT_STORAGE_ENTRIES.map((entry) => entry.key));

let sessionUserId: string | null = null;
const memoryStore = new Map<string, unknown>();

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyForKey(key: string) {
  const entry = CLIENT_STORAGE_ENTRIES.find((item) => item.key === key);
  return JSON.parse(entry?.empty || '[]');
}

export function initClientDataStore(userId: string | null) {
  sessionUserId = userId || null;
  if (!sessionUserId) memoryStore.clear();
}

export function isServerBackedSession() {
  return Boolean(sessionUserId);
}

export function scopedStorageKey(key: string, userId = sessionUserId) {
  return userId ? `${key}:${userId}` : key;
}

export function readClientData<T>(key: string, fallback: T): T {
  if (sessionUserId && SERVER_BACKED_KEYS.has(key)) {
    if (memoryStore.has(key)) return cloneValue(memoryStore.get(key) as T);
    return cloneValue(fallback);
  }

  try {
    const stored = JSON.parse(localStorage.getItem(scopedStorageKey(key)) || 'null');
    if (stored !== null) return stored as T;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeClientData(key: string, value: unknown) {
  if (sessionUserId && SERVER_BACKED_KEYS.has(key)) {
    memoryStore.set(key, cloneValue(value));
    return;
  }
  localStorage.setItem(scopedStorageKey(key), JSON.stringify(value));
}

export function replaceClientDataSnapshot(snapshot: Record<string, unknown>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (!SERVER_BACKED_KEYS.has(key)) continue;
    memoryStore.set(key, cloneValue(value ?? emptyForKey(key)));
  }
}

export function peekLocalCatalog(key: string, userId: string) {
  try {
    return JSON.parse(localStorage.getItem(scopedStorageKey(key, userId)) || 'null');
  } catch {
    return null;
  }
}

export function clearCatalogLocalStorage(userId: string) {
  for (const { key } of CLIENT_STORAGE_ENTRIES) {
    localStorage.removeItem(scopedStorageKey(key, userId));
    localStorage.removeItem(key);
  }
}
