import type { APIRoute } from 'astro';
import { issuePasswordReset } from '../../../server/auth-email';

const GENERIC_OK =
  'Si el email está registrado, te enviamos un enlace para restablecer la contraseña.';

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

  await issuePasswordReset(email, url.origin);

  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/json') || contentType.includes('application/json')) {
    return Response.json({ ok: true, message: GENERIC_OK });
  }

  return redirect('/forgot-password?sent=1', 303);
};
