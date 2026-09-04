import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, type User } from './db';
import { appBaseUrl, sendEmail } from './email';
import { isStrongPassword } from './auth';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

export type AuthTokenKind = 'email_verification' | 'password_reset';

function hashToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

function generateRawToken() {
  return randomBytes(32).toString('base64url');
}

function nowIso() {
  return new Date().toISOString();
}

function expiresIso(ttlMs: number) {
  return new Date(Date.now() + ttlMs).toISOString();
}

function isValidEmailFormat(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase();
}

export function validateEmailFormat(email: string) {
  const value = normalizeEmail(email);
  if (!value || !isValidEmailFormat(value)) return null;
  return value;
}

async function invalidateOpenTokens(userId: string, kind: AuthTokenKind) {
  const table = kind === 'email_verification' ? 'email_verification_tokens' : 'password_reset_tokens';
  await db.prepare(`
    UPDATE ${table}
    SET used_at = ?
    WHERE user_id = ?
      AND used_at IS NULL
  `).run(nowIso(), userId);
}

async function recentlyIssued(userId: string, kind: AuthTokenKind) {
  const table = kind === 'email_verification' ? 'email_verification_tokens' : 'password_reset_tokens';
  const row = (await db.prepare(`
    SELECT created_at
    FROM ${table}
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId)) as { created_at?: string } | undefined;
  if (!row?.created_at) return false;
  const created = new Date(row.created_at).getTime();
  return Number.isFinite(created) && Date.now() - created < RESEND_COOLDOWN_MS;
}

async function createToken(userId: string, kind: AuthTokenKind, ttlMs: number) {
  await invalidateOpenTokens(userId, kind);
  const raw = generateRawToken();
  const id = `tok-${randomBytes(12).toString('hex')}`;
  const table = kind === 'email_verification' ? 'email_verification_tokens' : 'password_reset_tokens';
  await db.prepare(`
    INSERT INTO ${table} (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, hashToken(raw), expiresIso(ttlMs), nowIso());
  return raw;
}

async function findUserByEmail(email: string) {
  const row = (await db.prepare(`
    SELECT id, tenant_id, nombre, email, rol,
           COALESCE(is_guest, 0) AS is_guest,
           email_verified_at
    FROM usuarios
    WHERE lower(email) = lower(?)
  `).get(email)) as {
    id: string;
    tenant_id: string;
    nombre: string;
    email: string;
    rol: 'admin' | 'docente';
    is_guest: number;
    email_verified_at: string | null;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    nombre: row.nombre,
    email: row.email,
    rol: row.rol,
    is_guest: Boolean(row.is_guest),
    email_verified_at: row.email_verified_at || null,
  } as User;
}

function verificationEmailContent(nombre: string, link: string) {
  const greeting = nombre ? `Hola ${nombre},` : 'Hola,';
  const text = `${greeting}

Confirmá tu email para activar tu cuenta en Aula Clara:

${link}

Este enlace vence en 24 horas. Si no creaste esta cuenta, ignorá este mensaje.

— Equipo Aula Clara`;

  const html = `
    <p>${greeting}</p>
    <p>Confirmá tu email para activar tu cuenta en <strong>Aula Clara</strong>.</p>
    <p><a href="${link}">Verificar email</a></p>
    <p>O copiá este enlace:<br /><code>${link}</code></p>
    <p>Este enlace vence en 24 horas. Si no creaste esta cuenta, ignorá este mensaje.</p>
    <p>— Equipo Aula Clara</p>
  `;
  return { subject: 'Verificá tu email — Aula Clara', text, html };
}

function resetEmailContent(nombre: string, link: string) {
  const greeting = nombre ? `Hola ${nombre},` : 'Hola,';
  const text = `${greeting}

Recibimos un pedido para restablecer tu contraseña de Aula Clara:

${link}

Este enlace vence en 1 hora. Si no lo pediste, ignorá este mensaje.

— Equipo Aula Clara`;

  const html = `
    <p>${greeting}</p>
    <p>Recibimos un pedido para restablecer tu contraseña de <strong>Aula Clara</strong>.</p>
    <p><a href="${link}">Elegir nueva contraseña</a></p>
    <p>O copiá este enlace:<br /><code>${link}</code></p>
    <p>Este enlace vence en 1 hora. Si no lo pediste, ignorá este mensaje.</p>
    <p>— Equipo Aula Clara</p>
  `;
  return { subject: 'Restablecer contraseña — Aula Clara', text, html };
}

export async function issueEmailVerification(user: User, origin?: string) {
  if (user.is_guest) return { ok: true as const, skipped: true as const };
  if (user.email_verified_at) return { ok: true as const, alreadyVerified: true as const };
  if (await recentlyIssued(user.id, 'email_verification')) {
    return { ok: true as const, cooldown: true as const };
  }

  const raw = await createToken(user.id, 'email_verification', VERIFY_TTL_MS);
  const link = `${appBaseUrl(origin)}/api/auth/verify-email?token=${encodeURIComponent(raw)}`;
  const content = verificationEmailContent(user.nombre, link);
  const sent = await sendEmail({
    to: user.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  return { ok: sent.ok, provider: sent.provider, error: sent.error, link: sent.provider === 'console' ? link : undefined };
}

export async function issuePasswordReset(emailRaw: string, origin?: string) {
  const email = validateEmailFormat(emailRaw);
  // Respuesta siempre genérica para el caller; no revelar existencia.
  if (!email) return { ok: true as const };

  const user = await findUserByEmail(email);
  if (!user || user.is_guest) return { ok: true as const };
  if (await recentlyIssued(user.id, 'password_reset')) return { ok: true as const };

  const raw = await createToken(user.id, 'password_reset', RESET_TTL_MS);
  const link = `${appBaseUrl(origin)}/reset-password?token=${encodeURIComponent(raw)}`;
  const content = resetEmailContent(user.nombre, link);
  await sendEmail({
    to: user.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  return { ok: true as const, debugLink: process.env.RESEND_API_KEY ? undefined : link };
}

export async function consumeEmailVerificationToken(rawToken: string) {
  const token = String(rawToken || '').trim();
  if (!token) return { ok: false as const, reason: 'missing' as const };

  const row = (await db.prepare(`
    SELECT id, user_id, expires_at, used_at
    FROM email_verification_tokens
    WHERE token_hash = ?
  `).get(hashToken(token))) as {
    id: string;
    user_id: string;
    expires_at: string;
    used_at: string | null;
  } | undefined;

  if (!row) return { ok: false as const, reason: 'invalid' as const };
  if (row.used_at) return { ok: false as const, reason: 'used' as const };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false as const, reason: 'expired' as const };
  }

  const verifiedAt = nowIso();
  const tx = db.transaction(async () => {
    await db.prepare(`
      UPDATE email_verification_tokens
      SET used_at = ?
      WHERE id = ? AND used_at IS NULL
    `).run(verifiedAt, row.id);

    await db.prepare(`
      UPDATE usuarios
      SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?
      WHERE id = ?
    `).run(verifiedAt, verifiedAt, row.user_id);

    await invalidateOpenTokens(row.user_id, 'email_verification');
  });
  await tx();

  return { ok: true as const, userId: row.user_id };
}

export async function consumePasswordResetToken(rawToken: string, newPassword: string) {
  const token = String(rawToken || '').trim();
  if (!token) return { ok: false as const, reason: 'missing' as const };
  if (!isStrongPassword(newPassword)) return { ok: false as const, reason: 'weak_password' as const };

  const row = (await db.prepare(`
    SELECT id, user_id, expires_at, used_at
    FROM password_reset_tokens
    WHERE token_hash = ?
  `).get(hashToken(token))) as {
    id: string;
    user_id: string;
    expires_at: string;
    used_at: string | null;
  } | undefined;

  if (!row) return { ok: false as const, reason: 'invalid' as const };
  if (row.used_at) return { ok: false as const, reason: 'used' as const };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false as const, reason: 'expired' as const };
  }

  const updatedAt = nowIso();
  const passwordHash = bcrypt.hashSync(newPassword, 12);

  const tx = db.transaction(async () => {
    await db.prepare(`
      UPDATE password_reset_tokens
      SET used_at = ?
      WHERE id = ? AND used_at IS NULL
    `).run(updatedAt, row.id);

    await db.prepare(`
      UPDATE usuarios
      SET password_hash = ?, updated_at = ?, email_verified_at = COALESCE(email_verified_at, ?)
      WHERE id = ?
    `).run(passwordHash, updatedAt, updatedAt, row.user_id);

    await invalidateOpenTokens(row.user_id, 'password_reset');
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  });
  await tx();

  return { ok: true as const, userId: row.user_id };
}

export async function resendEmailVerification(emailRaw: string, origin?: string) {
  const email = validateEmailFormat(emailRaw);
  // Respuesta genérica para no filtrar existencia.
  if (!email) return { ok: true as const };

  const user = await findUserByEmail(email);
  if (!user || user.is_guest) return { ok: true as const };
  if (user.email_verified_at) return { ok: true as const, alreadyVerified: true as const };

  await issueEmailVerification(user, origin);
  return { ok: true as const };
}

export { findUserByEmail };
