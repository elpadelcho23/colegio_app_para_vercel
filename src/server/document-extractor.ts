import mammoth from 'mammoth';
import { ACTIVITY_AI_LIMITS } from '../lib/activity-ai-limits';

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'txt']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

export interface ExtractionResult {
  text: string;
  extractedChars: number;
  extractionTruncated: boolean;
  filesProcessed: number;
}

function extensionOf(filename: string) {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) || '' : '';
}

export function assertSupportedUpload(file: File) {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIME.has(file.type)) {
    throw new Error(`Formato no soportado: ${file.name}. Usá PDF, DOCX o TXT.`);
  }
  if (file.size > ACTIVITY_AI_LIMITS.maxFileBytes) {
    throw new Error(`El archivo ${file.name} supera el límite de ${ACTIVITY_AI_LIMITS.maxFileMb} MB.`);
  }
}

async function extractPdf(buffer: Buffer) {
  const pdfParseModule = await import('pdf-parse');
  const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
  const parsed = await pdfParse(buffer);
  return String(parsed.text || '').trim();
}

async function extractDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return String(result.value || '').trim();
}

export async function extractTextFromUpload(file: File): Promise<string> {
  assertSupportedUpload(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = extensionOf(file.name);

  if (ext === 'txt' || file.type === 'text/plain') {
    return buffer.toString('utf-8').trim();
  }
  if (ext === 'docx' || file.type.includes('wordprocessingml')) {
    return extractDocx(buffer);
  }
  if (ext === 'pdf' || file.type === 'application/pdf') {
    return extractPdf(buffer);
  }

  throw new Error(`No se pudo leer el archivo ${file.name}.`);
}

export async function extractTextFromUploads(files: File[]): Promise<ExtractionResult> {
  if (!files.length) {
    throw new Error('Adjuntá al menos un documento (PDF, DOCX o TXT).');
  }
  if (files.length > ACTIVITY_AI_LIMITS.maxFiles) {
    throw new Error(`Podés adjuntar hasta ${ACTIVITY_AI_LIMITS.maxFiles} archivos por solicitud.`);
  }

  const chunks: string[] = [];
  let totalChars = 0;
  let extractionTruncated = false;
  let filesProcessed = 0;

  for (const file of files) {
    const text = await extractTextFromUpload(file);
    filesProcessed += 1;
    if (!text) continue;

    const header = `--- ${file.name} ---\n`;
    const piece = `${header}${text}`;
    if (totalChars + piece.length > ACTIVITY_AI_LIMITS.maxExtractChars) {
      const remaining = ACTIVITY_AI_LIMITS.maxExtractChars - totalChars;
      if (remaining > 200) chunks.push(piece.slice(0, remaining));
      extractionTruncated = true;
      break;
    }
    chunks.push(piece);
    totalChars += piece.length;
  }

  const merged = chunks.join('\n\n').trim();
  if (!merged) {
    throw new Error('No se extrajo texto legible de los archivos adjuntos.');
  }

  return {
    text: merged,
    extractedChars: merged.length,
    extractionTruncated,
    filesProcessed,
  };
}
