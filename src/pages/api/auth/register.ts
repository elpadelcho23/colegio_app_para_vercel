import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { isStrongPassword } from '../../../server/auth';
import { createTenant, createUser } from '../../../server/db';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const nombre = String(form.get('nombre') || '').trim();
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const confirm = String(form.get('confirm') || '');

  if (!nombre || !email || !password || password !== confirm) {
    return redirect('/register?error=1', 303);
  }

  if (!isStrongPassword(password)) {
    return redirect('/register?error=3', 303);
  }

  const tenantId = randomUUID();
  createTenant(`Institución de ${nombre}`, tenantId);

  const user = createUser({
    nombre,
    email,
    password,
    rol: 'admin',
    tenant_id: tenantId,
  });

  if (!user) {
    return redirect('/register?error=2', 303);
  }

  return redirect('/login?registered=1', 303);
};
