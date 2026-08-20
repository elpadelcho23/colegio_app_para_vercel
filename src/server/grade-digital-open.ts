import { ACTIVITY_AI_LIMITS } from '../lib/activity-ai-limits';
import { getGroqApiKey } from './groq-env';
import { groqQueue } from './groq-queue';
import type { PreguntaRow } from './aula-temporal-service';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = ACTIVITY_AI_LIMITS.groqModelLight;

function getApiKey() {
  return getGroqApiKey();
}

export async function scoreOpenAnswersWithAi(options: {
  preguntas: PreguntaRow[];
  respuestas: Record<string, unknown>;
}): Promise<{ earned: number; max: number; detail: Array<Record<string, unknown>> }> {
  const open = options.preguntas.filter((p) => p.tipo === 'corta' || p.tipo === 'abierta');
  if (!open.length) return { earned: 0, max: 0, detail: [] };

  const max = open.reduce((sum, p) => sum + p.puntaje, 0);
  const key = getApiKey();
  if (!key) {
    return {
      earned: 0,
      max,
      detail: open.map((p) => ({ preguntaId: p.id, ok: null, pendiente: true, puntaje: 0, reason: 'sin_api_key' })),
    };
  }

  const items = open.map((p, i) => ({
    id: p.id,
    n: i + 1,
    enunciado: p.enunciado,
    modelo: p.explicacion || '',
    puntajeMax: p.puntaje,
    respuestaAlumno: String(options.respuestas[p.id] ?? '').trim(),
  }));

  const prompt = [
    'Evaluá estas respuestas abiertas/cortas de un alumno argentino.',
    'Devolvé JSON: {"items":[{"id":"...","puntaje":0.0,"comentario":"..."}]}',
    'puntaje entre 0 y puntajeMax de cada ítem. Sé justo y concreto.',
    '',
    JSON.stringify(items, null, 2),
  ].join('\n');

  try {
    const response = await groqQueue.run(() => fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 2000,
        include_reasoning: false,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Sos un docente que puntúa respuestas digitales. Solo JSON.' },
          { role: 'user', content: prompt },
        ],
      }),
    }));

    if (!response.ok) throw new Error(`Groq ${response.status}`);
    const data = await response.json();
    const raw = String(data?.choices?.[0]?.message?.content || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { items?: Array<Record<string, unknown>> };
    const byId = new Map((parsed.items || []).map((item) => [String(item.id), item]));

    let earned = 0;
    const detail = open.map((p) => {
      const row = byId.get(p.id);
      let pts = Number(row?.puntaje);
      if (!Number.isFinite(pts)) pts = 0;
      pts = Math.max(0, Math.min(p.puntaje, pts));
      earned += pts;
      return {
        preguntaId: p.id,
        ok: pts >= p.puntaje * 0.7,
        puntaje: pts,
        comentario: String(row?.comentario || '').slice(0, 300),
        ia: true,
      };
    });

    return { earned, max, detail };
  } catch {
    return {
      earned: 0,
      max,
      detail: open.map((p) => ({ preguntaId: p.id, ok: null, pendiente: true, puntaje: 0, reason: 'ia_error' })),
    };
  }
}
