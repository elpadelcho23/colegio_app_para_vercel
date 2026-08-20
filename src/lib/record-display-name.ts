/** IDs de cliente (`uid('curso')` → curso-1786585406359-2a8cc54d…). */
const GENERATED_ID_RE = /^(curso|mat|esc|al)-[0-9]{10,}-[0-9a-f]+$/i;

export function looksLikeGeneratedRecordId(value: unknown) {
  return GENERATED_ID_RE.test(String(value || '').trim());
}

export function isUsableDisplayName(id: string, nombre: unknown) {
  const name = String(nombre || '').trim();
  if (!name) return false;
  if (name === String(id || '').trim()) return false;
  if (looksLikeGeneratedRecordId(name)) return false;
  return true;
}

export function preferredDisplayName(id: string, nombre: unknown, fallback = '') {
  const name = String(nombre || '').trim();
  if (isUsableDisplayName(id, name)) return name;
  return fallback;
}

export function pickBetterRecordName(id: string, ...candidates: unknown[]) {
  for (const candidate of candidates) {
    if (isUsableDisplayName(id, candidate)) return String(candidate).trim();
  }
  return '';
}
