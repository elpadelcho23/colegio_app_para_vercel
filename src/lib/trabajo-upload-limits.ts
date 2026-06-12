export const TRABAJO_UPLOAD_LIMITS = {
  maxFiles: 5,
  maxFileBytes: 15 * 1024 * 1024,
  maxFileMb: 15,
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'text/plain',
  ],
  allowedExtensions: ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.txt'],
};

export function isAllowedTrabajoFile(file: { name?: string; type?: string; size?: number }) {
  const name = String(file.name || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const mime = String(file.type || '').toLowerCase();
  const size = Number(file.size || 0);

  if (!size || size > TRABAJO_UPLOAD_LIMITS.maxFileBytes) {
    return { ok: false, error: `Cada archivo debe pesar como máximo ${TRABAJO_UPLOAD_LIMITS.maxFileMb} MB.` };
  }

  const mimeOk = TRABAJO_UPLOAD_LIMITS.allowedMimeTypes.includes(mime);
  const extOk = TRABAJO_UPLOAD_LIMITS.allowedExtensions.includes(ext);
  if (!mimeOk && !extOk) {
    return { ok: false, error: 'Formato no permitido. Usá PDF, Word, imágenes o TXT.' };
  }

  return { ok: true as const };
}
