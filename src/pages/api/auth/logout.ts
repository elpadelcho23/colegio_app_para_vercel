import type { APIRoute } from 'astro';
import {
  cookieOptions,
  deleteSession,
  getUserFromToken,
  SESSION_PASSPORT_COOKIE,
  SESSION_COOKIE,
} from '../../../server/auth';
import { purgeGuestAccount, purgeExpiredGuestAccounts } from '../../../server/db';
import { readSessionPassport } from '../../../server/guest-passport';

export const POST: APIRoute = ({ cookies, url, redirect, request }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const passport = readSessionPassport(token, cookies.get(SESSION_PASSPORT_COOKIE)?.value);
  const user = getUserFromToken(token);
  const guestUserId = user?.is_guest ? user.id : (passport?.isGuest ? passport.userId : undefined);
  const guestTenantId = user?.is_guest ? user.tenant_id : (passport?.isGuest ? passport.tenantId : undefined);

  deleteSession(token);
  cookies.delete(SESSION_COOKIE, cookieOptions(url));
  cookies.delete(SESSION_PASSPORT_COOKIE, cookieOptions(url));
  // legacy cookie name (por si quedó de deploys previos)
  cookies.delete('aula_clara_guest_passport', cookieOptions(url));

  if (guestUserId) {
    try {
      purgeGuestAccount(guestUserId, guestTenantId);
    } catch {
      // best-effort
    }
  }

  try {
    purgeExpiredGuestAccounts();
  } catch {
    // best-effort
  }

  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/json') || request.headers.get('x-aula-clara-guest-exit') === '1') {
    return new Response(null, { status: 204 });
  }

  return redirect('/login?guest_cleared=1', 303);
};
