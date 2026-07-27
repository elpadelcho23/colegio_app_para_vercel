import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { db } from '../src/server/db.ts';

const entregaId = fs.readFileSync(process.env.TEMP + '/entrega_id.txt', 'utf8').trim();
const entrega = db.prepare('SELECT id, tenant_id, curso_id, materia_id, alumno_id FROM trabajo_entregas WHERE id = ?').get(entregaId) as any;
if (!entrega) {
  console.log('seed_error=entrega_not_found');
  process.exit(1);
}
console.log('seed_entrega_found=yes');
console.log('seed_has_alumno=' + Boolean(entrega.alumno_id));

let alumnoId = entrega.alumno_id as string | null;
if (!alumnoId) {
  alumnoId = 'a-groq-test-' + randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO alumnos (id, tenant_id, curso_id, nombre, dni, activo, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(alumnoId, entrega.tenant_id, entrega.curso_id, 'Alumno Prueba IA', null, now);

  try {
    db.prepare(`
      INSERT OR IGNORE INTO alumno_materias (tenant_id, alumno_id, materia_id)
      VALUES (?, ?, ?)
    `).run(entrega.tenant_id, alumnoId, entrega.materia_id);
  } catch {
    console.log('seed_alumno_materias_skip=yes');
  }

  db.prepare(`
    UPDATE trabajo_entregas SET alumno_id = ?, updated_at = ? WHERE id = ?
  `).run(alumnoId, now, entregaId);
  console.log('seed_alumno_linked=yes');
} else {
  console.log('seed_alumno_already=yes');
}
console.log('seed_alumno_id_len=' + String(alumnoId).length);
