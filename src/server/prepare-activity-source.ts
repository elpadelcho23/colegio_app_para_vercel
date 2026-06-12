import { ACTIVITY_AI_LIMITS, formatActivityChars } from '../lib/activity-ai-limits';
import { extractTextFromUploads } from './document-extractor';
import { summarizeActivitySource } from './groq-text-summarizer';

export interface SourcePreparationMeta {
  extractedChars: number;
  usedChars: number;
  extractionTruncated: boolean;
  inputTruncated: boolean;
  summarized: boolean;
  filesProcessed: number;
  maxInputChars: number;
  summarizeThresholdChars: number;
  summaryModel?: string;
  messages: string[];
}

export async function prepareActivitySource(
  files: File[],
  context?: { materia?: string; curso?: string },
) {
  const extraction = await extractTextFromUploads(files);
  const messages: string[] = [];
  let text = extraction.text;
  let summarized = false;
  let inputTruncated = false;
  let summaryModel: string | undefined;

  if (text.length > ACTIVITY_AI_LIMITS.summarizeThresholdChars) {
    const summary = await summarizeActivitySource(text, context);
    text = summary.text;
    summarized = true;
    summaryModel = summary.model;
    messages.push(
      `El material tenía ${formatActivityChars(extraction.extractedChars)} caracteres y se resumió a ${formatActivityChars(summary.outputChars)} antes de generar la actividad.`,
    );
  }

  if (text.length > ACTIVITY_AI_LIMITS.maxInputChars) {
    text = text.slice(0, ACTIVITY_AI_LIMITS.maxInputChars);
    inputTruncated = true;
    messages.push(
      `Se usaron los primeros ${formatActivityChars(ACTIVITY_AI_LIMITS.maxInputChars)} caracteres del material disponible.`,
    );
  }

  if (extraction.extractionTruncated) {
    messages.push(
      `La lectura de archivos se detuvo al llegar a ${formatActivityChars(ACTIVITY_AI_LIMITS.maxExtractChars)} caracteres extraídos.`,
    );
  }

  return {
    text,
    meta: {
      extractedChars: extraction.extractedChars,
      usedChars: text.length,
      extractionTruncated: extraction.extractionTruncated,
      inputTruncated,
      summarized,
      filesProcessed: extraction.filesProcessed,
      maxInputChars: ACTIVITY_AI_LIMITS.maxInputChars,
      summarizeThresholdChars: ACTIVITY_AI_LIMITS.summarizeThresholdChars,
      summaryModel,
      messages,
    } satisfies SourcePreparationMeta,
  };
}
