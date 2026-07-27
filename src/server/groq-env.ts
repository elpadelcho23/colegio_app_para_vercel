/**
 * Lee GROQ_API_KEY desde el entorno del servidor.
 * En Vercel: Settings → Environment Variables → GROQ_API_KEY
 * En local: archivo .env (no se sube al repo)
 */
export function getGroqApiKey(): string | null {
  // Vercel inyecta process.env en runtime (API routes / SSR).
  const fromProcess = typeof process !== 'undefined' ? process.env.GROQ_API_KEY : undefined;
  const fromAstro = typeof import.meta !== 'undefined'
    ? (import.meta.env.GROQ_API_KEY as string | undefined)
    : undefined;
  const key = String(fromProcess || fromAstro || '').trim();
  return key || null;
}

export function requireGroqApiKey(): string {
  const key = getGroqApiKey();
  if (!key) {
    throw new Error(
      'GROQ_API_KEY no está configurada. En Vercel: Settings → Environment Variables. En local: archivo .env',
    );
  }
  return key;
}
