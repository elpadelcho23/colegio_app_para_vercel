import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { isStrongPassword } from '../../../server/auth';
import { createTenant, createUser } from '../../../server/db';
import { issueEmailVerification, validateEmailFormat } from '../../../server/auth-email';

export const POST: APIRoute = async ({ request, url, redirect }) => {
  const form = await request.formData();
  const nombre = String(form.get('nombre') || '').trim();
  const email = validateEmailFormat(String(form.get('email') || ''));
  const password = String(form.get('password') || '');
  const confirm = String(form.get('confirm') || '');

  if (!nombre || !email || !password || password !== confirm) {
    return redirect('/register?error=1', 303);
  }

  if (!isStrongPassword(password)) {
    return redirect('/register?error=3', 303);
  }

  const tenantId = randomUUID();
  await createTenant(`Institución de ${nombre}`, tenantId);

  const user = await createUser({
    nombre,
    email,
    password,
    rol: 'admin',
    tenant_id: tenantId,
    markEmailVerified: false,
  });

  if (!user) {
    return redirect('/register?error=2', 303);
  }

  // No auto-login: el email debe verificarse primero.
  await issueEmailVerification(user, url.origin);

  return redirect(`/login?verify=1&email=${encodeURIComponent(email)}`, 303);
};
