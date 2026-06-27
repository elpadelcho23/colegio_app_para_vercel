import type { APIRoute } from 'astro';
import { restoreBackup } from '../../../../server/backup';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const name = String(form.get('name') || '');
  await restoreBackup(name);
  return redirect('/admin/usuarios', 303);
};
