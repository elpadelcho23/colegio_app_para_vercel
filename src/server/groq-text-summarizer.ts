import { ACTIVITY_AI_LIMITS } from '../lib/activity-ai-limits';
import { groqQueue } from './groq-queue';

const MODEL = ACTIVITY_AI_LIMITS.groqModelLight;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function getApiKey() {
  const key = import.meta.env.GROQ_API_KEY || process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error('GROQ_API_KEY no está configurada. Agregala en el archivo .env del servidor.');
  }
  return key;
}

export async function summarizeActivitySource(rawText: string, context?: { materia?: string; curso?: string }) {
  const input = rawText.slice(0, ACTIVITY_AI_LIMITS.summarizerInputChars).trim();
  const contextLine = [
    context?.materia ? `Materia: ${context.materia}` : '',
    context?.curso ? `Curso: ${context.curso}` : '',
  ].filter(Boolean).join(' · ');

  const userPrompt = [
    'Resumí el siguiente material didáctico para que otro modelo pueda generar una actividad escolar.',
    'Conservá conceptos clave, definiciones, ejemplos importantes, cronología y objetivos de aprendizaje.',
    'Si el material incluye fórmulas o notación científica, conservalas en LaTeX ($...$ inline, $$...$$ bloque).',
    'No inventes contenido nuevo. Usá español rioplatense claro para docentes.',
    'Entregá texto corrido con viñetas solo cuando ayuden.',
    contextLine ? `Contexto: ${contextLine}` : '',
    '',
    'Material:',
    input,
  ].filter(Boolean).join('\n');

  const response = await groqQueue.run(() => fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 2800,
      messages: [
        {
          role: 'system',
          content: 'Sos un asistente que condensa material educativo sin perder contenidos evaluables. Preservá fórmulas en notación LaTeX cuando aparezcan.',
        },
        { role: 'user', content: userPrompt },
      ],
    }),
  }));

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`Groq (resumen) respondió ${response.status}: ${detail.slice(0, 220)}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!content) throw new Error('El modelo liviano no devolvió un resumen utilizable.');

  return {
    text: content,
    model: MODEL,
    inputChars: input.length,
    outputChars: content.length,
    usage: data?.usage,
  };
}
