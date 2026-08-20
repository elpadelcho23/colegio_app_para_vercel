import { CLIENT_STORAGE_ENTRIES } from './client-storage-keys';
import { pickBetterRecordName } from './record-display-name';
import type { SyncEntity } from '../scripts/offline-db';

type Timestamped = { id?: string; updatedAt?: string; nombre?: string };

const PULL_FIELD_TO_ENTITY: Partial<Record<string, SyncEntity>> = {
  students: 'student',
  courses: 'course',
  schools: 'school',
  subjects: 'subject',
  attendance: 'attendance',
  grades: 'grade',
};

const ENTITY_TO_PULL_FIELD = Object.fromEntries(
  Object.entries(PULL_FIELD_TO_ENTITY).map(([field, entity]) => [entity, field]),
) as Record<SyncEntity, string>;

function parseStoredValue(raw: string | null, empty: string) {
  if (raw === null) return JSON.parse(empty);
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(empty);
  }
}

export function mergeRecordsById<T extends Timestamped>(
  serverItems: T[],
  localItems: T[],
  pendingUpserts: T[] = [],
  pendingDeletes: Set<string> = new Set(),
): T[] {
  const map = new Map<string, T>();

  const upsert = (item: T) => {
    if (!item?.id) return;
    const current = map.get(item.id);
    if (!current) {
      map.set(item.id, item);
      return;
    }
    const currentTime = new Date(current.updatedAt || 0).getTime();
    const nextTime = new Date(item.updatedAt || 0).getTime();
    const newer = nextTime >= currentTime ? item : current;
    const older = newer === item ? current : item;
    const nombre = pickBetterRecordName(item.id, newer.nombre, older.nombre);
    map.set(item.id, nombre ? { ...newer, nombre } : newer);
  };

  serverItems.forEach(upsert);
  localItems.forEach(upsert);
  pendingUpserts.forEach(upsert);

  return [...map.values()].filter((item) => item.id && !pendingDeletes.has(item.id));
}

export function mergeDashboardFilters(
  serverValue: Record<string, unknown>,
  localValue: Record<string, unknown>,
) {
  return { ...serverValue, ...localValue };
}

export type PendingMutationGroup = {
  upserts: Timestamped[];
  deletes: Set<string>;
};

export function groupPendingMutations(
  operations: Array<{ entity: SyncEntity; action: string; payload: unknown; status: string }>,
): Partial<Record<SyncEntity, PendingMutationGroup>> {
  const grouped: Partial<Record<SyncEntity, PendingMutationGroup>> = {};

  for (const operation of operations) {
    if (operation.status === 'synced' || operation.status === 'syncing') continue;
    const bucket = grouped[operation.entity] || { upserts: [], deletes: new Set<string>() };
    const payload = operation.payload as Timestamped;
    if (operation.action === 'delete' && payload?.id) {
      bucket.deletes.add(payload.id);
    } else if (operation.action === 'upsert' && payload) {
      bucket.upserts.push(payload);
    }
    grouped[operation.entity] = bucket;
  }

  return grouped;
}

export function mergeHydratedStorageValue(
  storageKey: string,
  pullField: string | null,
  empty: string,
  serverData: Record<string, unknown>,
  localRaw: string | null,
  pendingByEntity: Partial<Record<SyncEntity, PendingMutationGroup>>,
) {
  const localValue = parseStoredValue(localRaw, empty);
  const serverValue = pullField && Object.prototype.hasOwnProperty.call(serverData, pullField)
    ? serverData[pullField]
    : JSON.parse(empty);

  if (storageKey === 'aula_clara_dashboard_filters') {
    return mergeDashboardFilters(
      (serverValue && typeof serverValue === 'object' ? serverValue : {}) as Record<string, unknown>,
      (localValue && typeof localValue === 'object' ? localValue : {}) as Record<string, unknown>,
    );
  }

  if (!pullField || !Array.isArray(serverValue)) {
    return localRaw !== null ? localValue : serverValue;
  }

  const entity = PULL_FIELD_TO_ENTITY[pullField];
  const pending = entity ? pendingByEntity[entity] : undefined;
  const localItems = Array.isArray(localValue) ? localValue as Timestamped[] : [];
  const serverItems = serverValue as Timestamped[];

  return mergeRecordsById(
    serverItems,
    localItems,
    pending?.upserts || [],
    pending?.deletes || new Set<string>(),
  );
}

export function pullFieldForEntity(entity: SyncEntity) {
  return ENTITY_TO_PULL_FIELD[entity];
}

export const HYDRATE_STORAGE_SPEC = CLIENT_STORAGE_ENTRIES;
