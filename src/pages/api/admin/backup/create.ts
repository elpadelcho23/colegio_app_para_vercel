import type { APIRoute } from 'astro';
import { createBackup } from '../../../../server/backup';

export const POST: APIRoute = async ({ redirect }) => {
  await createBackup('manual');
  return redirect('/admin/usuarios', 303);
};
