#!/usr/bin/env node
/**
 * Verificación Fase 1: email verification + password reset.
 * Uso: npx tsx scripts/verify-auth-email.ts
 */
import { createHash, randomBytes } from 'node:crypto';
import { ensureDbReady, createTenant, createUser, db, getUserById } from '../src/server/db.ts';
import {
  issueEmailVerification,
  issuePasswordReset,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  resendEmailVerification,
} from '../src/server/auth-email.ts';
import { verifyLogin, isEmailVerified } from '../src/server/auth.ts';

process.env.RESEND_API_KEY = '';
process.env.APP_URL = process.env.APP_URL || 'http://localhost:4321';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hashToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

async function insertKnownToken(userId: string, table: string, raw: string, ttlMs: number) {
  const id = `tok-test-${randomBytes(6).toString('hex')}`;
  await db.prepare(`
    UPDATE ${table} SET used_at = ? WHERE user_id = ? AND used_at IS NULL
  `).run(new Date().toISOString(), userId);
  await db.prepare(`
    INSERT INTO ${table} (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    hashToken(raw),
    new Date(Date.now() + ttlMs).toISOString(),
    new Date().toISOString(),
  );
  return raw;
}

async function main() {
  await ensureDbReady();
  const suffix = randomBytes(4).toString('hex');
  const email = `fase1-${suffix}@example.com`;
  const password = 'Clave123';
  const tenantId = `tenant-fase1-${suffix}`;
  await createTenant(`Institucion test ${suffix}`, tenantId);

  const user = await createUser({
    nombre: 'Docente Fase1',
    email,
    password,
    rol: 'admin',
    tenant_id: tenantId,
    markEmailVerified: false,
  });
  assert(user, '1. createUser debe crear usuario');
  assert(!user.email_verified_at, '2. email no verificado al crear');

  const loginUnverified = await verifyLogin(email, password);
  assert(loginUnverified, '2b. credenciales válidas');
  assert(!isEmailVerified(loginUnverified), '2c. isEmailVerified=false');

  const issued = await issueEmailVerification(user, 'http://localhost:4321');
  assert(issued.ok, '3. issueEmailVerification ok');

  const rawOk = `raw-ok-${suffix}`;
  await insertKnownToken(user.id, 'email_verification_tokens', rawOk, 24 * 3600 * 1000);
  const verified = await consumeEmailVerificationToken(rawOk);
  assert(verified.ok, '4. consume verification ok');
  const afterVerify = await getUserById(user.id);
  assert(afterVerify?.email_verified_at, '4b. email_verified_at seteado');

  const reused = await consumeEmailVerificationToken(rawOk);
  assert(!reused.ok && reused.reason === 'used', '5. token reutilizado → used');

  const rawExpired = `raw-exp-${suffix}`;
  await insertKnownToken(user.id, 'email_verification_tokens', rawExpired, -1000);
  const expired = await consumeEmailVerificationToken(rawExpired);
  assert(!expired.ok && expired.reason === 'expired', '6. token expirado');

  const invalid = await consumeEmailVerificationToken('token-inexistente');
  assert(!invalid.ok && invalid.reason === 'invalid', '7. token inválido');

  const resent = await resendEmailVerification(email);
  assert(resent.ok, '8. resend ok');
  const resentGhost = await resendEmailVerification('no-existe@example.com');
  assert(resentGhost.ok, '8b. resend email inexistente también ok (anti-enumeración)');

  const forgot1 = await issuePasswordReset(email);
  assert(forgot1.ok, '9. forgot existente ok');
  const forgot2 = await issuePasswordReset('ghost-user@example.com');
  assert(forgot2.ok, '9b. forgot inexistente ok (anti-enumeración)');

  const rawReset = `reset-ok-${suffix}`;
  await insertKnownToken(user.id, 'password_reset_tokens', rawReset, 3600 * 1000);
  await db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(
    `sess-prev-${suffix}`,
    user.id,
    hashToken('prev-session'),
    new Date(Date.now() + 86400000).toISOString(),
  );

  const newPassword = 'Nueva456';
  const resetOk = await consumePasswordResetToken(rawReset, newPassword);
  assert(resetOk.ok, '10. reset válido');

  const resetReuse = await consumePasswordResetToken(rawReset, 'Otra789');
  assert(!resetReuse.ok && resetReuse.reason === 'used', '11. reset reutilizado');

  const loginNew = await verifyLogin(email, newPassword);
  assert(loginNew && isEmailVerified(loginNew), '12. login post-reset');

  const loginOld = await verifyLogin(email, password);
  assert(!loginOld, '13. password anterior inválida');

  const sessions = await db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?').get(user.id) as { c: number };
  assert(Number(sessions.c) === 0, '14. sesiones invalidadas tras reset');

  const rawWeak = `reset-weak-${suffix}`;
  await insertKnownToken(user.id, 'password_reset_tokens', rawWeak, 3600 * 1000);
  const weak = await consumePasswordResetToken(rawWeak, '123');
  assert(!weak.ok && weak.reason === 'weak_password', '15. password débil rechazada');

  const sample = await db.prepare(`
    SELECT token_hash FROM email_verification_tokens WHERE user_id = ? LIMIT 1
  `).get(user.id) as { token_hash: string } | undefined;
  assert(sample?.token_hash && sample.token_hash.length === 64, 'tokens hasheados SHA-256');

  console.log('OK: Fase 1 auth email/password — 15 checks pasaron.');
}

main().catch((error) => {
  console.error('FAIL:', error);
  process.exit(1);
});
