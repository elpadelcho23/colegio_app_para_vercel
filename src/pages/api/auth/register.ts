import type { APIRoute } from 'astro';
import { createUser } from '../../../server/db';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const nombre = String(form.get('nombre') || '').trim();
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const confirm = String(form.get('confirm') || '');

  if (!nombre || !email || !password || password !== confirm) {
    return redirect('/register?error=1', 303);
  }

  const user = createUser({ nombre, email, password, rol: 'docente' });
  if (!user) {
    return redirect('/register?error=2', 303);
  }

  return redirect('/login?registered=1', 303);
};