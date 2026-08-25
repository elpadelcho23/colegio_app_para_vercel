import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
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

export { CLIENT_DATA_STORAGE } from '../lib/client-storage-keys';

function buildSessionBootstrapScript(_userId: string, redirectTo: string, mode: 'login' | 'register' | 'guest') {
  return `(function () {
  var redirectTo = ${JSON.stringify(redirectTo)};
  var mode = ${JSON.stringify(mode)};

  function wipeStaleAulaClaraKeys() {
    var keep = { aula_clara_theme: 1, aula_clara_offline_reset_v2: 1, aula_clara_offline_reset_v3: 1 };
    var remove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || keep[key]) continue;
      if (key.indexOf('aula_clara_students') === 0
        || key.indexOf('aula_clara_courses') === 0
        || key.indexOf('aula_clara_schools') === 0
        || key.indexOf('aula_clara_subjects') === 0
        || key.indexOf('aula_clara_attendance') === 0
        || key.indexOf('aula_clara_grades') === 0
        || key.indexOf('aula_clara_dashboard_filters') === 0
        || key.indexOf('aula_clara_teacher_context') === 0
        || key.indexOf(':guest-') !== -1) {
        remove.push(key);
      }
    }
    remove.forEach(function (key) { localStorage.removeItem(key); });
  }

  wipeStaleAulaClaraKeys();
  if (mode === 'guest') {
    try {
      ['aula_clara_recovery_draft','aula_clara_curriculum_context','aula_clara_ai_extra_prompt','aula_clara_has_activity']
        .forEach(function (key) { sessionStorage.removeItem(key); });
    } catch (e) {}
  }
  window.location.replace(redirectTo);
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

async function respondWithSessionHtml(
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
  const session = await rotateSession(userId, previousToken, options);

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

  const user = await getUserById(userId);
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

export async function respondWithLoginSession(
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

export async function respondWithFreshSession(
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

export async function respondWithGuestSession(
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

export async function createSession(userId: string, options: SessionOptions = {}) {
  const token = randomBytes(32).toString('base64url');
  const ttlMs = options.sessionOnly
    ? GUEST_SESSION_HOURS * 60 * 60 * 1000
    : SESSION_DAYS * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const id = `sess-${randomBytes(16).toString('hex')}`;

  await db.prepare(`
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

export async function verifyLogin(email: string, password: string): Promise<User | null> {
  const row = (await db.prepare(`
    SELECT id, tenant_id, nombre, email, password_hash, rol, COALESCE(is_guest, 0) AS is_guest
    FROM usuarios
    WHERE lower(email) = lower(?)
  `).get(email)) as (Omit<User, 'is_guest'> & { password_hash: string; is_guest: number }) | undefined;

  if (!row || !bcrypt.compareSync(password, row.password_hash)) return null;
  return mapUserRow(row);
}

export async function getUserFromToken(token?: string): Promise<User | null> {
  if (!token) return null;

  const row = (await db.prepare(`
    SELECT usuarios.id, usuarios.tenant_id, usuarios.nombre, usuarios.email, usuarios.rol,
           COALESCE(usuarios.is_guest, 0) AS is_guest
    FROM sessions
    JOIN usuarios ON usuarios.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > datetime('now')
  `).get(hashToken(token))) as (Omit<User, 'is_guest'> & { is_guest: number }) | undefined;

  return row ? mapUserRow(row) : null;
}

export async function deleteSession(token?: string) {
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** Invalida la sesión previa (si existía) y emite un token nuevo — mitiga session fixation. */
export async function rotateSession(userId: string, previousToken?: string, options: SessionOptions = {}) {
  if (previousToken) await deleteSession(previousToken);
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

export async function canAccessStudent(user: User, studentId: string) {
  if (user.rol === 'admin') return true;
  const row = await db.prepare(`
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

export async function canAccessSubject(user: User, subjectId: string) {
  if (user.rol === 'admin') return true;
  const row = await db.prepare(`
    SELECT materia_id
    FROM docente_materias
    WHERE materia_id = ?
      AND docente_id = ?
      AND tenant_id = ?
  `).get(subjectId, user.id, user.tenant_id);
  return Boolean(row);
}

export async function canAccessCourse(user: User, courseId: string) {
  if (user.rol === 'admin') return true;
  const row = await db.prepare(`
    SELECT curso_id
    FROM docente_cursos
    WHERE curso_id = ?
      AND docente_id = ?
      AND tenant_id = ?
  `).get(courseId, user.id, user.tenant_id);
  return Boolean(row);
}
