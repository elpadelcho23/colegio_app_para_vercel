import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { db, type User } from './db';

export const SESSION_COOKIE = 'aula_clara_session';
const SESSION_DAYS = 7;

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
    sameSite: 'lax' as const,
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
