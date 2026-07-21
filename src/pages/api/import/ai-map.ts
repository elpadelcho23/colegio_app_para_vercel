import type { APIRoute } from 'astro';
import { suggestExcelColumnMapping, type ExcelAiMapType } from '../../../server/excel-ai-map';

function parseType(value: FormDataEntryValue | null): ExcelAiMapType | null {
  if (value === 'alumnos' || value === 'asistencias' || value === 'notas') return value;
  return null;
}

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: 'Formulario inválido.' }, { status: 400 });

  const type = parseType(form.get('type'));
  if (!type) {
    return Response.json({ error: 'Tipo inválido. Usá alumnos, asistencias o notas.' }, { status: 400 });
  }

  let headers: string[] = [];
  let sampleRows: Array<Array<string | number | null>> = [];
  try {
    headers = JSON.parse(String(form.get('headers') || '[]'));
    sampleRows = JSON.parse(String(form.get('sampleRows') || '[]'));
  } catch {
    return Response.json({ error: 'headers/sampleRows inválidos.' }, { status: 400 });
  }

  if (!Array.isArray(headers) || !headers.length) {
    return Response.json({ error: 'Faltan encabezados detectados del Excel.' }, { status: 400 });
  }

  const headerRow = Number(form.get('headerRow') || 1);

  try {
    const suggestion = await suggestExcelColumnMapping({
      type,
      headers: headers.map((item) => String(item ?? '')),
      sampleRows: Array.isArray(sampleRows) ? sampleRows.slice(0, 5) : [],
      headerRow,
    });
    return Response.json({ ok: true, ...suggestion });
  } catch (error) {
    console.error('[import/ai-map]', error);
    const message = error instanceof Error ? error.message : 'No se pudo sugerir el mapeo con IA.';
    const status = /GROQ_API_KEY/i.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
};
