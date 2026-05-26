import type { APIRoute } from 'astro';
import { cookieOptions, createSession, SESSION_COOKIE, verifyLogin } from '../../../server/auth';

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const user = verifyLogin(email, password);

  if (!user) return redirect('/login?error=1', 303);

  const session = createSession(user.id);
  cookies.set(SESSION_COOKIE, session.token, {
    ...cookieOptions(url),
    expires: session.expiresAt,
  });

  return redirect('/', 303);
};
