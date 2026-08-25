import mammoth from 'mammoth';
import { ACTIVITY_AI_LIMITS } from '../lib/activity-ai-limits';
import { installPdfDomPolyfills } from './pdf-dom-polyfill';
import { configurePdfJsWorker, resolvePdfWorkerSrc } from './pdf-worker-setup';

installPdfDomPolyfills();

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

async function extractPdfWithPdfJs(buffer: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerSrc = configurePdfJsWorker(pdfjs);
  if (!workerSrc) {
    throw new Error('No se encontró el worker de PDF en el servidor.');
  }
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isOffscreenCanvasSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    const maxPages = Math.min(doc.numPages, 40);
    for (let index = 1; index <= maxPages; index += 1) {
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? String(item.str || '') : ''))
        .join(' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ ]{2,}/g, ' ')
        .trim();
      if (text) pages.push(text);
    }
    return pages.join('\n\n').trim();
  } finally {
    await doc.destroy();
  }
}

async function extractPdf(buffer: Buffer) {
  installPdfDomPolyfills();
  let lastError = '';
  try {
    const text = await extractPdfWithPdfJs(buffer);
    if (text) return text;
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'pdf.js';
  }

  try {
    const { PDFParse } = await import('pdf-parse');
    const workerSrc = resolvePdfWorkerSrc();
    if (workerSrc) PDFParse.setWorker(workerSrc);
    const parser = new PDFParse({
      data: buffer,
      isOffscreenCanvasSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    });
    try {
      const result = await parser.getText();
      const text = String(result?.text || '').trim();
      if (text) return text;
    } finally {
      await parser.destroy?.();
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : lastError || 'pdf-parse';
  }

  throw new Error(
    lastError && !/DOMMatrix|Path2D|ImageData|workerSrc|fake worker/i.test(lastError)
      ? `No se pudo leer el PDF (${lastError.slice(0, 120)}). Si es un escaneo, subí un DOCX o TXT.`
      : 'No se pudo leer el PDF. Si es un escaneo sin texto seleccionable, subí un DOCX o TXT.',
  );
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

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  mimeType = '',
): Promise<string> {
  const ext = extensionOf(filename);
  if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIME.has(mimeType)) {
    throw new Error(`Formato no soportado para corrección digital: ${filename}. Usá PDF, DOCX o TXT.`);
  }

  if (ext === 'txt' || mimeType === 'text/plain') {
    return buffer.toString('utf-8').trim();
  }
  if (ext === 'docx' || mimeType.includes('wordprocessingml')) {
    return extractDocx(buffer);
  }
  if (ext === 'pdf' || mimeType === 'application/pdf') {
    return extractPdf(buffer);
  }

  throw new Error(`No se pudo leer el archivo ${filename}.`);
}

export async function extractTextFromStoredFiles(
  files: Array<{ buffer: Buffer; filename: string; mimeType?: string }>,
): Promise<ExtractionResult> {
  if (!files.length) {
    throw new Error('No hay archivos digitales (PDF, DOCX o TXT) para corregir.');
  }

  const chunks: string[] = [];
  let totalChars = 0;
  let extractionTruncated = false;
  let filesProcessed = 0;

  for (const file of files) {
    const text = await extractTextFromBuffer(file.buffer, file.filename, file.mimeType || '');
    filesProcessed += 1;
    if (!text) continue;

    const header = `--- ${file.filename} ---\n`;
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
    throw new Error('No se extrajo texto legible. El MVP digital no corrige fotos escaneadas sin texto.');
  }

  return {
    text: merged,
    extractedChars: merged.length,
    extractionTruncated,
    filesProcessed,
  };
}
