import type { APIRoute } from 'astro';
import { isStrongPassword, respondWithFreshSession } from '../../../server/auth';
import { createUser } from '../../../server/db';

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const form = await request.formData();
  const nombre = String(form.get('nombre') || '').trim();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  const confirm = String(form.get('confirm') || '');

  if (!nombre || !email || !password || password !== confirm || !isStrongPassword(password)) {
    return redirect('/register?error=1', 303);
  }

  const user = createUser({ nombre, email, password, rol: 'docente' });
  if (!user) {
    return redirect('/register?error=2', 303);
  }

  return respondWithFreshSession(user.id, cookies, url);
};