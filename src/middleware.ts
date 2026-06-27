import { defineMiddleware } from 'astro:middleware';
import { getUserFromToken, SESSION_COOKIE } from './server/auth';
import { startBackupScheduler } from './server/backup';

const publicApiRoutes = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/register']);
const publicPageRoutes = new Set(['/login', '/register']);
const protectedPagePrefixes = ['/asistencia', '/notas', '/actividades', '/cursos', '/materias', '/registro', '/admin'];
startBackupScheduler();

export const onRequest = defineMiddleware((context, next) => {
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  const user = getUserFromToken(token);
  context.locals.user = user;

  const path = context.url.pathname;
  const isProtectedApi = path.startsWith('/api/') && !publicApiRoutes.has(path);
  const isProtectedPage = path === '/' || protectedPagePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  const isAdminArea = path.startsWith('/admin') || path.startsWith('/api/admin/');

  if (!user && isProtectedApi) {
    return Response.json({ error: 'No autenticado' }, { status: 401 });
  }

  if (!user && isProtectedPage && !publicPageRoutes.has(path)) {
    return context.redirect('/login');
  }

  if (user && publicPageRoutes.has(path)) {
    return context.redirect('/');
  }

  if (isAdminArea && user?.rol !== 'admin') {
    return Response.json({ error: 'Requiere rol admin' }, { status: 403 });
  }

  return next();
});
