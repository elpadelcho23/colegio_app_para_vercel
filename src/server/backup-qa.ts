import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db, dbPath } from './db.ts';
import { isRemoteTurso } from './db-client.ts';

const qaDir = join(dirname(dbPath), 'backup-qa');
const restorePath = join(qaDir, 'restore-check.sqlite');
const tables = [
  'tenants',
  'usuarios',
  'sessions',
  'cursos',
  'materias',
  'alumnos',
  'docente_cursos',
  'docente_materias',
  'asistencias',
  'notas',
  'calendario_eventos',
  'actividades',
  'actividad_adjuntos',
  'notification_preferences',
  'sync_log',
];

/** `restored` is a standalone better-sqlite3 handle over its own file, never the shared async db. */
function tableExistsSync(database: Database.Database, table: string) {
  return Boolean(database.prepare('SELECT name FROM sqlite_schema WHERE type = ? AND name = ?').get('table', table));
}

function countRowsSync(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

async function tableExistsAsync(table: string) {
  return Boolean(await db.prepare('SELECT name FROM sqlite_schema WHERE type = ? AND name = ?').get('table', table));
}

async function countRowsAsync(table: string) {
  const row = (await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()) as { count: number };
  return row.count;
}

async function main() {
  if (isRemoteTurso()) {
    throw new Error('backup:qa solo funciona con la base de datos SQLite local (no con Turso remoto).');
  }

  mkdirSync(qaDir, { recursive: true });
  if (existsSync(restorePath)) rmSync(restorePath, { force: true });

  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const backupPath = join(dirname(dbPath), 'backups', `aula-clara-qa-${stamp}.sqlite`);
  mkdirSync(dirname(backupPath), { recursive: true });
  if (!existsSync(dbPath)) {
    throw new Error(`No se encontró la base de datos local en ${dbPath}.`);
  }
  copyFileSync(dbPath, backupPath);
  copyFileSync(backupPath, restorePath);

  const restored = new Database(restorePath, { readonly: true });
  try {
    const integrity = restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') {
      throw new Error(`Integridad invalida: ${integrity.integrity_check}`);
    }

    const mismatches: string[] = [];
    for (const table of tables) {
      if (!(await tableExistsAsync(table)) || !tableExistsSync(restored, table)) continue;
      const sourceCount = await countRowsAsync(table);
      const restoredCount = countRowsSync(restored, table);
      if (sourceCount !== restoredCount) {
        mismatches.push(`${table}: origen=${sourceCount}, backup=${restoredCount}`);
      }
    }

    const sampleTenant = restored.prepare(`
      SELECT tenant_id, COUNT(*) AS count
      FROM usuarios
      GROUP BY tenant_id
      LIMIT 1
    `).get() as { tenant_id: string; count: number } | undefined;

    if (!sampleTenant) throw new Error('No hay usuarios para validar tenant.');
    if (mismatches.length) throw new Error(`Conteos distintos: ${mismatches.join('; ')}`);

    console.log(JSON.stringify({
      ok: true,
      backupPath,
      restorePath,
      tenantCheck: sampleTenant,
      checkedTables: tables.length,
    }, null, 2));
  } finally {
    restored.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
