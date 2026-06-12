import type { APIRoute } from 'astro';
import { readTrabajoFile } from '../../../../server/file-storage';
import { getTrabajoArchivo } from '../../../../server/trabajo-entregas';

export const GET: APIRoute = ({ locals, params, url }) => {
  const user = locals.user;
  if (!user) return new Response('No autenticado', { status: 401 });

  const archivoId = String(params.archivoId || '').trim();
  if (!archivoId) return new Response('Archivo inválido', { status: 400 });

  const archivo = getTrabajoArchivo(user, archivoId);
  if (!archivo) return new Response('Archivo no encontrado', { status: 404 });

  const buffer = readTrabajoFile(archivo.storage_path);
  if (!buffer) return new Response('Archivo no disponible', { status: 404 });

  const disposition = url.searchParams.get('preview') === '1' ? 'inline' : 'attachment';
  const headers = new Headers({
    'Content-Type': archivo.mime_type || 'application/octet-stream',
    'Content-Disposition': `${disposition}; filename="${archivo.filename.replace(/"/g, '')}"`,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'private, max-age=60',
  });

  return new Response(buffer, { status: 200, headers });
};
