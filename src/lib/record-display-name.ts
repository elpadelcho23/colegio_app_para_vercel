/** IDs de cliente (`uid('curso')` → curso-1786585406359-2a8cc54d…). */
const GENERATED_ID_RE = /^(curso|mat|esc|al)-[0-9]{10,}-[0-9a-f]+$/i;
const UUID_ID_RE = /^(curso|mat|esc|al)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WELL_KNOWN_SUBJECT_NAMES: Record<string, string> = {
  matematica: 'Matematica',
  programacion: 'Programacion',
  literatura: 'Literatura',
};

export function looksLikeGeneratedRecordId(value: unknown) {
  const text = String(value || '').trim();
  return GENERATED_ID_RE.test(text) || UUID_ID_RE.test(text);
}

export function isUsableDisplayName(id: string, nombre: unknown) {
  const name = String(nombre || '').trim();
  if (!name) return false;
  if (looksLikeGeneratedRecordId(name)) return false;
  // `matematica` as both id and name is a usable label; raw generated ids are not.
  if (name === String(id || '').trim() && looksLikeGeneratedRecordId(id)) return false;
  return true;
}

export function recoveredDisplayName(id: string, nombre: unknown, fallback = '') {
  if (isUsableDisplayName(id, nombre)) return String(nombre).trim();
  const fromSlug = WELL_KNOWN_SUBJECT_NAMES[String(id || '').trim().toLowerCase()];
  if (fromSlug) return fromSlug;
  return fallback;
}

export function preferredDisplayName(id: string, nombre: unknown, fallback = '') {
  return recoveredDisplayName(id, nombre, fallback);
}

export function isGenericPlaceholderName(nombre: unknown) {
  return /^(curso|materia|escuela)$/i.test(String(nombre || '').trim());
}

export function pickBetterRecordName(id: string, ...candidates: unknown[]) {
  for (const candidate of candidates) {
    if (isGenericPlaceholderName(candidate)) continue;
    const recovered = recoveredDisplayName(id, candidate, '');
    if (recovered && !isGenericPlaceholderName(recovered)) return recovered;
    if (isUsableDisplayName(id, candidate)) return String(candidate).trim();
  }
  return '';
}
