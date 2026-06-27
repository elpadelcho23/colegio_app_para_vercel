import type { APIRoute } from 'astro';
import { respondWithLoginSession, verifyLogin } from '../../../server/auth';

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const user = verifyLogin(email, password);

  if (!user) return redirect('/login?error=1', 303);

  return respondWithLoginSession(user.id, cookies, url);
};
