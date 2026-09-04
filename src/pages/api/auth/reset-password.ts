import type { APIRoute } from 'astro';
import { consumePasswordResetToken } from '../../../server/auth-email';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const token = String(form.get('token') || '').trim();
  const password = String(form.get('password') || '');
  const confirm = String(form.get('confirm') || '');

  if (!token) return redirect('/reset-password?status=missing', 303);
  if (!password || password !== confirm) {
    return redirect(`/reset-password?token=${encodeURIComponent(token)}&status=mismatch`, 303);
  }

  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) {
    if (result.reason === 'weak_password') {
      return redirect(`/reset-password?token=${encodeURIComponent(token)}&status=weak`, 303);
    }
    return redirect(`/reset-password?status=${result.reason}`, 303);
  }

  return redirect('/login?reset=1', 303);
};
