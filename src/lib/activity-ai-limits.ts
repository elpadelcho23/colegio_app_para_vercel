export const ACTIVITY_AI_LIMITS = {
  maxFiles: 6,
  maxFileBytes: 8 * 1024 * 1024,
  maxFileMb: 8,
  /** Máximo de caracteres que se envían al modelo principal (70B). */
  maxInputChars: 35_000,
  /** Máximo de caracteres leídos al extraer archivos (puede superar lo enviado a la IA). */
  maxExtractChars: 120_000,
  /** Por encima de este umbral se resume con el modelo liviano. */
  summarizeThresholdChars: 12_000,
  /** Máximo enviado al modelo liviano para resumir. */
  summarizerInputChars: 28_000,
  approxPagesAtInputCap: '10-15',
  groqModelHeavy: 'llama-3.3-70b-versatile',
  groqModelLight: 'llama-3.1-8b-instant',
} as const;

export function formatActivityChars(value: number) {
  return new Intl.NumberFormat('es-AR').format(value);
}

export function activityLimitsSummaryLines() {
  const { maxFiles, maxFileMb, maxInputChars, summarizeThresholdChars, approxPagesAtInputCap, groqModelHeavy, groqModelLight } = ACTIVITY_AI_LIMITS;
  return [
    `Hasta ${maxFiles} archivos por solicitud (PDF, DOCX o TXT), ${maxFileMb} MB cada uno.`,
    `Se envían como máximo ${formatActivityChars(maxInputChars)} caracteres al modelo principal (~${approxPagesAtInputCap} páginas de texto).`,
    `Si el material supera ${formatActivityChars(summarizeThresholdChars)} caracteres, primero se resume con ${groqModelLight}.`,
    `La actividad final se genera con ${groqModelHeavy} (plan gratuito Groq: límites de tokens por minuto y por día).`,
    'Los PDF escaneados o con muchas imágenes pueden aportar poco texto extraíble.',
  ];
}
