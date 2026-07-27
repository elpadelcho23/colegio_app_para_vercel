import type { APIRoute } from 'astro';
import {
  cookieOptions,
  deleteSession,
  getUserFromToken,
  GUEST_PASSPORT_COOKIE,
  SESSION_COOKIE,
} from '../../../server/auth';
import { purgeGuestAccount, purgeExpiredGuestAccounts } from '../../../server/db';
import { readGuestPassport } from '../../../server/guest-passport';

export const POST: APIRoute = ({ cookies, url, redirect, request }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const passport = readGuestPassport(token, cookies.get(GUEST_PASSPORT_COOKIE)?.value);
  const user = getUserFromToken(token);
  const guestUserId = user?.is_guest ? user.id : passport?.userId;
  const guestTenantId = user?.is_guest ? user.tenant_id : passport?.tenantId;

  deleteSession(token);
  cookies.delete(SESSION_COOKIE, cookieOptions(url));
  cookies.delete(GUEST_PASSPORT_COOKIE, cookieOptions(url));

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

  // sendBeacon / fetch keepalive: prefer 204 over redirect
  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/json') || request.headers.get('x-aula-clara-guest-exit') === '1') {
    return new Response(null, { status: 204 });
  }

  return redirect('/login?guest_cleared=1', 303);
};
