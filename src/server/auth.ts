import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { CLIENT_DATA_STORAGE, PULL_FIELD_BY_KEY } from '../lib/client-storage-keys';
import { db, getUserById, type User } from './db';
import {
  createSessionPassportCookieValue,
  SESSION_PASSPORT_COOKIE,
} from './guest-passport';

export const SESSION_COOKIE = 'aula_clara_session';
export { SESSION_PASSPORT_COOKIE, SESSION_PASSPORT_COOKIE as GUEST_PASSPORT_COOKIE };
const SESSION_DAYS = 7;
/** TTL de seguridad en SQLite para invitados (cookie de navegador sin expires). */
const GUEST_SESSION_HOURS = 12;

export type SessionOptions = {
  /** Cookie de sesión del navegador (sin expires) + TTL corto en SQLite. */
  sessionOnly?: boolean;
};

export { CLIENT_DATA_STORAGE };

function buildSessionBootstrapScript(userId: string, redirectTo: string, mode: 'login' | 'register' | 'guest') {
  const storageInit = JSON.stringify(
    Object.entries(CLIENT_DATA_STORAGE).map(([key, value]) => [key, value]),
  );
  const pullMap = JSON.stringify(PULL_FIELD_BY_KEY);

  return `(function () {
  var userId = ${JSON.stringify(userId)};
  var redirectTo = ${JSON.stringify(redirectTo)};
  var mode = ${JSON.stringify(mode)};
  var entries = ${storageInit};
  var pullMap = ${pullMap};

  function scopedKey(key) {
    return key + ':' + userId;
  }

  function wipeStaleAulaClaraKeys() {
    var keep = { aula_clara_theme: 1, aula_clara_offline_reset_v2: 1 };
    var remove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || keep[key]) continue;
      if (key.indexOf('aula_clara_') === 0 || key.indexOf(':guest-') !== -1) remove.push(key);
    }
    remove.forEach(function (key) { localStorage.removeItem(key); });
    try {
      ['aula_clara_recovery_draft','aula_clara_curriculum_context','aula_clara_ai_extra_prompt','aula_clara_has_activity']
        .forEach(function (key) { sessionStorage.removeItem(key); });
    } catch (e) {}
  }

  function removeLegacyKeys() {
    entries.forEach(function (pair) {
      localStorage.removeItem(pair[0]);
    });
    localStorage.removeItem('aula_clara_calendar_alerts_dismissed');
  }

  function initMissingEmpty() {
    entries.forEach(function (pair) {
      var key = pair[0];
      var value = pair[1];
      if (!localStorage.getItem(scopedKey(key))) {
        localStorage.setItem(scopedKey(key), value);
      }
    });
  }

  function mergeById(serverItems, localItems) {
    var map = {};
    function add(item) {
      if (!item || !item.id) return;
      var current = map[item.id];
      if (!current) {
        map[item.id] = item;
        return;
      }
      var currentTime = new Date(current.updatedAt || 0).getTime();
      var nextTime = new Date(item.updatedAt || 0).getTime();
      if (nextTime >= currentTime) map[item.id] = item;
    }
    (serverItems || []).forEach(add);
    (localItems || []).forEach(add);
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  function applyServerData(data, replace) {
    entries.forEach(function (pair) {
      var key = pair[0];
      var fallback = pair[1];
      var field = pullMap[key];
      var serverPayload = field && Object.prototype.hasOwnProperty.call(data, field)
        ? data[field]
        : JSON.parse(fallback);
      var localRaw = localStorage.getItem(scopedKey(key));
      var localPayload = localRaw ? JSON.parse(localRaw) : JSON.parse(fallback);
      var payload;

      if (replace) {
        payload = serverPayload != null ? serverPayload : JSON.parse(fallback);
      } else if (key === 'aula_clara_dashboard_filters') {
        payload = Object.assign({}, serverPayload, localPayload);
      } else if (Array.isArray(serverPayload)) {
        payload = mergeById(serverPayload, Array.isArray(localPayload) ? localPayload : []);
      } else {
        payload = localPayload != null ? localPayload : serverPayload;
      }

      localStorage.setItem(scopedKey(key), JSON.stringify(payload));
    });
  }

  function finish() {
    window.location.replace(redirectTo);
  }

  if (mode === 'guest') {
    wipeStaleAulaClaraKeys();
    removeLegacyKeys();
    fetch('/api/sync/pull', { credentials: 'same-origin' })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        var hasRows = data && (
          (Array.isArray(data.courses) && data.courses.length > 0)
          || (Array.isArray(data.students) && data.students.length > 0)
          || (Array.isArray(data.subjects) && data.subjects.length > 0)
        );
        if (hasRows) applyServerData(data, true);
        else initMissingEmpty();
        finish();
      })
      .catch(function () {
        initMissingEmpty();
        finish();
      });
    return;
  }

  removeLegacyKeys();

  if (mode === 'register') {
    initMissingEmpty();
    finish();
    return;
  }

  function hasCachedData() {
    try {
      var missingKey = entries.some(function (pair) {
        return !localStorage.getItem(scopedKey(pair[0]));
      });
      if (missingKey) return false;

      var keys = ['aula_clara_students', 'aula_clara_courses', 'aula_clara_subjects'];
      for (var i = 0; i < keys.length; i++) {
        var raw = localStorage.getItem(scopedKey(keys[i]));
        if (!raw) return false;
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  if (hasCachedData()) {
    initMissingEmpty();
    finish();
    return;
  }

  fetch('/api/sync/pull', { credentials: 'same-origin' })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (data) {
      if (data) {
        applyServerData(data, false);
      } else {
        initMissingEmpty();
      }
      finish();
    })
    .catch(function () {
      initMissingEmpty();
      finish();
    });
})();`;
}

export function buildLoginSessionHtml(userId: string, redirectTo = '/') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Restaurando tus datos...</title>
</head>
<body>
  <script>${buildSessionBootstrapScript(userId, redirectTo, 'login')}</script>
</body>
</html>`;
}

export function buildGuestSessionHtml(userId: string, redirectTo = '/') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preparando modo invitado...</title>
</head>
<body>
  <script>${buildSessionBootstrapScript(userId, redirectTo, 'guest')}</script>
</body>
</html>`;
}

export function buildFreshSessionHtml(userId: string, redirectTo = '/') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preparando tu espacio...</title>
</head>
<body>
  <script>${buildSessionBootstrapScript(userId, redirectTo, 'register')}</script>
</body>
</html>`;
}

function respondWithSessionHtml(
  userId: string,
  cookies: {
    get: (name: string) => { value: string } | undefined;
    set: (name: string, value: string, options: Record<string, unknown>) => void;
    delete: (name: string, options: Record<string, unknown>) => void;
  },
  url: URL,
  html: string,
  options: SessionOptions = {},
) {
  const previousToken = cookies.get(SESSION_COOKIE)?.value;
  const session = rotateSession(userId, previousToken, options);

  if (previousToken) {
    cookies.delete(SESSION_COOKIE, cookieOptions(url));
  }

  const cookieProps: Record<string, unknown> = {
    ...cookieOptions(url),
  };
  // Sesión de navegador: sin `expires` se borra al cerrar el browser.
  if (!options.sessionOnly) {
    cookieProps.expires = session.expiresAt;
  }

  cookies.set(SESSION_COOKIE, session.token, cookieProps);

  const user = getUserById(userId);
  if (user) {
    cookies.set(
      SESSION_PASSPORT_COOKIE,
      createSessionPassportCookieValue({
        user,
        sessionToken: session.token,
        expiresAt: session.expiresAt,
      }),
      cookieProps,
    );
  }

  return new Response(html, {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function respondWithLoginSession(
  userId: string,
  cookies: {
    get: (name: string) => { value: string } | undefined;
    set: (name: string, value: string, options: Record<string, unknown>) => void;
    delete: (name: string, options: Record<string, unknown>) => void;
  },
  url: URL,
  redirectTo = '/',
) {
  return respondWithSessionHtml(userId, cookies, url, buildLoginSessionHtml(userId, redirectTo));
}

export function respondWithFreshSession(
  userId: string,
  cookies: {
    get: (name: string) => { value: string } | undefined;
    set: (name: string, value: string, options: Record<string, unknown>) => void;
    delete: (name: string, options: Record<string, unknown>) => void;
  },
  url: URL,
  redirectTo = '/',
) {
  return respondWithSessionHtml(userId, cookies, url, buildFreshSessionHtml(userId, redirectTo));
}

export function respondWithGuestSession(
  userId: string,
  cookies: {
    get: (name: string) => { value: string } | undefined;
    set: (name: string, value: string, options: Record<string, unknown>) => void;
    delete: (name: string, options: Record<string, unknown>) => void;
  },
  url: URL,
  redirectTo = '/',
) {
  // Bootstrap dedicado: limpia restos y reemplaza con demo del servidor (sin merge).
  return respondWithSessionHtml(
    userId,
    cookies,
    url,
    buildGuestSessionHtml(userId, redirectTo),
    { sessionOnly: true },
  );
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: string, options: SessionOptions = {}) {
  const token = randomBytes(32).toString('base64url');
  const ttlMs = options.sessionOnly
    ? GUEST_SESSION_HOURS * 60 * 60 * 1000
    : SESSION_DAYS * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const id = `sess-${randomBytes(16).toString('hex')}`;

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, hashToken(token), expiresAt);

  return { token, expiresAt: new Date(expiresAt), sessionOnly: Boolean(options.sessionOnly) };
}

export function isStrongPassword(password: string) {
  return (
    typeof password === 'string' &&
    password.length >= 5 &&
    /[a-zA-Z]/.test(password) &&
    /\d/.test(password)
  );
}

function mapUserRow(row: Omit<User, 'is_guest'> & { is_guest?: number | boolean; password_hash?: string }): User {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    nombre: row.nombre,
    email: row.email,
    rol: row.rol,
    is_guest: Boolean(row.is_guest),
  };
}

export function verifyLogin(email: string, password: string): User | null {
  const row = db.prepare(`
    SELECT id, tenant_id, nombre, email, password_hash, rol, COALESCE(is_guest, 0) AS is_guest
    FROM usuarios
    WHERE lower(email) = lower(?)
  `).get(email) as (Omit<User, 'is_guest'> & { password_hash: string; is_guest: number }) | undefined;

  if (!row || !bcrypt.compareSync(password, row.password_hash)) return null;
  return mapUserRow(row);
}

export function getUserFromToken(token?: string): User | null {
  if (!token) return null;

  const row = db.prepare(`
    SELECT usuarios.id, usuarios.tenant_id, usuarios.nombre, usuarios.email, usuarios.rol,
           COALESCE(usuarios.is_guest, 0) AS is_guest
    FROM sessions
    JOIN usuarios ON usuarios.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > datetime('now')
  `).get(hashToken(token)) as (Omit<User, 'is_guest'> & { is_guest: number }) | undefined;

  return row ? mapUserRow(row) : null;
}

export function deleteSession(token?: string) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** Invalida la sesión previa (si existía) y emite un token nuevo — mitiga session fixation. */
export function rotateSession(userId: string, previousToken?: string, options: SessionOptions = {}) {
  if (previousToken) deleteSession(previousToken);
  return createSession(userId, options);
}

export function cookieOptions(url: URL) {
  return {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'strict' as const,
    path: '/',
  };
}

export function canAccessStudent(user: User, studentId: string) {
  if (user.rol === 'admin') return true;
  const row = db.prepare(`
    SELECT alumnos.id
    FROM alumnos
    JOIN docente_cursos ON docente_cursos.curso_id = alumnos.curso_id
    WHERE alumnos.id = ?
      AND docente_cursos.docente_id = ?
      AND alumnos.tenant_id = ?
      AND docente_cursos.tenant_id = ?
  `).get(studentId, user.id, user.tenant_id, user.tenant_id);
  return Boolean(row);
}

export function canAccessSubject(user: User, subjectId: string) {
  if (user.rol === 'admin') return true;
  const row = db.prepare(`
    SELECT materia_id
    FROM docente_materias
    WHERE materia_id = ?
      AND docente_id = ?
      AND tenant_id = ?
  `).get(subjectId, user.id, user.tenant_id);
  return Boolean(row);
}

export function canAccessCourse(user: User, courseId: string) {
  if (user.rol === 'admin') return true;
  const row = db.prepare(`
    SELECT curso_id
    FROM docente_cursos
    WHERE curso_id = ?
      AND docente_id = ?
      AND tenant_id = ?
  `).get(courseId, user.id, user.tenant_id);
  return Boolean(row);
}
