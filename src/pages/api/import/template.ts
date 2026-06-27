import type { APIRoute } from 'astro';
import type { ExcelImportType } from '../../../lib/excel-import-limits';
import { buildImportTemplate } from '../../../server/excel-import';

function parseTemplateType(value: string | null): ExcelImportType | null {
  if (value === 'cursos' || value === 'alumnos' || value === 'asistencias' || value === 'notas') return value;
  return null;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const type = parseTemplateType(url.searchParams.get('type'));
  if (!type) {
    return Response.json({ error: 'Tipo inválido. Usá: cursos, alumnos, asistencias o notas.' }, { status: 400 });
  }

  const buffer = await buildImportTemplate(type);
  const filename = `aula-clara-plantilla-${type}.xlsx`;

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
};
