import type { APIRoute } from 'astro';
import { isAllowedExcelImportFile } from '../../../lib/excel-import-limits';
import { previewStudentExcelBuffer, parseStudentImportMapping } from '../../../server/excel-import';

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: 'Formulario inválido.' }, { status: 400 });

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Adjuntá un archivo Excel.' }, { status: 400 });
  }

  const fileCheck = isAllowedExcelImportFile(file);
  if (!fileCheck.ok) return Response.json({ error: fileCheck.error }, { status: 400 });

  try {
    const buffer = await file.arrayBuffer();
    const mapping = parseStudentImportMapping(form.get('mapping'));
    const preview = await previewStudentExcelBuffer(user, buffer, mapping);
    return Response.json({ ok: true, ...preview });
  } catch (error) {
    console.error('[import/preview]', error);
    return Response.json({ error: 'No se pudo leer el archivo Excel.' }, { status: 500 });
  }
};
