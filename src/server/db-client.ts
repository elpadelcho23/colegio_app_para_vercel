/**
 * Conector unificado de base de datos.
 *
 * - Producción (Vercel): `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`) → Turso / LibSQL remoto.
 * - Desarrollo local: sin esa variable → SQLite en `.data/aula-clara.sqlite` vía `@libsql/client`
 *   (modo `file:`). Se usa LibSQL también en local porque toda la app es async y las transacciones
 *   de `better-sqlite3` son síncronas; `better-sqlite3` queda solo para herramientas QA/backup.
 *
 * Todas las consultas deben usar `db.prepare(...).get/all/run(...)` con parámetros (`?` / `@name`).
 */
import { createClient, type Client, type InArgs, type ResultSet, type Transaction } from '@libsql/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const localDbDir = join(dirname(fileURLToPath(import.meta.url)), '../../.data');
const vercelDbDir = '/tmp/aula-clara-data';

export const dbPath = join(process.env.VERCEL ? vercelDbDir : localDbDir, 'aula-clara.sqlite');

export type DbBackend = 'turso' | 'sqlite-local';

/** true cuando hay URL de Turso configurada (producción durable). */
export function isRemoteTurso() {
  return Boolean(process.env.TURSO_DATABASE_URL?.trim());
}

export function getDbBackend(): DbBackend {
  return isRemoteTurso() ? 'turso' : 'sqlite-local';
}

function resolveClientUrl() {
  const remote = process.env.TURSO_DATABASE_URL?.trim();
  if (remote) return remote;

  if (process.env.VERCEL) {
    console.error(
      '[db] TURSO_DATABASE_URL no está configurada en Vercel. '
      + 'La app usará SQLite en /tmp (efímero entre instancias). '
      + 'Configurá TURSO_DATABASE_URL y TURSO_AUTH_TOKEN en el proyecto.',
    );
  }

  mkdirSync(process.env.VERCEL ? vercelDbDir : localDbDir, { recursive: true });
  return `file:${dbPath.replace(/\\/g, '/')}`;
}

type Executor = Pick<Client, 'execute' | 'executeMultiple' | 'batch'>;

const txStore = new AsyncLocalStorage<Transaction>();

let client: Client | null = null;

export function getLibsqlClient(): Client {
  if (!client) {
    const url = resolveClientUrl();
    client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    });
  }
  return client;
}

function executor(): Executor {
  return txStore.getStore() || getLibsqlClient();
}

/** LibSQL descarta `undefined` en HTTP y descuadra el conteo de args; normalizar a null. */
function sanitizeSqlValue(value: unknown): unknown {
  return value === undefined ? null : value;
}

function namedPlaceholders(sql: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of sql.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function normalizeArgs(args: unknown[], allowedNamedKeys: string[] = []): InArgs | undefined {
  if (args.length === 0) return undefined;

  // .run([a, b, c]) → args posicionales (no anidar el array)
  if (args.length === 1 && Array.isArray(args[0])) {
    return (args[0] as unknown[]).map(sanitizeSqlValue) as InArgs;
  }

  if (
    args.length === 1
    && args[0] !== null
    && typeof args[0] === 'object'
    && !Array.isArray(args[0])
    && !(args[0] instanceof Uint8Array)
  ) {
    const source = args[0] as Record<string, unknown>;
    const named: Record<string, unknown> = {};
    // Si el SQL usa @params, enviar SOLO esas claves (evita "expected N, got N+1" por spreads).
    const keys = allowedNamedKeys.length > 0 ? allowedNamedKeys : Object.keys(source);
    for (const key of keys) {
      named[key] = sanitizeSqlValue(source[key]);
    }
    return named as InArgs;
  }
  return args.map(sanitizeSqlValue) as InArgs;
}

function rowsFromResult(result: ResultSet): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of result.columns) {
      out[col] = (row as Record<string, unknown>)[col];
    }
    return out;
  });
}

export type RunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

export type Statement = {
  get: <T = Record<string, unknown>>(...args: unknown[]) => Promise<T | undefined>;
  all: <T = Record<string, unknown>>(...args: unknown[]) => Promise<T[]>;
  run: (...args: unknown[]) => Promise<RunResult>;
};

function prepare(sql: string): Statement {
  const allowedNamedKeys = namedPlaceholders(sql);
  return {
    async get<T = Record<string, unknown>>(...args: unknown[]) {
      const result = await executor().execute({ sql, args: normalizeArgs(args, allowedNamedKeys) });
      const rows = rowsFromResult(result);
      return rows[0] as T | undefined;
    },
    async all<T = Record<string, unknown>>(...args: unknown[]) {
      const result = await executor().execute({ sql, args: normalizeArgs(args, allowedNamedKeys) });
      return rowsFromResult(result) as T[];
    },
    async run(...args: unknown[]) {
      const result = await executor().execute({ sql, args: normalizeArgs(args, allowedNamedKeys) });
      return {
        changes: Number(result.rowsAffected || 0),
        lastInsertRowid: result.lastInsertRowid ?? 0,
      };
    },
  };
}

async function exec(sql: string) {
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (statements.length === 0) return;
  if (statements.length === 1) {
    await executor().execute(statements[0]);
    return;
  }
  try {
    await executor().executeMultiple(sql);
  } catch {
    for (const statement of statements) {
      await executor().execute(statement);
    }
  }
}

async function pragma(pragmaSql: string) {
  const normalized = pragmaSql.trim().replace(/;+\s*$/, '');
  if (/^foreign_keys\s*=/i.test(normalized)) {
    await exec(`PRAGMA ${normalized}`);
    return;
  }
  if (/^journal_mode\s*=/i.test(normalized)) {
    if (!isRemoteTurso()) await exec(`PRAGMA ${normalized}`);
    return;
  }
  await exec(`PRAGMA ${normalized}`);
}

function transaction<T>(fn: () => Promise<T> | T): () => Promise<T> {
  return async () => {
    const c = getLibsqlClient();
    const tx = await c.transaction('write');
    try {
      const result = await txStore.run(tx, async () => await fn());
      await tx.commit();
      return result;
    } catch (error) {
      try {
        await tx.rollback();
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
  };
}

/** API async compatible en toda la app (Turso remoto o SQLite local). */
export const db = {
  prepare,
  exec,
  pragma,
  transaction,
};

export type AppDb = typeof db;
