import { ACTIVITY_AI_LIMITS } from '../lib/activity-ai-limits';
import { requireGroqApiKey } from './groq-env';
import { groqQueue } from './groq-queue';
import type { AulaModo, PreguntaInput } from './aula-temporal-service';

const MODEL = ACTIVITY_AI_LIMITS.groqModelHeavy;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export type DigitalQuizPayload = {
  titulo: string;
  instruccionesAlumno: string[];
  preguntas: PreguntaInput[];
  hojaRespuestas: string;
  documentoDocente: string;
};

function getApiKey() {
  return requireGroqApiKey();
}

function modoInstructions(modo: AulaModo) {
  if (modo === 'multiple_choice') {
    return [
      'Generá SOLO preguntas de opción múltiple (mc_single o mc_multi).',
      'Cada pregunta DEBE tener 4 opciones con ids opt-1..opt-4 (o únicos) y "correctas" con el/los id(s) correctos.',
      'mc_single: exactamente 1 correcta. mc_multi: 2 o más correctas.',
      'Entre 6 y 12 preguntas. Incluí puntaje por pregunta (suma ~10).',
    ].join(' ');
  }
  if (modo === 'examen') {
    return [
      'Generá un EXAMEN digital mixto: mayoría mc_single, algunas corta y 1-2 abiertas.',
      'MC con 4 opciones y correctas obligatorias.',
      'En corta/abierta, poné en "explicacion" la respuesta modelo para el docente/IA.',
      'Entre 8 y 14 ítems. Incluí puntaje (suma ~10).',
    ].join(' ');
  }
  return [
    'Generá una ACTIVIDAD CON PREGUNTAS: mezcla de mc_single, corta y abiertas.',
    'MC con opciones + correctas. En corta/abierta, "explicacion" = respuesta modelo.',
    'Entre 5 y 10 ítems. Incluí puntaje.',
  ].join(' ');
}

function parseQuiz(raw: string): DigitalQuizPayload {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('La IA no devolvió JSON válido.');
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;

  const preguntasRaw = Array.isArray(parsed.preguntas) ? parsed.preguntas : [];
  const preguntas: PreguntaInput[] = preguntasRaw.map((item, index) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    let tipo = String(row.tipo || 'mc_single');
    if (!['mc_single', 'mc_multi', 'corta', 'abierta'].includes(tipo)) tipo = 'mc_single';
    const enunciado = String(row.enunciado || '').trim();
    const opciones = Array.isArray(row.opciones)
      ? row.opciones.map((opt, optIndex) => {
          const o = (opt && typeof opt === 'object' ? opt : { texto: opt }) as Record<string, unknown>;
          return {
            id: String(o.id || `opt-${index + 1}-${optIndex + 1}`),
            texto: String(o.texto || '').trim(),
          };
        }).filter((o) => o.texto)
      : [];
    const correctas = Array.isArray(row.correctas)
      ? row.correctas.map(String)
      : row.correcta != null
        ? [String(row.correcta)]
        : [];
    return {
      tipo: tipo as PreguntaInput['tipo'],
      enunciado,
      opciones,
      correctas: correctas.filter((id) => opciones.some((o) => o.id === id)),
      puntaje: Math.max(0.5, Number(row.puntaje) || 1),
      explicacion: String(row.explicacion || row.respuestaModelo || '').trim(),
    };
  }).filter((p) => p.enunciado);

  if (!preguntas.length) throw new Error('La IA no generó preguntas utilizables.');

  return {
    titulo: String(parsed.titulo || 'Actividad digital').trim(),
    instruccionesAlumno: Array.isArray(parsed.instruccionesAlumno)
      ? parsed.instruccionesAlumno.map(String)
      : [],
    preguntas,
    hojaRespuestas: String(parsed.hojaRespuestas || '').trim(),
    documentoDocente: String(parsed.documentoDocente || parsed.hojaRespuestas || '').trim(),
  };
}

async function callGroq(userPrompt: string) {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.35,
      max_tokens: 8000,
      include_reasoning: false,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Sos un docente argentino que diseña actividades DIGITALES auto-corregibles.',
            'Respondé SOLO JSON válido con este esquema:',
            '{"titulo":"...","instruccionesAlumno":["..."],"preguntas":[{"tipo":"mc_single|mc_multi|corta|abierta","enunciado":"...","opciones":[{"id":"opt-1-1","texto":"..."}],"correctas":["opt-1-1"],"puntaje":1,"explicacion":"..."}],"hojaRespuestas":"...","documentoDocente":"..."}',
            'documentoDocente y hojaRespuestas son para el profesor (clave + rúbrica), en español claro.',
            'Usá LaTeX ($...$) si hay fórmulas.',
          ].join(' '),
        },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Groq respondió ${response.status}: ${detail.slice(0, 280)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq no devolvió contenido.');
  return String(content);
}

export async function generateDigitalQuiz(options: {
  modo: AulaModo;
  sourceText: string;
  promptDocente?: string;
  context: {
    colegio: string;
    turno: string;
    curso: string;
    materia: string;
    tituloSugerido?: string;
  };
}) {
  const userPrompt = [
    modoInstructions(options.modo),
    '',
    'Contexto:',
    `- Escuela: ${options.context.colegio}`,
    `- Turno: ${options.context.turno}`,
    `- Curso: ${options.context.curso}`,
    `- Materia: ${options.context.materia}`,
    options.context.tituloSugerido ? `- Título sugerido: ${options.context.tituloSugerido}` : '',
    options.promptDocente ? `- Pedido del docente: ${options.promptDocente}` : '',
    '',
    'Material de referencia (actividad o documento):',
    options.sourceText.slice(0, 28000),
  ].filter(Boolean).join('\n');

  const started = Date.now();
  const content = await groqQueue.run(() => callGroq(userPrompt));
  const quiz = parseQuiz(content);

  // Validación suave según modo
  if (options.modo === 'multiple_choice') {
    const bad = quiz.preguntas.filter((p) => p.tipo !== 'mc_single' && p.tipo !== 'mc_multi');
    if (bad.length) {
      quiz.preguntas = quiz.preguntas.filter((p) => p.tipo === 'mc_single' || p.tipo === 'mc_multi');
    }
    quiz.preguntas = quiz.preguntas.filter((p) => (p.opciones?.length || 0) >= 2 && (p.correctas?.length || 0) >= 1);
    if (!quiz.preguntas.length) {
      throw new Error('La IA no generó opción múltiple válida con clave. Probá de nuevo.');
    }
  }

  return {
    quiz,
    meta: { model: MODEL, durationMs: Date.now() - started },
  };
}

export function buildDigitalReferenceHtml(options: {
  titulo: string;
  colegio: string;
  curso: string;
  materia: string;
  modo: string;
  quiz: DigitalQuizPayload;
}) {
  const { titulo, colegio, curso, materia, modo, quiz } = options;
  const preguntasHtml = quiz.preguntas.map((p, i) => {
    const opts = (p.opciones || []).map((o) => {
      const ok = (p.correctas || []).includes(o.id);
      return `<li${ok ? ' style="font-weight:700"' : ''}>${escapeHtml(o.texto)}${ok ? ' ✓' : ''}</li>`;
    }).join('');
    return `
      <section style="margin:1rem 0;padding-top:0.75rem;border-top:1px solid #ddd">
        <h3>${i + 1}. [${escapeHtml(p.tipo)}] ${escapeHtml(p.enunciado)} <small>(${p.puntaje} pts)</small></h3>
        ${opts ? `<ul>${opts}</ul>` : ''}
        ${p.explicacion ? `<p><em>Modelo:</em> ${escapeHtml(p.explicacion)}</p>` : ''}
      </section>`;
  }).join('');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/><title>${escapeHtml(titulo)} — referencia</title>
<style>
  body{font-family:Georgia,serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#1c2421;line-height:1.45}
  h1{font-size:1.6rem} .meta{color:#555;font-size:0.95rem}
  .clave{background:#f4f7f5;padding:1rem;margin-top:2rem;border-left:4px solid #226c5f}
</style></head><body>
  <p class="meta">${escapeHtml(colegio)} · ${escapeHtml(curso)} · ${escapeHtml(materia)} · ${escapeHtml(modo)}</p>
  <h1>${escapeHtml(titulo)}</h1>
  <p><strong>Documento de referencia docente</strong> (incluye clave). No compartir con alumnos.</p>
  ${(quiz.instruccionesAlumno || []).map((x) => `<p>${escapeHtml(x)}</p>`).join('')}
  ${preguntasHtml}
  <div class="clave">
    <h2>Hoja de respuestas</h2>
    <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(quiz.hojaRespuestas || quiz.documentoDocente || '')}</pre>
  </div>
</body></html>`;
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
