import type { APIRoute } from 'astro';
import { resendEmailVerification } from '../../../server/auth-email';

const GENERIC_OK = 'Si el email está registrado y pendiente de verificación, te enviamos un enlace.';

export const POST: APIRoute = async ({ request, url, redirect }) => {
  const contentType = request.headers.get('content-type') || '';
  let email = '';

  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    email = String((body as { email?: string }).email || '');
  } else {
    const form = await request.formData();
    email = String(form.get('email') || '');
  }

  await resendEmailVerification(email, url.origin);

  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/json') || contentType.includes('application/json')) {
    return Response.json({ ok: true, message: GENERIC_OK });
  }

  const nextEmail = encodeURIComponent(String(email || '').trim().toLowerCase());
  return redirect(`/login?resent=1&email=${nextEmail}`, 303);
};
