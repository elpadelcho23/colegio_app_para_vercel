import { ACTIVITY_AI_LIMITS } from '../lib/activity-ai-limits';
import {
  ATTENDANCE_FIELD_LIST,
  GRADE_FIELD_LIST,
  STUDENT_FIELD_LIST,
  type AttendanceMappingField,
  type GradeMappingField,
  type StudentMappingField,
} from '../lib/excel-column-map';
import { requireGroqApiKey } from './groq-env';
import { groqQueue } from './groq-queue';

const MODEL = ACTIVITY_AI_LIMITS.groqModelLight;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export type ExcelAiMapType = 'alumnos' | 'asistencias' | 'notas';

function getApiKey() {
  return requireGroqApiKey();
}

function fieldsForType(type: ExcelAiMapType) {
  if (type === 'alumnos') return STUDENT_FIELD_LIST;
  if (type === 'asistencias') return ATTENDANCE_FIELD_LIST;
  return GRADE_FIELD_LIST;
}

function parseJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] || content).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('La IA no devolvió JSON de mapeo.');
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

export async function suggestExcelColumnMapping(input: {
  type: ExcelAiMapType;
  headers: string[];
  sampleRows?: Array<Array<string | number | null>>;
  headerRow?: number;
}) {
  const allowed = fieldsForType(input.type);
  const headersList = input.headers
    .map((header, index) => `${index}: ${header || '(vacío)'}`)
    .join('\n');
  const samples = (input.sampleRows || [])
    .slice(0, 4)
    .map((row, rowIndex) => `Fila ${rowIndex + 1}: ${row.map((cell) => String(cell ?? '')).join(' | ')}`)
    .join('\n');

  const prompt = [
    `Sos un asistente que mapea columnas de planillas escolares argentinas al sistema Aula Clara.`,
    `Tipo de importación: ${input.type}.`,
    `Campos permitidos (usá exactamente estas claves): ${allowed.join(', ')}.`,
    `Te doy índices de columna (0-based) y sus encabezados.`,
    `Respondé SOLO un JSON con esta forma:`,
    `{"columns":{"campo":indiceEnteroONull},"confidence":0a1,"notes":"texto corto"}`,
    `Reglas:`,
    `- Cada campo como máximo una columna.`,
    `- Cada índice como máximo un campo.`,
    `- Si no estás seguro de un campo, usá null.`,
    `- Para alumnos: apellido y nombre pueden ser columnas distintas; nombre completo va a "nombre".`,
    `- Para asistencias: estado es Presente/Ausente/P/A.`,
    `- Para notas: calificacion es la nota (1-10 o texto).`,
    '',
    'Encabezados:',
    headersList,
    samples ? `\nMuestras:\n${samples}` : '',
  ].filter(Boolean).join('\n');

  const response = await groqQueue.run(() => fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content: 'Devolvé solo JSON válido de mapeo de columnas escolares. No inventes campos fuera de la lista.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  }));

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Groq respondió ${response.status}: ${detail.slice(0, 220)}`);
  }

  const data = await response.json();
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  const parsed = parseJsonObject(content);
  const rawColumns = (parsed.columns && typeof parsed.columns === 'object')
    ? parsed.columns as Record<string, unknown>
    : {};

  const columns: Record<string, number | null> = {};
  const usedIndexes = new Set<number>();
  for (const field of allowed) {
    const value = rawColumns[field];
    const index = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= input.headers.length || usedIndexes.has(index)) {
      columns[field] = null;
      continue;
    }
    columns[field] = index;
    usedIndexes.add(index);
  }

  return {
    headerRow: Math.max(1, Number(input.headerRow) || 1),
    columns,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
    notes: String(parsed.notes || '').slice(0, 280),
    model: MODEL,
  };
}

export type SuggestedStudentColumns = Partial<Record<StudentMappingField, number | null>>;
export type SuggestedAttendanceColumns = Partial<Record<AttendanceMappingField, number | null>>;
export type SuggestedGradeColumns = Partial<Record<GradeMappingField, number | null>>;
