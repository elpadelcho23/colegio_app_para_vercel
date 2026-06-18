import type { APIRoute } from 'astro';
import { isAllowedExcelImportFile, parseImportType } from '../../../lib/excel-import-limits';
import { importExcelBuffer, parseStudentImportMapping } from '../../../server/excel-import';

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: 'Formulario inválido.' }, { status: 400 });

  const type = parseImportType(form.get('type'));
  if (!type) {
    return Response.json({ error: 'Tipo de importación inválido. Usá: cursos, alumnos, asistencias o notas.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Adjuntá un archivo Excel.' }, { status: 400 });
  }

  const fileCheck = isAllowedExcelImportFile(file);
  if (!fileCheck.ok) return Response.json({ error: fileCheck.error }, { status: 400 });

  try {
    const buffer = await file.arrayBuffer();
    const mapping = type === 'alumnos' ? parseStudentImportMapping(form.get('mapping')) : null;
    const result = await importExcelBuffer(user, type, buffer, mapping);
    const hasBlockingErrors = result.errors.some((item) => item.row === 0);
    const processed = result.imported + result.updated;

    if (hasBlockingErrors || (processed === 0 && result.errors.length > 0)) {
      return Response.json(
        {
          error: result.errors[0]?.message || 'No se pudo importar el archivo.',
          ...result,
        },
        { status: 400 },
      );
    }

    return Response.json({
      ok: true,
      type,
      ...result,
      message: type === 'alumnos' && result.coursesCreated
        ? `Importación completada: ${result.imported} alumnos nuevos, ${result.updated} actualizados, ${result.coursesCreated} curso(s) creado(s)${result.errors.length ? `. ${result.errors.length} fila(s) omitida(s)` : ''}.`
        : `Importación completada: ${result.imported} nuevos, ${result.updated} actualizados${result.errors.length ? `. ${result.errors.length} fila(s) omitida(s)` : ''}.`,
    });
  } catch (error) {
    console.error('[import]', error);
    return Response.json({ error: 'No se pudo leer el archivo Excel. Verificá que sea un .xlsx válido.' }, { status: 500 });
  }
};
