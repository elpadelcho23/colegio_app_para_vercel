import type { APIRoute } from 'astro';
import { consumeEmailVerificationToken } from '../../../server/auth-email';

export const GET: APIRoute = async ({ url, redirect }) => {
  const token = String(url.searchParams.get('token') || '').trim();
  if (!token) return redirect('/verify-email?status=missing', 303);

  const result = await consumeEmailVerificationToken(token);
  if (!result.ok) {
    return redirect(`/verify-email?status=${result.reason}`, 303);
  }

  return redirect('/login?verified=1', 303);
};

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const token = String(form.get('token') || '').trim();
  if (!token) return redirect('/verify-email?status=missing', 303);

  const result = await consumeEmailVerificationToken(token);
  if (!result.ok) {
    return redirect(`/verify-email?status=${result.reason}`, 303);
  }

  return redirect('/login?verified=1', 303);
};
