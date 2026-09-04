import type { APIRoute } from 'astro';
import { isEmailVerified, respondWithLoginSession, verifyLogin } from '../../../server/auth';
import { normalizeEmail } from '../../../server/auth-email';

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const form = await request.formData();
  const email = normalizeEmail(String(form.get('email') || ''));
  const password = String(form.get('password') || '');
  const user = await verifyLogin(email, password);

  if (!user) return redirect('/login?error=1', 303);

  if (!isEmailVerified(user)) {
    return redirect(`/login?unverified=1&email=${encodeURIComponent(user.email)}`, 303);
  }

  return respondWithLoginSession(user.id, cookies, url);
};
