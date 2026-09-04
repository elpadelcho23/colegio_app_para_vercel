/**
 * Abstracción de envío de email.
 * - Producción: Resend (RESEND_API_KEY)
 * - Desarrollo / sin API key: log seguro en consola (incluye link para pruebas)
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = {
  ok: boolean;
  provider: 'resend' | 'console';
  id?: string;
  error?: string;
};

function emailFrom() {
  return (
    process.env.EMAIL_FROM?.trim()
    || process.env.RESEND_FROM?.trim()
    || 'Aula Clara <onboarding@resend.dev>'
  );
}

export function appBaseUrl(fallbackOrigin = 'http://localhost:4321') {
  const configured = process.env.APP_URL?.trim() || process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.VERCEL_URL?.trim()) {
    const host = process.env.VERCEL_URL.trim().replace(/^https?:\/\//, '');
    return `https://${host}`;
  }
  return fallbackOrigin.replace(/\/$/, '');
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = String(input.to || '').trim().toLowerCase();
  if (!to || !input.subject || (!input.html && !input.text)) {
    return { ok: false, provider: apiKey ? 'resend' : 'console', error: 'Email inválido.' };
  }

  if (!apiKey) {
    console.info('[email:console]', {
      to,
      subject: input.subject,
      text: input.text,
    });
    return { ok: true, provider: 'console', id: `console-${Date.now()}` };
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: emailFrom(),
      to: [to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (result.error) {
      console.error('[email:resend] error', result.error);
      return { ok: false, provider: 'resend', error: result.error.message || 'Error de envío' };
    }

    return { ok: true, provider: 'resend', id: result.data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[email:resend] exception', message);
    return { ok: false, provider: 'resend', error: message };
  }
}
