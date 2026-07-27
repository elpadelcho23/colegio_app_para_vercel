import type { APIRoute } from 'astro';
import {
  createAulaTemporal,
  listAulasForDocente,
  type AulaModo,
  type AntiTrampaConfig,
  type PreguntaInput,
} from '../../../server/aula-temporal-service';

export const GET: APIRoute = ({ locals, url }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const actividadId = url.searchParams.get('actividadId') || undefined;
  return Response.json({ aulas: listAulasForDocente(user, actividadId) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const actividadId = String(body?.actividadId || '').trim();
  const modo = String(body?.modo || '').trim() as AulaModo;
  if (!actividadId) return Response.json({ error: 'Falta actividadId.' }, { status: 400 });
  if (!['multiple_choice', 'actividad_preguntas', 'examen'].includes(modo)) {
    return Response.json({ error: 'Modo inválido.' }, { status: 400 });
  }

  try {
    const aula = createAulaTemporal({
      user,
      actividadId,
      modo,
      duracionMinutos: Number(body?.duracionMinutos) || 40,
      expiresInHours: Number(body?.expiresInHours) || 24,
      antiTrampa: (body?.antiTrampa || {}) as Partial<AntiTrampaConfig>,
      mostrarNotaAlAlumno: body?.mostrarNotaAlAlumno !== false,
      titulo: body?.titulo ? String(body.titulo) : undefined,
      preguntas: Array.isArray(body?.preguntas) ? body.preguntas as PreguntaInput[] : undefined,
    });
    return Response.json({ aula });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo crear el aula.' },
      { status: 400 },
    );
  }
};
