import { randomUUID } from 'node:crypto';
import { ACTIVITY_AI_LIMITS } from '../lib/activity-ai-limits';
import { db, type User } from './db';
import { extractTextFromStoredFiles } from './document-extractor';
import { readTrabajoFile } from './file-storage';
import { requireGroqApiKey } from './groq-env';
import { groqQueue } from './groq-queue';
import { summarizeActivitySource } from './groq-text-summarizer';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = ACTIVITY_AI_LIMITS.groqModelLight;

const DIGITAL_EXT = new Set(['pdf', 'docx', 'txt']);
const DIGITAL_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const IMAGE_MIME_PREFIX = 'image/';

export type CorreccionItem = {
  criterio: string;
  puntaje: number;
  comentario: string;
};

export type CorreccionResult = {
  nota: number;
  resumen: string;
  items: CorreccionItem[];
  confianza: number;
};

export class GradeDeliveryError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GradeDeliveryError';
    this.status = status;
  }
}

function getApiKey() {
  try {
    return requireGroqApiKey();
  } catch (error) {
    throw new GradeDeliveryError(
      error instanceof Error ? error.message : 'GROQ_API_KEY no está configurada.',
      503,
    );
  }
}

function extensionOf(filename: string) {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) || '' : '';
}

function isDigitalFile(filename: string, mimeType: string) {
  const ext = extensionOf(filename);
  return DIGITAL_EXT.has(ext) || DIGITAL_MIME.has(mimeType);
}

function isImageFile(mimeType: string, filename: string) {
  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return true;
  return /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(filename);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function defaultPeriodo(fecha: string) {
  const month = new Date(`${fecha}T12:00:00`).getMonth() + 1;
  if (month >= 3 && month <= 6) return '1c';
  if (month >= 7 && month <= 11) return '2c';
  return '2c';
}

function clampNota(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new GradeDeliveryError('La IA no devolvió una nota numérica válida.');
  }
  const clamped = Math.min(10, Math.max(1, Math.round(n * 10) / 10));
  return clamped;
}

function parseCorreccionJson(raw: string): CorreccionResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new GradeDeliveryError('La IA devolvió un JSON inválido.');
  }

  const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
  const items: CorreccionItem[] = itemsRaw.map((item) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      criterio: String(row.criterio || 'Criterio').slice(0, 200),
      puntaje: Number.isFinite(Number(row.puntaje)) ? Number(row.puntaje) : 0,
      comentario: String(row.comentario || '').slice(0, 500),
    };
  });

  const confianzaRaw = Number(parsed.confianza);
  return {
    nota: clampNota(parsed.nota),
    resumen: String(parsed.resumen || '').trim().slice(0, 800) || 'Corrección automática.',
    items,
    confianza: Number.isFinite(confianzaRaw) ? Math.min(1, Math.max(0, confianzaRaw)) : 0.5,
  };
}

function buildRubricaContext(contenidoJson: string | null, tipo: string | null, titulo: string) {
  let contenido: Record<string, unknown> = {};
  try {
    contenido = contenidoJson ? JSON.parse(contenidoJson) as Record<string, unknown> : {};
  } catch {
    contenido = {};
  }

  const bloques = Array.isArray(contenido.bloques) ? contenido.bloques : [];
  const consignas = bloques.map((bloque, index) => {
    const row = (bloque && typeof bloque === 'object' ? bloque : {}) as Record<string, unknown>;
    const texto = String(row.consigna || row.enunciado || row.texto || row.contenido || '').trim();
    const tipoBloque = String(row.tipo || row.kind || 'bloque');
    return texto ? `${index + 1}. [${tipoBloque}] ${texto}` : null;
  }).filter(Boolean);

  const seguimiento = (contenido.seguimiento && typeof contenido.seguimiento === 'object'
    ? contenido.seguimiento
    : {}) as Record<string, unknown>;
  const criterios = Array.isArray(seguimiento.criterios)
    ? seguimiento.criterios
    : Array.isArray(contenido.criterios)
      ? contenido.criterios
      : [];

  const criteriosText = criterios.map((item, index) => {
    if (typeof item === 'string') return `${index + 1}. ${item}`;
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const nombre = String(row.nombre || row.criterio || row.titulo || `Criterio ${index + 1}`);
    const peso = row.peso != null ? ` (peso ${row.peso})` : '';
    const desc = String(row.descripcion || row.detalle || '').trim();
    return `${index + 1}. ${nombre}${peso}${desc ? `: ${desc}` : ''}`;
  }).filter(Boolean);

  const hoja = contenido.hojaRespuestas ?? contenido.hoja_respuestas ?? null;
  let clave = '';
  if (hoja != null) {
    try {
      clave = JSON.stringify(hoja).slice(0, 4000);
    } catch {
      clave = String(hoja).slice(0, 4000);
    }
  }

  return {
    titulo,
    tipo: tipo || 'tp',
    consignas: consignas.join('\n') || '(Sin consignas estructuradas; evaluá coherencia con el título y un criterio escolar general.)',
    criterios: criteriosText.join('\n') || '(Sin rúbrica explícita; usá criterios escolares generales: completitud, precisión, claridad y evidencia de aprendizaje.)',
    clave,
  };
}

async function callGroqCorreccion(prompt: string): Promise<CorreccionResult> {
  const response = await groqQueue.run(() => fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 1800,
      include_reasoning: false,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Sos un docente argentino que corrige entregas digitales (PDF/DOCX/TXT).',
            'Respondé SOLO JSON válido con esta forma exacta:',
            '{"nota":7.5,"resumen":"...","items":[{"criterio":"...","puntaje":0.8,"comentario":"..."}],"confianza":0.0}',
            'nota: número de 1 a 10 (un decimal permitido).',
            'puntaje de cada ítem: 0 a 1.',
            'confianza: 0 a 1 según cuánto texto útil tuviste.',
            'Sé justo, concreto y en español rioplatense. No inventes evidencia que no esté en la entrega.',
          ].join(' '),
        },
        { role: 'user', content: prompt },
      ],
    }),
  }));

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new GradeDeliveryError(
      `Groq respondió ${response.status}: ${detail.slice(0, 280)}`,
      response.status === 429 ? 429 : 502,
    );
    throw error;
  }

  const data = await response.json();
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!content) throw new GradeDeliveryError('Groq no devolvió contenido en la respuesta.', 502);
  return parseCorreccionJson(content);
}

async function upsertNota(options: {
  user: User;
  notaId: string | null;
  alumnoId: string;
  materiaId: string;
  titulo: string;
  tipoEvaluacion: string;
  valor: number;
  motivo: string;
  fecha: string;
  periodo: string;
}) {
  const { user, alumnoId, materiaId, titulo, tipoEvaluacion, valor, motivo, fecha, periodo } = options;
  const updatedAt = new Date().toISOString();
  const existingId = options.notaId
    ? ((await db.prepare(`
        SELECT id FROM notas
        WHERE id = ? AND tenant_id = ? AND (? = 1 OR docente_id = ?)
      `).get(options.notaId, user.tenant_id, user.rol === 'admin' ? 1 : 0, user.id)) as { id: string } | undefined)?.id
    : null;

  const gradeId = existingId || `nota-${randomUUID()}`;

  await db.prepare(`
    INSERT INTO notas (
      id, tenant_id, docente_id, alumno_id, materia_id, titulo, tipo_evaluacion,
      valor, calificacion_texto, peso, fecha, fecha_entrega, periodo, motivo, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      tipo_evaluacion = excluded.tipo_evaluacion,
      valor = excluded.valor,
      calificacion_texto = excluded.calificacion_texto,
      motivo = excluded.motivo,
      updated_at = excluded.updated_at
    WHERE notas.tenant_id = excluded.tenant_id
  `).run(
    gradeId,
    user.tenant_id,
    user.id,
    alumnoId,
    materiaId,
    titulo,
    tipoEvaluacion,
    valor,
    null,
    1,
    fecha,
    null,
    periodo,
    motivo,
    updatedAt,
  );

  return gradeId;
}

export async function gradeTrabajoEntrega(user: User, entregaId: string) {
  const entrega = (await db.prepare(`
    SELECT
      te.id,
      te.tenant_id,
      te.docente_id,
      te.actividad_id,
      te.alumno_id,
      te.curso_id,
      te.materia_id,
      te.titulo,
      te.estado,
      te.nota_id,
      te.observaciones,
      cursos.nombre AS curso,
      materias.nombre AS materia,
      actividades.tipo AS actividad_tipo,
      actividades.contenido_json AS contenido_json
    FROM trabajo_entregas te
    JOIN cursos ON cursos.id = te.curso_id
    JOIN materias ON materias.id = te.materia_id
    LEFT JOIN actividades ON actividades.id = te.actividad_id
    WHERE te.id = ?
      AND te.tenant_id = ?
      ${user.rol === 'admin' ? '' : 'AND te.docente_id = ?'}
  `).get(
    entregaId,
    user.tenant_id,
    ...(user.rol === 'admin' ? [] : [user.id]),
  )) as {
    id: string;
    tenant_id: string;
    docente_id: string;
    actividad_id: string | null;
    alumno_id: string | null;
    curso_id: string;
    materia_id: string;
    titulo: string;
    estado: string;
    nota_id: string | null;
    observaciones: string | null;
    curso: string;
    materia: string;
    actividad_tipo: string | null;
    contenido_json: string | null;
  } | undefined;

  if (!entrega) {
    throw new GradeDeliveryError('Entrega no encontrada.', 404);
  }

  if (!entrega.alumno_id) {
    throw new GradeDeliveryError(
      'Vinculá un alumno a la entrega antes de corregir con IA (así se guarda la nota en Calificaciones).',
    );
  }

  const archivos = (await db.prepare(`
    SELECT id, filename, mime_type, storage_path
    FROM trabajo_archivos
    WHERE entrega_id = ?
    ORDER BY created_at ASC
  `).all(entrega.id)) as Array<{
    id: string;
    filename: string;
    mime_type: string;
    storage_path: string;
  }>;

  if (!archivos.length) {
    throw new GradeDeliveryError('La entrega no tiene archivos adjuntos.');
  }

  const digital = archivos.filter((file) => isDigitalFile(file.filename, file.mime_type || ''));
  const onlyImages = !digital.length && archivos.every((file) => isImageFile(file.mime_type || '', file.filename));

  if (!digital.length) {
    throw new GradeDeliveryError(
      onlyImages
        ? 'MVP digital: esta entrega solo tiene fotos. La corrección por OCR llega en una fase posterior. Subí PDF, DOCX o TXT con texto.'
        : 'No hay archivos PDF, DOCX o TXT para corregir automáticamente.',
    );
  }

  const buffers = digital.map((file) => {
    const buffer = readTrabajoFile(file.storage_path);
    if (!buffer) {
      throw new GradeDeliveryError(`No se encontró el archivo en disco: ${file.filename}.`, 404);
    }
    return {
      buffer,
      filename: file.filename,
      mimeType: file.mime_type || '',
    };
  });

  const extraction = await extractTextFromStoredFiles(buffers);
  let deliveryText = extraction.text;

  if (deliveryText.length > ACTIVITY_AI_LIMITS.summarizeThresholdChars) {
    const summary = await summarizeActivitySource(deliveryText, {
      materia: entrega.materia,
      curso: entrega.curso,
    });
    deliveryText = summary.text;
  }

  if (deliveryText.length > ACTIVITY_AI_LIMITS.maxInputChars) {
    deliveryText = deliveryText.slice(0, ACTIVITY_AI_LIMITS.maxInputChars);
  }

  const rubrica = buildRubricaContext(entrega.contenido_json, entrega.actividad_tipo, entrega.titulo);

  const prompt = [
    `Actividad: ${rubrica.titulo}`,
    `Tipo: ${rubrica.tipo}`,
    `Curso: ${entrega.curso} · Materia: ${entrega.materia}`,
    entrega.observaciones ? `Observaciones del docente: ${entrega.observaciones}` : '',
    '',
    'Consignas / bloques:',
    rubrica.consignas,
    '',
    'Criterios / rúbrica:',
    rubrica.criterios,
    rubrica.clave ? `\nClave / hoja de respuestas (si aplica):\n${rubrica.clave}` : '',
    '',
    'Entrega del alumno (texto extraído):',
    deliveryText,
  ].filter(Boolean).join('\n');

  const correccion = await callGroqCorreccion(prompt);
  const fecha = todayIsoDate();
  const tipoEvaluacion = entrega.actividad_tipo === 'evaluacion' ? 'Evaluacion' : 'TP';
  const periodo = defaultPeriodo(fecha);
  const motivo = `IA: ${correccion.resumen}`.slice(0, 400);

  const notaId = await upsertNota({
    user,
    notaId: entrega.nota_id,
    alumnoId: entrega.alumno_id,
    materiaId: entrega.materia_id,
    titulo: entrega.titulo,
    tipoEvaluacion,
    valor: correccion.nota,
    motivo,
    fecha,
    periodo,
  });

  const corregidoAt = new Date().toISOString();
  await db.prepare(`
    UPDATE trabajo_entregas
    SET estado = 'calificado',
        nota_id = ?,
        correccion_json = ?,
        corregido_at = ?,
        updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(
    notaId,
    JSON.stringify(correccion),
    corregidoAt,
    corregidoAt,
    entrega.id,
    user.tenant_id,
  );

  return {
    entregaId: entrega.id,
    notaId,
    nota: correccion.nota,
    correccion,
    corregidoAt,
  };
}
