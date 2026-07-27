import type { APIRoute } from 'astro';
import {
  cookieOptions,
  deleteSession,
  getUserFromToken,
  GUEST_PASSPORT_COOKIE,
  SESSION_COOKIE,
} from '../../../server/auth';
import { purgeGuestAccount, purgeExpiredGuestAccounts } from '../../../server/db';
import { rehydrateGuestFromPassport } from '../../../server/guest-passport';

export const POST: APIRoute = ({ cookies, url, redirect, request }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  let user = getUserFromToken(token);
  if (!user && token) {
    user = rehydrateGuestFromPassport(token, cookies.get(GUEST_PASSPORT_COOKIE)?.value);
  }

  deleteSession(token);
  cookies.delete(SESSION_COOKIE, cookieOptions(url));
  cookies.delete(GUEST_PASSPORT_COOKIE, cookieOptions(url));

  if (user?.is_guest) {
    try {
      purgeGuestAccount(user.id);
    } catch {
      // best-effort
    }
  }

  try {
    purgeExpiredGuestAccounts();
  } catch {
    // best-effort
  }

  // sendBeacon / fetch keepalive: prefer 204 over redirect
  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/json') || request.headers.get('x-aula-clara-guest-exit') === '1') {
    return new Response(null, { status: 204 });
  }

  return redirect('/login', 303);
};
