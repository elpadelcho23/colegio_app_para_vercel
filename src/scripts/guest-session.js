import {
  CLIENT_DATA_STORAGE,
  onboardingDismissedKey,
  productTourKey,
} from '../lib/client-storage-keys.ts';
import { clearOfflineDatabase } from './offline-db.ts';

const EXTRA_SCOPED_KEYS = [
  'aula_clara_calendar_alerts_dismissed',
  'aula_clara_excel_templates',
  'aula_clara_student_excel_mappings',
];

const SESSION_DRAFT_KEYS = [
  'aula_clara_recovery_draft',
  'aula_clara_curriculum_context',
  'aula_clara_ai_extra_prompt',
];

function scoped(key, userId) {
  return `${key}:${userId}`;
}

/**
 * Limpia datos locales del invitado (localStorage scoped + sessionStorage + IndexedDB).
 * No toca el theme global.
 */
export async function clearGuestClientData(userId) {
  if (!userId || typeof localStorage === 'undefined') return;

  Object.keys(CLIENT_DATA_STORAGE).forEach((key) => {
    localStorage.removeItem(scoped(key, userId));
    localStorage.removeItem(key);
  });

  EXTRA_SCOPED_KEYS.forEach((key) => {
    localStorage.removeItem(scoped(key, userId));
    localStorage.removeItem(key);
  });

  localStorage.removeItem(onboardingDismissedKey(userId));
  localStorage.removeItem(productTourKey(userId));
  localStorage.removeItem('aula_clara_teacher_prefs');

  SESSION_DRAFT_KEYS.forEach((key) => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  });

  try {
    await clearOfflineDatabase();
  } catch (error) {
    console.warn('[aula-clara] no se pudo borrar IndexedDB del invitado', error);
  }
}

/**
 * En modo invitado:
 * - Al salir (botón): se borran datos locales; el logout del form limpia el servidor.
 * - Al recargar / HMR: NO se borra el servidor, así la próxima carga puede re-hidratar.
 * - Al cerrar el navegador: la cookie de sesión desaparece y el cleanup de invitados limpia restos.
 */
export function initGuestSession({ userId, isGuest }) {
  if (!isGuest || !userId) return;

  document.querySelectorAll('[data-logout-form]').forEach((form) => {
    form.addEventListener('submit', () => {
      Object.keys(CLIENT_DATA_STORAGE).forEach((key) => {
        localStorage.removeItem(scoped(key, userId));
        localStorage.removeItem(key);
      });
      EXTRA_SCOPED_KEYS.forEach((key) => {
        localStorage.removeItem(scoped(key, userId));
        localStorage.removeItem(key);
      });
      localStorage.removeItem(onboardingDismissedKey(userId));
      localStorage.removeItem(productTourKey(userId));
      localStorage.removeItem('aula_clara_teacher_prefs');
      SESSION_DRAFT_KEYS.forEach((key) => {
        try {
          sessionStorage.removeItem(key);
        } catch {
          // ignore
        }
      });
      void clearOfflineDatabase();
    });
  });
}
