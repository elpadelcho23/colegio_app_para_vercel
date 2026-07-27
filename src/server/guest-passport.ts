import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { User } from './db';
import { db, seedGuestDemoData } from './db';

export const GUEST_PASSPORT_COOKIE = 'aula_clara_guest_passport';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

type GuestPassportPayload = {
  v: 1;
  userId: string;
  tenantId: string;
  email: string;
  nombre: string;
  tokenHash: string;
  exp: number;
};

function authSecret() {
  return (
    process.env.AUTH_SECRET
    || process.env.SESSION_SECRET
    || process.env.VERCEL_PROJECT_ID
    || 'aula-clara-dev-guest-secret'
  );
}

function sign(payloadB64: string) {
  return createHmac('sha256', authSecret()).update(payloadB64).digest('base64url');
}

export function createGuestPassportCookieValue(input: {
  user: User;
  sessionToken: string;
  expiresAt: Date;
}) {
  const payload: GuestPassportPayload = {
    v: 1,
    userId: input.user.id,
    tenantId: input.user.tenant_id,
    email: input.user.email,
    nombre: input.user.nombre,
    tokenHash: hashToken(input.sessionToken),
    exp: input.expiresAt.getTime(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

function verifyPassport(raw?: string): GuestPassportPayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = sign(payloadB64);
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as GuestPassportPayload;
    if (payload?.v !== 1 || !payload.userId || !payload.tenantId || !payload.tokenHash) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Lee el passport sin tocar la DB (útil en logout). */
export function readGuestPassport(
  sessionToken: string | undefined,
  passportCookie: string | undefined,
): GuestPassportPayload | null {
  if (!sessionToken) return null;
  const passport = verifyPassport(passportCookie);
  if (!passport) return null;
  if (passport.tokenHash !== hashToken(sessionToken)) return null;
  return passport;
}

/**
 * En Vercel el SQLite de /tmp no se comparte entre instancias.
 * Si la cookie de sesión existe pero la fila no está en esta instancia,
 * recreamos tenant/usuario/sesión desde el passport firmado del invitado.
 */
export function rehydrateGuestFromPassport(
  sessionToken: string | undefined,
  passportCookie: string | undefined,
): User | null {
  if (!sessionToken) return null;
  const passport = verifyPassport(passportCookie);
  if (!passport) return null;
  if (passport.tokenHash !== hashToken(sessionToken)) return null;

  const expiresAt = new Date(passport.exp).toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO tenants (id, nombre)
      VALUES (?, ?)
    `).run(passport.tenantId, `Invitado ${passport.userId.replace(/^guest-/, '')}`);

    db.prepare(`
      INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol, is_guest)
      VALUES (?, ?, ?, ?, ?, 'docente', 1)
      ON CONFLICT(id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        nombre = excluded.nombre,
        email = excluded.email,
        is_guest = 1
    `).run(
      passport.userId,
      passport.tenantId,
      passport.nombre || 'Invitado',
      passport.email,
      // placeholder: guests never password-login
      '$guest$',
    );

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(passport.userId);
    db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(
      `sess-${passport.userId}`,
      passport.userId,
      passport.tokenHash,
      expiresAt,
    );
  });

  tx();

  const user: User = {
    id: passport.userId,
    tenant_id: passport.tenantId,
    nombre: passport.nombre || 'Invitado',
    email: passport.email,
    rol: 'docente',
    is_guest: true,
  };

  try {
    seedGuestDemoData(user);
  } catch {
    // best-effort: auth must still succeed
  }

  return user;
}
