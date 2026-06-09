export type SpaViewId = 'panel' | 'registro' | 'cursos' | 'asistencia' | 'notas' | 'actividades';

export const SPA_VIEWS: SpaViewId[] = ['panel', 'registro', 'cursos', 'asistencia', 'notas', 'actividades'];

export const PATH_TO_VIEW: Record<string, SpaViewId> = {
  '/': 'panel',
  '/registro': 'registro',
  '/cursos': 'cursos',
  '/asistencia': 'asistencia',
  '/notas': 'notas',
  '/actividades': 'actividades',
};

export const VIEW_TO_PATH: Record<SpaViewId, string> = {
  panel: '/',
  registro: '/registro',
  cursos: '/cursos',
  asistencia: '/asistencia',
  notas: '/notas',
  actividades: '/actividades',
};

export function resolveInitialView(pathname: string, search = '') {
  const params = new URLSearchParams(search);
  const queryView = params.get('view') as SpaViewId | null;
  if (queryView && SPA_VIEWS.includes(queryView)) return queryView;
  return PATH_TO_VIEW[pathname] || 'panel';
}
