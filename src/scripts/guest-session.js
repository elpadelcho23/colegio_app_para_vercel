import {
  CLIENT_DATA_STORAGE,
  onboardingDismissedKey,
  productGuidesKey,
  productTourKey,
} from '../lib/client-storage-keys.ts';
import { clearOfflineDatabase } from './offline-db.ts';

const KEEP_KEYS = new Set(['aula_clara_theme', 'aula_clara_offline_reset_v2', 'aula_clara_offline_reset_v3']);

const SESSION_DRAFT_KEYS = [
  'aula_clara_recovery_draft',
  'aula_clara_curriculum_context',
  'aula_clara_ai_extra_prompt',
  'aula_clara_has_activity',
];

function scoped(key, userId) {
  return `${key}:${userId}`;
}

/** Borra casi todo lo de Aula Clara en el navegador (deja solo tema). */
export function wipeAulaClaraBrowserData() {
  if (typeof localStorage === 'undefined') return;

  const toRemove = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (KEEP_KEYS.has(key)) continue;
    if (
      key.startsWith('aula_clara_')
      || key.includes(':guest-')
      || key.startsWith('guest-')
    ) {
      toRemove.push(key);
    }
  }
  toRemove.forEach((key) => localStorage.removeItem(key));

  SESSION_DRAFT_KEYS.forEach((key) => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  });

  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('aula_clara_')) sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

/**
 * Limpia datos locales del invitado (localStorage scoped + sessionStorage + IndexedDB).
 * No toca el theme global.
 */
export async function clearGuestClientData(userId) {
  wipeAulaClaraBrowserData();

  if (userId && typeof localStorage !== 'undefined') {
    Object.keys(CLIENT_DATA_STORAGE).forEach((key) => {
      localStorage.removeItem(scoped(key, userId));
      localStorage.removeItem(key);
    });
    localStorage.removeItem(onboardingDismissedKey(userId));
    localStorage.removeItem(productTourKey(userId));
    localStorage.removeItem(productGuidesKey(userId));
  }

  try {
    await clearOfflineDatabase();
  } catch (error) {
    console.warn('[aula-clara] no se pudo borrar IndexedDB del invitado', error);
  }
}

/**
 * En modo invitado:
 * - Al salir (botón): se borran TODOS los datos locales de Aula Clara y luego logout.
 * - Al recargar: la cookie de sesión se mantiene (no borramos al unload).
 */
export function initGuestSession({ userId, isGuest }) {
  if (!isGuest || !userId) return;

  document.querySelectorAll('[data-logout-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      void (async () => {
        try {
          await clearGuestClientData(userId);
        } catch {
          wipeAulaClaraBrowserData();
        }

        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'x-aula-clara-guest-exit': '1',
            },
          });
        } catch {
          // igual redirigimos al login
        }

        window.location.replace('/login?guest_cleared=1');
      })();
    });
  });
}
