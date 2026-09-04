import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { db, dbPath } from './db';
import { isRemoteTurso } from './db-client';

const backupDir = join(dirname(dbPath), 'backups');
const DEFAULT_INTERVAL_HOURS = 24;
let schedulerStarted = false;

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

mkdirSync(backupDir, { recursive: true });

/**
 * File-based backups only make sense for the local SQLite file. When running
 * against a remote Turso database, backups/restores are the provider's
 * responsibility, so these operations become no-ops.
 */
export async function createBackup(reason = 'manual'): Promise<string | null> {
  if (isRemoteTurso()) {
    console.warn('[backup] Skipping file backup: using remote Turso database.');
    return null;
  }

  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const file = join(backupDir, `aula-clara-${reason}-${stamp}.sqlite`);
  if (existsSync(dbPath)) {
    copyFileSync(dbPath, file);
  }
  return file;
}

export function listBackups(): BackupInfo[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => {
      const path = join(backupDir, name);
      const stats = statSync(path);
      return {
        name,
        path,
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreBackup(name: string) {
  if (isRemoteTurso()) {
    throw new Error('La restauración desde archivo no está disponible con la base remota (Turso).');
  }

  const safeName = basename(name);
  if (!safeName.endsWith('.sqlite')) throw new Error('Backup invalido.');

  const source = join(backupDir, safeName);
  if (!existsSync(source)) throw new Error('El backup no existe.');

  await createBackup('pre-restore');

  const restoreTables = [
    'actividad_adjuntos',
    'calendario_eventos',
    'actividades',
    'notification_preferences',
    'sync_log',
    'asistencias',
    'notas',
    'docente_materias',
    'docente_cursos',
    'alumnos',
    'materias',
    'cursos',
    'sessions',
    'usuarios',
    'tenants',
  ];

  await db.prepare('ATTACH DATABASE ? AS backup').run(source);
  try {
    await db.pragma('foreign_keys = OFF');
    const tx = db.transaction(async () => {
      const availableTables: string[] = [];
      for (const table of restoreTables) {
        const inMain = await db.prepare('SELECT name FROM main.sqlite_schema WHERE type = ? AND name = ?').get('table', table);
        const inBackup = await db.prepare('SELECT name FROM backup.sqlite_schema WHERE type = ? AND name = ?').get('table', table);
        if (inMain && inBackup) availableTables.push(table);
      }

      for (const table of availableTables) {
        await db.prepare(`DELETE FROM main.${table}`).run();
      }
      for (const table of [...availableTables].reverse()) {
        // Compatible con migraciones additive: solo columnas presentes en ambos lados.
        // Columnas nuevas en main conservan DEFAULT; no falla si el backup es más viejo.
        const mainCols = ((await db.prepare(`PRAGMA main.table_info(${table})`).all()) as Array<{ name: string }>)
          .map((col) => col.name);
        const backupCols = ((await db.prepare(`PRAGMA backup.table_info(${table})`).all()) as Array<{ name: string }>)
          .map((col) => col.name);
        const common = mainCols.filter((name) => backupCols.includes(name));
        if (common.length === 0) continue;
        const cols = common.join(', ');
        await db.prepare(`INSERT INTO main.${table} (${cols}) SELECT ${cols} FROM backup.${table}`).run();
      }
    });
    await tx();
  } finally {
    await db.prepare('DETACH DATABASE backup').run();
    await db.pragma('foreign_keys = ON');
  }
}

export function startBackupScheduler() {
  if (schedulerStarted) return;
  if (isRemoteTurso()) return;
  schedulerStarted = true;

  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || DEFAULT_INTERVAL_HOURS);
  const intervalMs = Math.max(1, hours) * 60 * 60 * 1000;

  windowlessBackup().catch((error) => {
    console.error('[backup] initial backup failed', error);
  });

  setInterval(() => {
    windowlessBackup().catch((error) => {
      console.error('[backup] scheduled backup failed', error);
    });
  }, intervalMs).unref?.();
}

async function windowlessBackup() {
  const latest = listBackups()[0];
  const minAgeMs = 30 * 60 * 1000;
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < minAgeMs) return;
  await createBackup('auto');
}

export function copyBackupToExternalDir(name: string, externalDir: string) {
  const safeName = basename(name);
  const source = join(backupDir, safeName);
  if (!existsSync(source)) throw new Error('El backup no existe.');
  mkdirSync(externalDir, { recursive: true });
  copyFileSync(source, join(externalDir, safeName));
}
