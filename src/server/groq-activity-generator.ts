import {
  buildActivityDocumentHtml,
  type ActivityGenerationKind,
  type GeneratedActivityPayload,
} from './activity-document-html';
import { groqQueue } from './groq-queue';

const MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `Sos un Asistente Pedagógico Experto en educación secundaria y técnica en Argentina.
Tu tarea es GENERAR material didáctico original para el docente (NO corregir ni calificar trabajos de alumnos).

Reglas obligatorias:
- Respondé ÚNICAMENTE con JSON válido (sin markdown, sin texto antes ni después).
- El material debe ser claro, progresivo y coherente con el nivel académico indicado.
- Incluí consignas explícitas, tiempos sugeridos cuando corresponda y criterios de evaluación.
- Al final del documento conceptual, prepará una sección "hojaRespuestas" SOLO para el docente (respuestas modelo, puntaje, rúbrica breve).
- No inventes datos institucionales que no estén en el contexto.
- Si el material de referencia es insuficiente, completá con supuestos pedagógicos razonables y declaralos en "introduccion".

Adaptación a cualquier materia:
- Adaptá lenguaje, ejemplos, tipo de consignas y profundidad al área disciplinar indicada (matemática, física, química, biología, historia, geografía, literatura, idiomas, tecnología, economía, filosofía, arte, educación física, etc.).
- Usá terminología correcta de la materia y consignas propias de esa disciplina (problemas, análisis de texto, interpretación de fuentes, experimentos, etc.).
- Si la materia no es exactamente ciencias, priorizá claridad conceptual; si es ciencias exactas o naturales, incluí aplicación y cálculo cuando corresponda.

Notación matemática y científica (LaTeX obligatorio cuando haya fórmulas):
- Toda fórmula, ecuación, expresión algebraica, notación científica, unidad con superíndices o símbolos especiales DEBE escribirse en LaTeX para facilitar su lectura.
- Inline (en la misma línea): $F = ma$, $E = mc^2$, $\\mathrm{H_2SO_4}$, $v = \\frac{d}{t}$
- Bloque (centrada, ecuaciones importantes): $$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$
- También podés usar \\( ... \\) para inline y \\[ ... \\] para bloque.
- Química: $\\mathrm{CO_2}$, $\\mathrm{Na^+ + Cl^- \\rightarrow NaCl}$
- Física: $\\vec{F}$, $\\mathrm{m/s^2}$, $\\Delta E = Q - W$
- Matemática: $\\int_a^b f(x)\\,dx$, $\\sum_{i=1}^{n} i$, $\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$
- En el JSON, escapá las barras invertidas de LaTeX (ej: escribí \\\\frac en lugar de \\frac).
- NO uses caracteres unicode sueltos ni "fórmulas en texto plano" cuando exista notación LaTeX equivalente.

Reglas de formato:
- En las consignas y la hoja de respuestas, utilizá obligatoriamente saltos de línea (\\n) después de cada número de ítem.
- Ejemplo de formato requerido:
  1. Consigna uno
  2. Consigna dos
- NO entregues listados en una sola línea (ej: "1... 2... 3...").

Esquema JSON:
{
  "titulo": "string",
  "introduccion": "string",
  "instruccionesAlumno": ["string"],
  "bloques": [
    { "titulo": "string opcional", "contenido": "string con consignas numeradas" }
  ],
  "hojaRespuestas": "string con clave de respuestas y criterios para el docente",
  "criteriosDocente": ["string"]
}`;

function getApiKey() {
  const key = import.meta.env.GROQ_API_KEY || process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error('GROQ_API_KEY no está configurada. Agregala en el archivo .env del servidor.');
  }
  return key;
}

function kindInstructions(kind: ActivityGenerationKind, materia: string) {
  const subjectHint = `La actividad es para la materia "${materia}". Adaptá el contenido, ejemplos y tipo de consignas a esa disciplina. Usá LaTeX en todas las fórmulas o notación científica.`;
  if (kind === 'tp') {
    return `Generá un TRABAJO PRÁCTICO con consigna detallada, entregables, cronograma sugerido y rúbrica de evaluación. ${subjectHint}`;
  }
  if (kind === 'integrador') {
    return `Generá un TRABAJO INTEGRADOR que articule varios contenidos del material de referencia, con etapas, productos evidenciables y evaluación holística. ${subjectHint}`;
  }
  return `Generá un EXAMEN escrito con preguntas variadas (opción múltiple, desarrollo breve y problema aplicado), indicando puntaje por ítem. ${subjectHint}`;
}

function parseJsonPayload(raw: string): GeneratedActivityPayload {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('La IA no devolvió un JSON válido. Intentá nuevamente.');
  }
  const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as GeneratedActivityPayload;
  if (!parsed.titulo || !Array.isArray(parsed.bloques) || parsed.bloques.length === 0) {
    throw new Error('La respuesta de la IA no contiene título ni bloques de actividad.');
  }
  parsed.bloques = parsed.bloques
    .map((b) => ({ titulo: String(b.titulo || '').trim(), contenido: String(b.contenido || '').trim() }))
    .filter((b) => b.contenido);
  if (!parsed.bloques.length) {
    throw new Error('No se generaron bloques de contenido.');
  }
  return parsed;
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
      temperature: 0.45,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`Groq respondió ${response.status}: ${detail.slice(0, 280)}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq no devolvió contenido en la respuesta.');
  return { content: String(content), usage: data?.usage };
}

export async function generateActivityFromSources(options: {
  kind: ActivityGenerationKind;
  sourceText: string;
  context: {
    colegio: string;
    turno: string;
    curso: string;
    materia: string;
    tituloSugerido?: string;
    nivelAcademico?: string;
    notasDocente?: string;
  };
}) {
  const { kind, sourceText, context } = options;
  const userPrompt = [
    kindInstructions(kind, context.materia),
    '',
    'Contexto institucional:',
    `- Colegio: ${context.colegio}`,
    `- Turno: ${context.turno}`,
    `- Curso: ${context.curso}`,
    `- Materia: ${context.materia}`,
    context.nivelAcademico ? `- Nivel académico: ${context.nivelAcademico}` : '',
    context.tituloSugerido ? `- Título sugerido por el docente: ${context.tituloSugerido}` : '',
    context.notasDocente ? `- Indicaciones del docente: ${context.notasDocente}` : '',
    '',
    'Material de referencia extraído de los archivos adjuntos:',
    sourceText,
  ].filter(Boolean).join('\n');

  const started = Date.now();
  const { content, usage } = await groqQueue.run(() => callGroq(userPrompt));
  const payload = parseJsonPayload(content);
  payload.tipo = kind;

  const html = buildActivityDocumentHtml({
    titulo: payload.titulo,
    colegio: context.colegio,
    turno: context.turno,
    curso: context.curso,
    materia: context.materia,
    tipo: kind,
    payload,
  });

  const tipoDb: 'tp' | 'evaluacion' = kind === 'tp' ? 'tp' : 'evaluacion';

  return {
    payload,
    html,
    tipoDb,
    meta: {
      model: MODEL,
      durationMs: Date.now() - started,
      queue: groqQueue.getStats(),
      usage,
    },
  };
}
