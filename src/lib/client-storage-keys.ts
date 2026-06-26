export type ClientStorageEntry = {
  key: string;
  pullField: string | null;
  empty: string;
};

/** Fuente única de claves de localStorage sincronizadas con /api/sync/pull. */
export const CLIENT_STORAGE_ENTRIES: ClientStorageEntry[] = [
  { key: 'aula_clara_students', pullField: 'students', empty: '[]' },
  { key: 'aula_clara_courses', pullField: 'courses', empty: '[]' },
  { key: 'aula_clara_schools', pullField: 'schools', empty: '[]' },
  { key: 'aula_clara_subjects', pullField: 'subjects', empty: '[]' },
  { key: 'aula_clara_attendance', pullField: 'attendance', empty: '[]' },
  { key: 'aula_clara_grades', pullField: 'grades', empty: '[]' },
  { key: 'aula_clara_dashboard_filters', pullField: null, empty: '{}' },
  { key: 'aula_clara_teacher_context', pullField: null, empty: '[]' },
];

export const CLIENT_DATA_STORAGE: Record<string, string> = Object.fromEntries(
  CLIENT_STORAGE_ENTRIES.map(({ key, empty }) => [key, empty]),
);

export const PULL_FIELD_BY_KEY: Record<string, string> = Object.fromEntries(
  CLIENT_STORAGE_ENTRIES
    .filter((entry): entry is ClientStorageEntry & { pullField: string } => entry.pullField !== null)
    .map(({ key, pullField }) => [key, pullField]),
);

/** localStorage: usuario omitió el checklist de primeros pasos en el panel. */
export function onboardingDismissedKey(userId: string) {
  return `aula_clara_onboarding_dismissed:${userId}`;
}
