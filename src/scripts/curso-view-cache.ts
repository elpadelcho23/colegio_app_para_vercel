import { buildViewCacheKey, getViewCache, invalidateViewCache, setViewCache } from './offline-db.ts';

export const CURSO_VIEW_CACHE_TTL_MS = 5 * 60 * 1000;
const MEMORY_CACHE = new Map<string, { fetchedAt: number; data: unknown }>();

export function cursoViewCacheKey(cursoKey: string, materiaId: string) {
  return buildViewCacheKey('curso-detalle', { cursoKey, materiaId });
}

export async function readPersistedCourseView<T>(cursoKey: string, materiaId: string) {
  const key = cursoViewCacheKey(cursoKey, materiaId);
  const memory = MEMORY_CACHE.get(key);
  if (memory) return memory.data as T;

  const persisted = await getViewCache<T>(key);
  if (!persisted) return null;

  MEMORY_CACHE.set(key, { fetchedAt: persisted.fetchedAt, data: persisted.data });
  return persisted.data;
}

export async function readCachedCourseView<T>(cursoKey: string, materiaId: string, ttlMs = CURSO_VIEW_CACHE_TTL_MS) {
  const key = cursoViewCacheKey(cursoKey, materiaId);
  const memory = MEMORY_CACHE.get(key);
  if (memory && Date.now() - memory.fetchedAt < ttlMs) {
    return memory.data as T;
  }

  const persisted = await getViewCache<T>(key);
  if (persisted && Date.now() - persisted.fetchedAt < ttlMs) {
    MEMORY_CACHE.set(key, { fetchedAt: persisted.fetchedAt, data: persisted.data });
    return persisted.data;
  }

  return null;
}

export async function hasPersistedCourseView(cursoKey: string, materiaId: string) {
  return Boolean(await readPersistedCourseView(cursoKey, materiaId));
}

export async function fetchCourseView<T>(
  cursoKey: string,
  materiaId: string,
  options: {
    force?: boolean;
    ttlMs?: number;
    hasLocalData?: boolean;
  } = {},
) {
  const { force = false, ttlMs = CURSO_VIEW_CACHE_TTL_MS, hasLocalData = false } = options;
  const key = cursoViewCacheKey(cursoKey, materiaId);

  if (!force) {
    const persisted = await readPersistedCourseView<T>(cursoKey, materiaId);
    if (persisted) return persisted;

    if (hasLocalData) return null;
  }

  if (!navigator.onLine) return null;

  const params = new URLSearchParams({
    view: 'curso-detalle',
    cursoKey,
    materiaId,
  });

  const response = await fetch(`/api/sync?${params.toString()}`);
  if (response.status === 401) {
    window.location.href = '/login';
    return null;
  }
  if (!response.ok) return null;

  const data = await response.json() as T;
  const fetchedAt = Date.now();
  MEMORY_CACHE.set(key, { fetchedAt, data });
  await setViewCache(key, data, fetchedAt);
  return data;
}

export async function invalidateCourseViewCache(cursoKey?: string, materiaId?: string) {
  if (cursoKey && materiaId) {
    const key = cursoViewCacheKey(cursoKey, materiaId);
    MEMORY_CACHE.delete(key);
    await invalidateViewCache(key);
    return;
  }

  if (cursoKey) {
    for (const cacheKey of [...MEMORY_CACHE.keys()]) {
      if (cacheKey.includes(`cursoKey=${cursoKey}`)) MEMORY_CACHE.delete(cacheKey);
    }
    await invalidateViewCache(`curso-detalle:cursoKey=${cursoKey}`);
    return;
  }

  MEMORY_CACHE.clear();
  await invalidateViewCache('curso-detalle:');
}
