import type { APIRoute } from 'astro';
import {
  createClaseVirtual,
  type AulaModo,
  type AntiTrampaConfig,
} from '../../../server/aula-temporal-service';

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const modo = String(body?.modo || '').trim() as AulaModo;
  if (!['multiple_choice', 'actividad_preguntas', 'examen'].includes(modo)) {
    return Response.json({ error: 'Modo inválido.' }, { status: 400 });
  }

  try {
    const aula = await createClaseVirtual({
      user,
      colegio: String(body?.colegio || ''),
      turno: String(body?.turno || ''),
      cursoId: String(body?.cursoId || ''),
      materiaId: String(body?.materiaId || ''),
      titulo: String(body?.titulo || ''),
      modo,
      duracionMinutos: Number(body?.duracionMinutos) || 40,
      expiresInHours: Number(body?.expiresInHours) || 24,
      antiTrampa: (body?.antiTrampa || {}) as Partial<AntiTrampaConfig>,
      mostrarNotaAlAlumno: body?.mostrarNotaAlAlumno !== false,
    });
    return Response.json({ aula }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'No se pudo crear la clase.' },
      { status: 400 },
    );
  }
};
