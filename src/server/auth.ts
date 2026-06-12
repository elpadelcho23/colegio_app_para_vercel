import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { db, type User } from './db';

export const SESSION_COOKIE = 'aula_clara_session';
const SESSION_DAYS = 7;

/** Claves de localStorage por usuario (sin prefijo de usuario). */
export const CLIENT_DATA_STORAGE: Record<string, string> = {
  aula_clara_students: '[]',
  aula_clara_courses: '[]',
  aula_clara_subjects: '[]',
  aula_clara_attendance: '[]',
  aula_clara_grades: '[]',
  aula_clara_dashboard_filters: '{}',
  aula_clara_teacher_context: '[]',
};

const PULL_FIELD_BY_KEY: Record<string, string> = {
  aula_clara_students: 'students',
  aula_clara_courses: 'courses',
  aula_clara_subjects: 'subjects',
  aula_clara_attendance: 'attendance',
  aula_clara_grades: 'grades',
};

function buildSessionBootstrapScript(userId: string, redirectTo: string, mode: 'login' | 'register') {
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

  function applyServerData(data) {
    entries.forEach(function (pair) {
      var key = pair[0];
      var fallback = pair[1];
      var field = pullMap[key];
      var payload = field && Object.prototype.hasOwnProperty.call(data, field)
        ? data[field]
        : JSON.parse(fallback);
      localStorage.setItem(scopedKey(key), JSON.stringify(payload));
    });
  }

  function finish() {
    window.location.replace(redirectTo);
  }

  removeLegacyKeys();

  if (mode === 'register') {
    initMissingEmpty();
    finish();
    return;
  }

  if (localStorage.getItem(scopedKey('aula_clara_students'))) {
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
        applyServerData(data);
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
  cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void },
  url: URL,
  html: string,
) {
  const session = createSession(userId);
  cookies.set(SESSION_COOKIE, session.token, {
    ...cookieOptions(url),
    expires: session.expiresAt,
  });

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function respondWithLoginSession(
  userId: string,
  cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void },
  url: URL,
  redirectTo = '/',
) {
  return respondWithSessionHtml(userId, cookies, url, buildLoginSessionHtml(userId, redirectTo));
}

export function respondWithFreshSession(
  userId: string,
  cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void },
  url: URL,
  redirectTo = '/',
) {
  return respondWithSessionHtml(userId, cookies, url, buildFreshSessionHtml(userId, redirectTo));
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const id = `sess-${randomBytes(16).toString('hex')}`;

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, hashToken(token), expiresAt);

  return { token, expiresAt: new Date(expiresAt) };
}

export function isStrongPassword(password: string) {
  return (
    typeof password === 'string' &&
    password.length >= 10 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export function verifyLogin(email: string, password: string): User | null {
  const row = db.prepare(`
    SELECT id, tenant_id, nombre, email, password_hash, rol
    FROM usuarios
    WHERE lower(email) = lower(?)
  `).get(email) as (User & { password_hash: string }) | undefined;

  if (!row || !bcrypt.compareSync(password, row.password_hash)) return null;
  return { id: row.id, tenant_id: row.tenant_id, nombre: row.nombre, email: row.email, rol: row.rol };
}

export function getUserFromToken(token?: string): User | null {
  if (!token) return null;

  const row = db.prepare(`
    SELECT usuarios.id, usuarios.tenant_id, usuarios.nombre, usuarios.email, usuarios.rol
    FROM sessions
    JOIN usuarios ON usuarios.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > datetime('now')
  `).get(hashToken(token)) as User | undefined;

  return row ?? null;
}

export function deleteSession(token?: string) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
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
