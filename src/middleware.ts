import { defineMiddleware } from 'astro:middleware';
import { getUserFromToken, SESSION_COOKIE } from './server/auth';
import { SESSION_PASSPORT_COOKIE, rehydrateUserFromPassport } from './server/guest-passport';
import { startBackupScheduler } from './server/backup';
import { ensureDbReady } from './server/db';

const publicApiRoutes = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
  '/api/auth/guest',
  '/api/aula-temporal/join',
]);

function isPublicApi(path: string) {
  if (publicApiRoutes.has(path)) return true;
  if (path.startsWith('/api/aula-temporal/public/')) return true;
  if (path.startsWith('/api/aula-temporal/intento/')) return true;
  return false;
}

function isPublicPage(path: string) {
  return path === '/login' || path === '/register' || path.startsWith('/s/');
}

const protectedPagePrefixes = [
  '/asistencia',
  '/notas',
  '/actividades',
  '/cursos',
  '/materias',
  '/registro',
  '/admin',
  '/herramientas',
];

if (!process.env.VERCEL) {
  startBackupScheduler();
}

export const onRequest = defineMiddleware(async (context, next) => {
  await ensureDbReady();

  const token = context.cookies.get(SESSION_COOKIE)?.value;
  let user = await getUserFromToken(token);
  if (!user && token) {
    const passport =
      context.cookies.get(SESSION_PASSPORT_COOKIE)?.value
      || context.cookies.get('aula_clara_guest_passport')?.value;
    user = await rehydrateUserFromPassport(token, passport);
  }
  context.locals.user = user;

  const path = context.url.pathname;
  const isProtectedApi = path.startsWith('/api/') && !isPublicApi(path);
  const isProtectedPage = path === '/' || protectedPagePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  const isAdminArea = path.startsWith('/admin') || path.startsWith('/api/admin/');

  if (!user && isProtectedApi) {
    return Response.json({ error: 'No autenticado' }, { status: 401 });
  }

  if (!user && isProtectedPage && !isPublicPage(path)) {
    return context.redirect('/login');
  }

  if (user && (path === '/login' || path === '/register')) {
    return context.redirect('/');
  }

  if (isAdminArea && user?.rol !== 'admin') {
    return Response.json({ error: 'Requiere rol admin' }, { status: 403 });
  }

  return next();
});
