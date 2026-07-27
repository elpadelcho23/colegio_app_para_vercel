import type { APIRoute } from 'astro';
import { respondWithGuestSession } from '../../../server/auth';
import { createGuestUser, purgeExpiredGuestAccounts } from '../../../server/db';

export const POST: APIRoute = async ({ cookies, url }) => {
  try {
    await purgeExpiredGuestAccounts();
  } catch {
    // best-effort cleanup; guest login must still proceed
  }

  const user = await createGuestUser();
  return respondWithGuestSession(user.id, cookies, url);
};
