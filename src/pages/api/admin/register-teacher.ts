import type { APIRoute } from 'astro';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { isStrongPassword } from '../../../server/auth';
import { db } from '../../../server/db';
import { validateEmailFormat } from '../../../server/auth-email';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (!admin || admin.rol !== 'admin') {
    return Response.json({ error: 'Requiere rol admin.' }, { status: 403 });
  }

  const form = await request.formData();
  const nombre = String(form.get('nombre') || '').trim();
  const email = validateEmailFormat(String(form.get('email') || ''));
  const password = String(form.get('password') || '');
  const cursoIds = form.getAll('cursoIds').map(String);
  const materiaIds = form.getAll('materiaIds').map(String);

  if (!nombre || !email || !isStrongPassword(password)) {
    return Response.json({ error: 'Datos invalidos o contrasena debil.' }, { status: 400 });
  }

  const exists = await db.prepare('SELECT id FROM usuarios WHERE lower(email) = lower(?)').get(email);
  if (exists) return Response.json({ error: 'El email ya esta registrado.' }, { status: 409 });

  // Fase 2: el docente pertenece al mismo tenant del admin institucional.
  // No se crea un tenant nuevo ni memberships (eso es fase posterior).
  const tenantId = admin.tenant_id;

  const allowedCourses = new Set(
    ((await db.prepare('SELECT id FROM cursos WHERE tenant_id = ?').all(tenantId)) as Array<{ id: string }>)
      .map((row) => row.id),
  );
  const allowedSubjects = new Set(
    ((await db.prepare('SELECT id FROM materias WHERE tenant_id = ?').all(tenantId)) as Array<{ id: string }>)
      .map((row) => row.id),
  );

  const safeCursoIds = cursoIds.filter((id) => allowedCourses.has(id));
  const safeMateriaIds = materiaIds.filter((id) => allowedSubjects.has(id));

  const id = `docente-${randomUUID()}`;
  const verifiedAt = new Date().toISOString();
  const tx = db.transaction(async () => {
    // Alta administrativa: se marca verificado (contraseña temporal entregada por el admin).
    await db.prepare(`
      INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol, email_verified_at)
      VALUES (?, ?, ?, ?, ?, 'docente', ?)
    `).run(id, tenantId, nombre, email, bcrypt.hashSync(password, 12), verifiedAt);

    const assignCourse = db.prepare('INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)');
    for (const cursoId of safeCursoIds) await assignCourse.run(tenantId, id, cursoId);

    const assignSubject = db.prepare('INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id) VALUES (?, ?, ?)');
    for (const materiaId of safeMateriaIds) await assignSubject.run(tenantId, id, materiaId);
  });
  await tx();

  return redirect('/admin/usuarios', 303);
};
