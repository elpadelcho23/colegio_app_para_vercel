import type { APIRoute } from 'astro';
import { cookieOptions, rotateSession, SESSION_COOKIE, verifyLogin } from '../../../server/auth';

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const user = verifyLogin(email, password);

  if (!user) return redirect('/login?error=1', 303);

  const previousToken = cookies.get(SESSION_COOKIE)?.value;
  const session = rotateSession(user.id, previousToken);

  if (previousToken) {
    cookies.delete(SESSION_COOKIE, cookieOptions(url));
  }

  cookies.set(SESSION_COOKIE, session.token, {
    ...cookieOptions(url),
    expires: session.expiresAt,
  });

  return redirect('/', 303);
};
