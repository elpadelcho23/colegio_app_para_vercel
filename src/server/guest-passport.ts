import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { User } from './db';
import { db, seedGuestDemoData } from './db';

/** Cookie firmada para rehidratar usuario+sesión en otra instancia de Vercel (/tmp SQLite). */
export const SESSION_PASSPORT_COOKIE = 'aula_clara_session_passport';
/** Alias legacy (invitados viejos). */
export const GUEST_PASSPORT_COOKIE = SESSION_PASSPORT_COOKIE;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

type SessionPassportPayload = {
  v: 1;
  userId: string;
  tenantId: string;
  email: string;
  nombre: string;
  rol: 'admin' | 'docente';
  isGuest: boolean;
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

export function createSessionPassportCookieValue(input: {
  user: User;
  sessionToken: string;
  expiresAt: Date;
}) {
  const payload: SessionPassportPayload = {
    v: 1,
    userId: input.user.id,
    tenantId: input.user.tenant_id,
    email: input.user.email,
    nombre: input.user.nombre,
    rol: input.user.rol,
    isGuest: Boolean(input.user.is_guest),
    tokenHash: hashToken(input.sessionToken),
    exp: input.expiresAt.getTime(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** @deprecated use createSessionPassportCookieValue */
export const createGuestPassportCookieValue = createSessionPassportCookieValue;

function verifyPassport(raw?: string): SessionPassportPayload | null {
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
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPassportPayload;
    if (payload?.v !== 1 || !payload.userId || !payload.tenantId || !payload.tokenHash) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    if (payload.rol !== 'admin' && payload.rol !== 'docente') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Lee el passport sin tocar la DB (útil en logout). */
export function readSessionPassport(
  sessionToken: string | undefined,
  passportCookie: string | undefined,
): SessionPassportPayload | null {
  if (!sessionToken) return null;
  const passport = verifyPassport(passportCookie);
  if (!passport) return null;
  if (passport.tokenHash !== hashToken(sessionToken)) return null;
  return passport;
}

/** @deprecated use readSessionPassport */
export const readGuestPassport = readSessionPassport;

/**
 * En Vercel el SQLite de /tmp no se comparte entre instancias.
 * Si la cookie de sesión existe pero la fila no está en esta instancia,
 * recreamos tenant/usuario/sesión desde el passport firmado.
 */
export async function rehydrateUserFromPassport(
  sessionToken: string | undefined,
  passportCookie: string | undefined,
): Promise<User | null> {
  if (!sessionToken) return null;
  const passport = verifyPassport(passportCookie);
  if (!passport) return null;
  if (passport.tokenHash !== hashToken(sessionToken)) return null;

  const expiresAt = new Date(passport.exp).toISOString();
  const isGuest = Boolean(passport.isGuest);

  const tx = db.transaction(async () => {
    await db.prepare(`
      INSERT OR IGNORE INTO tenants (id, nombre)
      VALUES (?, ?)
    `).run(
      passport.tenantId,
      isGuest
        ? `Invitado ${passport.userId.replace(/^guest-/, '')}`
        : `Cuenta ${passport.nombre || passport.email}`,
    );

    await db.prepare(`
      INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol, is_guest)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        nombre = excluded.nombre,
        email = excluded.email,
        rol = excluded.rol,
        is_guest = excluded.is_guest
    `).run(
      passport.userId,
      passport.tenantId,
      passport.nombre || (isGuest ? 'Invitado' : 'Docente'),
      passport.email,
      isGuest ? '$guest$' : '$passport$',
      passport.rol,
      isGuest ? 1 : 0,
    );

    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(passport.userId);
    await db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(
      `sess-${passport.userId}`,
      passport.userId,
      passport.tokenHash,
      expiresAt,
    );
  });

  await tx();

  const user: User = {
    id: passport.userId,
    tenant_id: passport.tenantId,
    nombre: passport.nombre || (isGuest ? 'Invitado' : 'Docente'),
    email: passport.email,
    rol: passport.rol,
    is_guest: isGuest,
    // Passport legacy no incluye verified_at; se rehidrata desde DB si existe.
    email_verified_at: null,
  };

  if (!isGuest) {
    try {
      const row = (await db.prepare(`
        SELECT email_verified_at FROM usuarios WHERE id = ?
      `).get(user.id)) as { email_verified_at: string | null } | undefined;
      user.email_verified_at = row?.email_verified_at || null;
    } catch {
      // best-effort
    }
  }

  if (isGuest) {
    try {
      await seedGuestDemoData(user);
    } catch {
      // best-effort
    }
  }

  return user;
}

/** @deprecated use rehydrateUserFromPassport */
export const rehydrateGuestFromPassport = rehydrateUserFromPassport;
