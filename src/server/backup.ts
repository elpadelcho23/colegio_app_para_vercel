import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { db, dbPath } from './db';

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

export async function createBackup(reason = 'manual') {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const file = join(backupDir, `aula-clara-${reason}-${stamp}.sqlite`);
  await db.backup(file);
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

  db.prepare('ATTACH DATABASE ? AS backup').run(source);
  try {
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      const availableTables = restoreTables.filter((table) => {
        const inMain = db.prepare('SELECT name FROM main.sqlite_schema WHERE type = ? AND name = ?').get('table', table);
        const inBackup = db.prepare('SELECT name FROM backup.sqlite_schema WHERE type = ? AND name = ?').get('table', table);
        return inMain && inBackup;
      });

      for (const table of availableTables) {
        db.prepare(`DELETE FROM main.${table}`).run();
      }
      for (const table of [...availableTables].reverse()) {
        db.prepare(`INSERT INTO main.${table} SELECT * FROM backup.${table}`).run();
      }
    });
    tx();
  } finally {
    db.prepare('DETACH DATABASE backup').run();
    db.pragma('foreign_keys = ON');
  }
}

export function startBackupScheduler() {
  if (schedulerStarted) return;
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
