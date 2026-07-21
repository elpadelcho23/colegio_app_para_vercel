/** Preferencias del docente (umbral asistencia, features freemium). */

import { DEFAULT_ATTENDANCE_THRESHOLD } from './student-situation';

const PREFS_KEY = 'aula_clara_teacher_prefs';

export type TeacherFeatureFlags = {
  curriculo: boolean;
  recuperacionIa: boolean;
  kitDocente: boolean;
  /** Plan activo: free | trial | pro */
  plan: 'free' | 'trial' | 'pro';
  trialEndsAt: string | null;
};

export type TeacherPreferences = {
  attendanceThreshold: number;
  features: TeacherFeatureFlags;
};

const DEFAULT_FEATURES: TeacherFeatureFlags = {
  curriculo: false,
  recuperacionIa: false,
  kitDocente: false,
  plan: 'trial',
  trialEndsAt: null,
};

function defaultTrialEnd() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

export function defaultTeacherPreferences(): TeacherPreferences {
  return {
    attendanceThreshold: DEFAULT_ATTENDANCE_THRESHOLD,
    features: {
      ...DEFAULT_FEATURES,
      plan: 'trial',
      trialEndsAt: defaultTrialEnd(),
      // Durante trial, desbloquear Pro en UI
      curriculo: true,
      recuperacionIa: true,
      kitDocente: true,
    },
  };
}

export function readTeacherPreferences(): TeacherPreferences {
  if (typeof localStorage === 'undefined') return defaultTeacherPreferences();
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) {
      const defaults = defaultTeacherPreferences();
      localStorage.setItem(PREFS_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<TeacherPreferences>;
    const defaults = defaultTeacherPreferences();
    return {
      attendanceThreshold: Number(parsed.attendanceThreshold) || defaults.attendanceThreshold,
      features: {
        ...defaults.features,
        ...(parsed.features || {}),
      },
    };
  } catch {
    return defaultTeacherPreferences();
  }
}

export function writeTeacherPreferences(prefs: TeacherPreferences) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function updateTeacherPreferences(patch: Partial<TeacherPreferences> & { features?: Partial<TeacherFeatureFlags> }) {
  const current = readTeacherPreferences();
  const next: TeacherPreferences = {
    attendanceThreshold: patch.attendanceThreshold ?? current.attendanceThreshold,
    features: {
      ...current.features,
      ...(patch.features || {}),
    },
  };
  // Sync Pro flags with plan
  if (next.features.plan === 'pro' || next.features.plan === 'trial') {
    const trialValid = next.features.plan === 'pro'
      || !next.features.trialEndsAt
      || next.features.trialEndsAt >= new Date().toISOString().slice(0, 10);
    if (trialValid) {
      next.features.curriculo = true;
      next.features.recuperacionIa = true;
      next.features.kitDocente = true;
    }
  }
  if (next.features.plan === 'free') {
    next.features.curriculo = false;
    next.features.recuperacionIa = false;
    next.features.kitDocente = false;
  }
  writeTeacherPreferences(next);
  return next;
}

export function hasFeature(flag: keyof Omit<TeacherFeatureFlags, 'plan' | 'trialEndsAt'>) {
  const prefs = readTeacherPreferences();
  if (prefs.features.plan === 'pro') return true;
  if (prefs.features.plan === 'trial') {
    const ends = prefs.features.trialEndsAt;
    if (!ends || ends >= new Date().toISOString().slice(0, 10)) return true;
  }
  return Boolean(prefs.features[flag]);
}
