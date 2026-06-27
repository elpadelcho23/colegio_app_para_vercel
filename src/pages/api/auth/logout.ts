import type { APIRoute } from 'astro';
import { cookieOptions, deleteSession, SESSION_COOKIE } from '../../../server/auth';

export const POST: APIRoute = ({ cookies, url, redirect }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  deleteSession(token);
  cookies.delete(SESSION_COOKIE, cookieOptions(url));
  return redirect('/login', 303);
};
