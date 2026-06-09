import { buildViewCacheKey, getViewCache, openOfflineDb, setViewCache } from './offline-db.ts';

export async function readLocalOrIndexed<T>(options: {
  localItems?: unknown[];
  cacheScope: string;
  cacheParts: Record<string, string>;
}) {
  const localItems = options.localItems || [];
  if (localItems.length > 0) return localItems as T[];

  const cacheKey = buildViewCacheKey(options.cacheScope, options.cacheParts);
  const cached = await getViewCache<T[]>(cacheKey);
  return cached?.data ?? null;
}

export async function writeIndexedCache<T>(scope: string, parts: Record<string, string>, data: T[]) {
  const cacheKey = buildViewCacheKey(scope, parts);
  await setViewCache(cacheKey, data, Date.now());
}

export async function isIndexedDbEmpty() {
  const db = await openOfflineDb();
  const stores = ['attendance_records', 'pending_operations', 'view_snapshots'] as const;

  for (const storeName of stores) {
    const tx = db.transaction(storeName, 'readonly');
    const count = await new Promise<number>((resolve, reject) => {
      const request = tx.objectStore(storeName).count();
      request.onsuccess = () => resolve(Number(request.result || 0));
      request.onerror = () => reject(request.error);
    });
    if (count > 0) return false;
  }

  return true;
}
