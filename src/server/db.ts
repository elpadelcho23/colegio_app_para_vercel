import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { db, dbPath, getDbBackend, isRemoteTurso } from './db-client';

/**
 * Persistencia de Aula Clara.
 * - Con `TURSO_DATABASE_URL`: Turso/LibSQL (producción serverless).
 * - Sin ella: SQLite local en `.data/` vía LibSQL file: (dev).
 * Ver `db-client.ts`. Consultas siempre con parámetros preparados.
 */
export { db, dbPath, getDbBackend, isRemoteTurso };

export const DEFAULT_TENANT_ID = 'tenant-demo';
export const ADMIN_TENANT_ID = 'tenant-admin';

export interface User {
  id: string;
  tenant_id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'docente';
  is_guest?: boolean;
}

export async function createTenant(nombre: string, id = `tenant-${randomBytes(8).toString('hex')}`) {
  await db.prepare(`
    INSERT OR IGNORE INTO tenants (id, nombre)
    VALUES (?, ?)
  `).run(id, nombre.trim() || 'Cuenta docente');
  return id;
}

export async function createUser(user: Omit<User, 'id' | 'tenant_id'> & { password: string; tenant_id?: string }) {
  const email = String(user.email).trim().toLowerCase();
  const existing = await db.prepare('SELECT id FROM usuarios WHERE lower(email) = lower(?)').get(email);
  if (existing) return null;

  const id = `docente-${randomBytes(8).toString('hex')}`;
  const tenantId = user.tenant_id || (await createTenant(`Cuenta de ${user.nombre.trim() || email}`));
  await db.prepare(`
    INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run([
    id,
    tenantId,
    user.nombre.trim(),
    email,
    bcrypt.hashSync(user.password, 12),
    user.rol ?? null,
  ]);

  return { id, tenant_id: tenantId, nombre: user.nombre.trim(), email, rol: user.rol, is_guest: false } as User;
}

/** Cuenta efímera aislada: tenant propio, sin persistencia entre visitas. */
export async function createGuestUser(): Promise<User> {
  const suffix = randomBytes(8).toString('hex');
  const id = `guest-${suffix}`;
  const email = `guest-${suffix}@guest.local`;
  const tenantId = await createTenant(`Invitado ${suffix}`);
  const password = randomBytes(24).toString('base64url');

  await db.prepare(`
    INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol, is_guest)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run([
    id,
    tenantId,
    'Invitado',
    email,
    bcrypt.hashSync(password, 10),
    'docente',
    1,
  ]);

  const user: User = {
    id,
    tenant_id: tenantId,
    nombre: 'Invitado',
    email,
    rol: 'docente',
    is_guest: true,
  };

  await seedGuestDemoData(user);
  return user;
}

/**
 * Datos de prueba para que el invitado pueda usar panel, asistencia, notas y clase virtual
 * sin tener que importar Excel primero. IDs únicos por usuario (PK global).
 */
export async function seedGuestDemoData(user: User) {
  if (!user?.is_guest) return;

  const tenantId = user.tenant_id;
  const prefix = user.id;
  const now = new Date().toISOString();

  const schoolId = `${prefix}-escuela-1`;
  const cursoManana = `${prefix}-curso-6-1-manana`;
  const cursoTarde = `${prefix}-curso-5-2-tarde`;
  const matMate = `${prefix}-matematica`;
  const matProg = `${prefix}-programacion`;
  const matLit = `${prefix}-literatura`;
  const al1 = `${prefix}-al-1`;
  const al2 = `${prefix}-al-2`;
  const al3 = `${prefix}-al-3`;

  const existing = (await db.prepare('SELECT 1 AS ok FROM cursos WHERE tenant_id = ? LIMIT 1').get(tenantId)) as
    | { ok: number }
    | undefined;
  if (existing) return;

  const tx = db.transaction(async () => {
    await db.prepare('INSERT OR IGNORE INTO escuelas (id, tenant_id, nombre) VALUES (?, ?, ?)').run(
      schoolId,
      tenantId,
      'Escuela Tecnica 1',
    );

    const insertCourse = db.prepare(`
      INSERT OR IGNORE INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    await insertCourse.run(cursoManana, tenantId, 'Escuela Tecnica 1', '6to 1ra', 'Manana', 2026, now);
    await insertCourse.run(cursoTarde, tenantId, 'Escuela Tecnica 1', '5to 2da', 'Tarde', 2026, now);

    const insertSubject = db.prepare(`
      INSERT OR IGNORE INTO materias (id, tenant_id, nombre, activo, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `);
    await insertSubject.run(matMate, tenantId, 'Matematica', now);
    await insertSubject.run(matProg, tenantId, 'Programacion', now);
    await insertSubject.run(matLit, tenantId, 'Literatura', now);

    const insertStudent = db.prepare(`
      INSERT OR IGNORE INTO alumnos (id, tenant_id, curso_id, nombre, dni, tutor, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    await insertStudent.run(al1, tenantId, cursoManana, 'Martina Ruiz', '44111222', 'Laura Ruiz', now);
    await insertStudent.run(al2, tenantId, cursoManana, 'Tomas Pereyra', '45222333', 'Ruben Pereyra', now);
    await insertStudent.run(al3, tenantId, cursoTarde, 'Sofia Molina', '46333444', 'Ana Molina', now);

    await db.prepare('INSERT OR IGNORE INTO docente_escuelas (tenant_id, docente_id, escuela_id) VALUES (?, ?, ?)').run(
      tenantId,
      user.id,
      schoolId,
    );
    await db.prepare('INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)').run(
      tenantId,
      user.id,
      cursoManana,
    );
    await db.prepare('INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)').run(
      tenantId,
      user.id,
      cursoTarde,
    );
    for (const materiaId of [matMate, matProg, matLit]) {
      await db.prepare('INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id) VALUES (?, ?, ?)').run(
        tenantId,
        user.id,
        materiaId,
      );
    }

    const assignStudentSubject = db.prepare(
      'INSERT OR IGNORE INTO alumno_materias (tenant_id, alumno_id, materia_id) VALUES (?, ?, ?)',
    );
    await assignStudentSubject.run(tenantId, al1, matMate);
    await assignStudentSubject.run(tenantId, al1, matProg);
    await assignStudentSubject.run(tenantId, al2, matMate);
    await assignStudentSubject.run(tenantId, al2, matProg);
    await assignStudentSubject.run(tenantId, al3, matLit);

    const insertGrade = db.prepare(`
      INSERT OR IGNORE INTO notas (
        id, tenant_id, docente_id, alumno_id, materia_id, titulo, tipo_evaluacion, valor, peso, fecha, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    await insertGrade.run(
      `${prefix}-nota-1`,
      tenantId,
      user.id,
      al1,
      matProg,
      'TP HTML',
      'TP',
      8,
      60,
      now.slice(0, 10),
      now,
    );
    await insertGrade.run(
      `${prefix}-nota-2`,
      tenantId,
      user.id,
      al2,
      matProg,
      'Integrador',
      'Integrador',
      5,
      100,
      now.slice(0, 10),
      now,
    );

    const insertAttendance = db.prepare(`
      INSERT OR IGNORE INTO asistencias (
        id, tenant_id, docente_id, alumno_id, materia_id, fecha, estado, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    await insertAttendance.run(`${prefix}-asis-1`, tenantId, user.id, al2, matProg, '2026-03-10', 'ausente', now);
    await insertAttendance.run(`${prefix}-asis-2`, tenantId, user.id, al2, matProg, '2026-03-12', 'ausente', now);
    await insertAttendance.run(`${prefix}-asis-3`, tenantId, user.id, al1, matProg, '2026-03-10', 'presente', now);
  });

  await tx();
}

/**
 * Asegura curso/materia/vínculos del docente (p. ej. datos solo en localStorage).
 * Si el id ya existe en otro tenant (PK global en SQLite compartido/ephemeral),
 * remapea a un id scoped al tenant para no corromper ni fallar en silencio.
 */
export async function ensureTeachingContextRows(input: {
  user: User;
  cursoId: string;
  materiaId: string;
  colegio: string;
  turno: string;
  cursoNombre?: string;
  materiaNombre?: string;
}): Promise<{ cursoId: string; materiaId: string }> {
  const tenantId = input.user.tenant_id;
  const now = new Date().toISOString();
  const desiredCursoId = String(input.cursoId || '').trim();
  const desiredMateriaId = String(input.materiaId || '').trim();
  if (!desiredCursoId || !desiredMateriaId) return { cursoId: '', materiaId: '' };

  async function resolveOwnedId(table: 'cursos' | 'materias', desiredId: string): Promise<string> {
    const row = (await db.prepare(`SELECT tenant_id FROM ${table} WHERE id = ?`).get(desiredId)) as
      | { tenant_id: string }
      | undefined;
    if (!row || row.tenant_id === tenantId) return desiredId;

    const remapped = `${desiredId}~${tenantId}`;
    const again = (await db.prepare(`SELECT tenant_id FROM ${table} WHERE id = ?`).get(remapped)) as
      | { tenant_id: string }
      | undefined;
    if (!again || again.tenant_id === tenantId) return remapped;
    return `${desiredId}~${tenantId}~${randomBytes(4).toString('hex')}`;
  }

  const cursoId = await resolveOwnedId('cursos', desiredCursoId);
  const materiaId = await resolveOwnedId('materias', desiredMateriaId);

  const tx = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        escuela = excluded.escuela,
        nombre = excluded.nombre,
        turno = excluded.turno,
        updated_at = excluded.updated_at
      WHERE cursos.tenant_id = excluded.tenant_id
    `).run(
      cursoId,
      tenantId,
      String(input.colegio || 'Escuela').trim() || 'Escuela',
      String(input.cursoNombre || desiredCursoId).trim() || desiredCursoId,
      String(input.turno || 'Manana').trim() || 'Manana',
      2026,
      now,
    );

    await db.prepare(`
      INSERT INTO materias (id, tenant_id, nombre, activo, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        nombre = excluded.nombre,
        activo = 1,
        updated_at = excluded.updated_at
      WHERE materias.tenant_id = excluded.tenant_id
    `).run(
      materiaId,
      tenantId,
      String(input.materiaNombre || desiredMateriaId).trim() || desiredMateriaId,
      now,
    );

    await db.prepare('INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)').run(
      tenantId,
      input.user.id,
      cursoId,
    );
    await db.prepare('INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id) VALUES (?, ?, ?)').run(
      tenantId,
      input.user.id,
      materiaId,
    );
  });

  await tx();
  return { cursoId, materiaId };
}

export async function getUserById(userId: string): Promise<User | null> {
  const row = (await db.prepare(`
    SELECT id, tenant_id, nombre, email, rol, COALESCE(is_guest, 0) AS is_guest
    FROM usuarios
    WHERE id = ?
  `).get(userId)) as (Omit<User, 'is_guest'> & { is_guest: number }) | undefined;

  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    nombre: row.nombre,
    email: row.email,
    rol: row.rol,
    is_guest: Boolean(row.is_guest),
  };
}

/**
 * Elimina usuario invitado + tenant (y datos asociados por CASCADE).
 * No-op si el usuario no existe o no es invitado (salvo que se pase tenantId del passport).
 */
export async function purgeGuestAccount(userId: string, tenantIdHint?: string) {
  const user = await getUserById(userId);
  if (user && !user.is_guest) return false;

  const tenantId = user?.tenant_id || tenantIdHint;
  if (!tenantId && !user) return false;

  const purge = db.transaction(async () => {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    // Borrar tablas hijas por si algún FK no hace CASCADE en migraciones viejas
    if (tenantId) {
      try {
        await db.prepare(`
          DELETE FROM aula_intento_eventos
          WHERE intento_id IN (SELECT id FROM aula_intentos WHERE tenant_id = ?)
        `).run(tenantId);
      } catch {
        // ignore
      }
      try {
        await db.prepare('DELETE FROM aula_intentos WHERE tenant_id = ?').run(tenantId);
      } catch {
        // ignore
      }
      try {
        await db.prepare(`
          DELETE FROM actividad_preguntas
          WHERE actividad_id IN (SELECT id FROM actividades WHERE tenant_id = ?)
        `).run(tenantId);
      } catch {
        // ignore
      }
      const tables = [
        'aulas_temporales',
        'trabajo_archivos',
        'trabajo_entregas',
        'actividades',
        'calendario_eventos',
        'notas',
        'asistencias',
        'alumno_materias',
        'alumnos',
        'docente_materias',
        'docente_cursos',
        'docente_escuelas',
        'materias',
        'cursos',
        'escuelas',
        'sync_log',
        'notification_preferences',
      ];
      for (const table of tables) {
        try {
          await db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(tenantId);
        } catch {
          // tabla puede no existir en schemas viejos
        }
      }
    }
    await db.prepare('DELETE FROM usuarios WHERE id = ?').run(userId);
    if (tenantId) {
      await db.prepare('DELETE FROM tenants WHERE id = ?').run(tenantId);
    }
  });
  await purge();
  return true;
}

/** Borra invitados sin sesión vigente (cierres abruptos / cookies vencidas). */
export async function purgeExpiredGuestAccounts() {
  const rows = (await db.prepare(`
    SELECT u.id
    FROM usuarios u
    WHERE COALESCE(u.is_guest, 0) = 1
      AND NOT EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.user_id = u.id
          AND s.expires_at > datetime('now')
      )
  `).all()) as Array<{ id: string }>;

  let purged = 0;
  for (const row of rows) {
    if (await purgeGuestAccount(row.id)) purged += 1;
  }
  return purged;
}

let readyPromise: Promise<void> | null = null;

/** Idempotente: primer caller dispara la inicialización, el resto espera la misma promesa. */
export async function ensureDbReady() {
  if (!readyPromise) readyPromise = initSchema();
  return readyPromise;
}

async function initSchema() {
  await db.pragma('foreign_keys = ON');
  if (!isRemoteTurso()) await db.pragma('journal_mode = WAL');

  await db.exec(`
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    nombre TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('admin', 'docente')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cursos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    escuela TEXT NOT NULL,
    nombre TEXT NOT NULL,
    turno TEXT NOT NULL,
    ciclo_lectivo INTEGER NOT NULL DEFAULT 2026,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS materias (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    nombre TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS escuelas (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    nombre TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS docente_escuelas (
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    docente_id TEXT NOT NULL,
    escuela_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, docente_id, escuela_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (escuela_id) REFERENCES escuelas(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alumnos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    curso_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    dni TEXT,
    tutor TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, dni),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS docente_cursos (
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    docente_id TEXT NOT NULL,
    curso_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, docente_id, curso_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS docente_materias (
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    docente_id TEXT NOT NULL,
    materia_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, docente_id, materia_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alumno_materias (
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    alumno_id TEXT NOT NULL,
    materia_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, alumno_id, materia_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (alumno_id) REFERENCES alumnos(id) ON DELETE CASCADE,
    FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS asistencias (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    docente_id TEXT NOT NULL,
    alumno_id TEXT NOT NULL,
    materia_id TEXT NOT NULL,
    fecha TEXT NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('presente', 'ausente')),
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (docente_id, alumno_id, materia_id, fecha),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (alumno_id) REFERENCES alumnos(id) ON DELETE CASCADE,
    FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notas (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    docente_id TEXT NOT NULL,
    alumno_id TEXT NOT NULL,
    materia_id TEXT NOT NULL,
    titulo TEXT NOT NULL,
    tipo_evaluacion TEXT,
    valor REAL CHECK (valor IS NULL OR (valor >= 1 AND valor <= 10)),
    calificacion_texto TEXT,
    peso REAL NOT NULL DEFAULT 100,
    fecha TEXT NOT NULL,
    fecha_entrega TEXT,
    periodo TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (alumno_id) REFERENCES alumnos(id) ON DELETE CASCADE,
    FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS calendario_eventos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    docente_id TEXT NOT NULL,
    curso_id TEXT,
    materia_id TEXT,
    tipo TEXT NOT NULL CHECK (tipo IN ('evaluacion', 'tp', 'cierre_tp', 'asistencia', 'nota', 'evento', 'ausencia', 'lluvia', 'salida_educativa', 'acto', 'jornada')),
    titulo TEXT NOT NULL,
    descripcion TEXT,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT,
    source_type TEXT,
    source_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS actividades (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    docente_id TEXT NOT NULL,
    colegio TEXT NOT NULL,
    turno TEXT NOT NULL,
    curso_id TEXT NOT NULL,
    materia_id TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('evaluacion', 'tp')),
    titulo TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'borrador',
    fecha_publicacion TEXT,
    fecha_vencimiento TEXT,
    contenido_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE CASCADE,
    FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS actividad_adjuntos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    actividad_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trabajo_entregas (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    docente_id TEXT NOT NULL,
    actividad_id TEXT,
    alumno_id TEXT,
    curso_id TEXT NOT NULL,
    materia_id TEXT NOT NULL,
    colegio TEXT NOT NULL,
    turno TEXT NOT NULL,
    titulo TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'enviado' CHECK (estado IN ('enviado', 'calificado')),
    nota_id TEXT,
    observaciones TEXT,
    correccion_json TEXT,
    corregido_at TEXT,
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE SET NULL,
    FOREIGN KEY (alumno_id) REFERENCES alumnos(id) ON DELETE SET NULL,
    FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE RESTRICT,
    FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS trabajo_archivos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    entrega_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (entrega_id) REFERENCES trabajo_entregas(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    calendar_alerts INTEGER NOT NULL DEFAULT 0,
    lead_days INTEGER NOT NULL DEFAULT 3,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    client_mutation_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    docente_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS actividad_preguntas (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    actividad_id TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0,
    tipo TEXT NOT NULL CHECK (tipo IN ('mc_single', 'mc_multi', 'corta', 'abierta')),
    enunciado TEXT NOT NULL,
    opciones_json TEXT,
    correctas_json TEXT,
    puntaje REAL NOT NULL DEFAULT 1,
    explicacion TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE
  );

    CREATE TABLE IF NOT EXISTS aulas_temporales (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      docente_id TEXT NOT NULL,
      actividad_id TEXT NOT NULL,
      curso_id TEXT NOT NULL,
      join_token TEXT NOT NULL UNIQUE,
      modo TEXT NOT NULL CHECK (modo IN ('multiple_choice', 'actividad_preguntas', 'examen')),
      duracion_minutos INTEGER NOT NULL DEFAULT 40,
      expires_at TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
      anti_trampa_json TEXT NOT NULL DEFAULT '{}',
      mostrar_nota_al_alumno INTEGER NOT NULL DEFAULT 1,
      titulo TEXT,
      publicada INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE,
      FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE CASCADE
    );

  CREATE TABLE IF NOT EXISTS aula_intentos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    aula_id TEXT NOT NULL,
    alumno_id TEXT,
    nombre TEXT NOT NULL,
    apellido TEXT NOT NULL,
    nombre_key TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    submitted_at TEXT,
    respuestas_json TEXT NOT NULL DEFAULT '{}',
    pregunta_order_json TEXT,
    opciones_order_json TEXT,
    puntaje REAL,
    nota_10 REAL,
    nota_id TEXT,
    flags_json TEXT NOT NULL DEFAULT '[]',
    estado TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'entregado', 'vencido', 'bloqueado')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (aula_id, nombre_key),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (aula_id) REFERENCES aulas_temporales(id) ON DELETE CASCADE,
    FOREIGN KEY (alumno_id) REFERENCES alumnos(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_alumnos_curso ON alumnos(curso_id);
`);

  await migrateTenancy();
  await migrateAcademicStructure();
  await migrateAlumnosDniTenancy();
  await migrateTrabajoCorreccion();
  await migrateGuestFlag();
  await migrateAulaTemporal();
  await createIndexes();
  await setSchemaVersion(1);

  try {
    await seed();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/UNIQUE constraint failed/i.test(message)) {
      console.warn('[db] seed omitido (datos ya existentes):', message);
      return;
    }
    throw error;
  }
}

async function setSchemaVersion(version: number) {
  await db.prepare(`
    INSERT INTO schema_meta (key, value, updated_at)
    VALUES ('schema_version', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(String(version));
}

async function tableColumns(table: string) {
  return (await db.prepare(`PRAGMA table_info(${table})`).all()) as Array<{ name: string }>;
}

function isDuplicateColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /duplicate column name/i.test(message) || /already exists/i.test(message);
}

async function ensureColumn(table: string, column: string, ddl: string) {
  const columns = await tableColumns(table);
  const target = column.toLowerCase();
  if (columns.some((item) => String(item.name || '').toLowerCase() === target)) return;

  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  } catch (error) {
    // Idempotente: en Turso/LibSQL PRAGMA table_info a veces no refleja columnas ya migradas.
    if (isDuplicateColumnError(error)) {
      console.log(`[db] Columna ya existe, se omite ALTER: ${table}.${column}`);
      return;
    }
    throw error;
  }
}

async function migrateTrabajoCorreccion() {
  await ensureColumn('trabajo_entregas', 'correccion_json', 'correccion_json TEXT');
  await ensureColumn('trabajo_entregas', 'corregido_at', 'corregido_at TEXT');
}

async function migrateGuestFlag() {
  await ensureColumn('usuarios', 'is_guest', 'is_guest INTEGER NOT NULL DEFAULT 0');
}

async function migrateAulaTemporal() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS actividad_preguntas (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      actividad_id TEXT NOT NULL,
      orden INTEGER NOT NULL DEFAULT 0,
      tipo TEXT NOT NULL CHECK (tipo IN ('mc_single', 'mc_multi', 'corta', 'abierta')),
      enunciado TEXT NOT NULL,
      opciones_json TEXT,
      correctas_json TEXT,
      puntaje REAL NOT NULL DEFAULT 1,
      explicacion TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS aulas_temporales (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      docente_id TEXT NOT NULL,
      actividad_id TEXT NOT NULL,
      curso_id TEXT NOT NULL,
      join_token TEXT NOT NULL UNIQUE,
      modo TEXT NOT NULL CHECK (modo IN ('multiple_choice', 'actividad_preguntas', 'examen')),
      duracion_minutos INTEGER NOT NULL DEFAULT 40,
      expires_at TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
      anti_trampa_json TEXT NOT NULL DEFAULT '{}',
      mostrar_nota_al_alumno INTEGER NOT NULL DEFAULT 1,
      titulo TEXT,
      publicada INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE,
      FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS aula_intentos (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      aula_id TEXT NOT NULL,
      alumno_id TEXT,
      nombre TEXT NOT NULL,
      apellido TEXT NOT NULL,
      nombre_key TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      submitted_at TEXT,
      respuestas_json TEXT NOT NULL DEFAULT '{}',
      pregunta_order_json TEXT,
      opciones_order_json TEXT,
      puntaje REAL,
      nota_10 REAL,
      nota_id TEXT,
      flags_json TEXT NOT NULL DEFAULT '[]',
      estado TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'entregado', 'vencido', 'bloqueado')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (aula_id, nombre_key),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (aula_id) REFERENCES aulas_temporales(id) ON DELETE CASCADE,
      FOREIGN KEY (alumno_id) REFERENCES alumnos(id) ON DELETE SET NULL
    );
  `);

  await ensureColumn('aulas_temporales', 'publicada', 'publicada INTEGER NOT NULL DEFAULT 0');
}

async function tableSql(table: string) {
  return ((await db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table)) as { sql: string } | undefined)?.sql || '';
}

async function migrateAcademicStructure() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS alumno_materias (
      tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
      alumno_id TEXT NOT NULL,
      materia_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, alumno_id, materia_id),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (alumno_id) REFERENCES alumnos(id) ON DELETE CASCADE,
      FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE CASCADE
    );
  `);

  const notasSql = await tableSql('notas');
  if (notasSql.includes('valor REAL NOT NULL')) {
    await db.exec('PRAGMA foreign_keys = OFF;');
    await db.exec(`
      CREATE TABLE notas_migrated (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
        docente_id TEXT NOT NULL,
        alumno_id TEXT NOT NULL,
        materia_id TEXT NOT NULL,
        titulo TEXT NOT NULL,
        tipo_evaluacion TEXT,
        valor REAL CHECK (valor IS NULL OR (valor >= 1 AND valor <= 10)),
        calificacion_texto TEXT,
        peso REAL NOT NULL DEFAULT 100,
        fecha TEXT NOT NULL,
        fecha_entrega TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        FOREIGN KEY (alumno_id) REFERENCES alumnos(id) ON DELETE CASCADE,
        FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE CASCADE
      );

      INSERT INTO notas_migrated (
        id, tenant_id, docente_id, alumno_id, materia_id, titulo, valor, peso, fecha, updated_at, created_at
      )
      SELECT id, tenant_id, docente_id, alumno_id, materia_id, titulo, valor, peso, fecha, updated_at, created_at
      FROM notas;

      DROP TABLE notas;
      ALTER TABLE notas_migrated RENAME TO notas;
    `);
    await db.exec('PRAGMA foreign_keys = ON;');
  }

  await ensureColumn('notas', 'tipo_evaluacion', 'tipo_evaluacion TEXT');
  await ensureColumn('notas', 'calificacion_texto', 'calificacion_texto TEXT');
  await ensureColumn('notas', 'fecha_entrega', 'fecha_entrega TEXT');
  await ensureColumn('notas', 'periodo', 'periodo TEXT');
  await ensureColumn('notas', 'motivo', 'motivo TEXT');

  const calendarioSql = await tableSql('calendario_eventos');
  if (calendarioSql.includes("CHECK (tipo IN ('evaluacion', 'tp', 'cierre_tp', 'asistencia', 'nota', 'evento'))")) {
    await db.exec('PRAGMA foreign_keys = OFF;');
    await db.exec(`
      CREATE TABLE calendario_eventos_migrated (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        docente_id TEXT NOT NULL,
        curso_id TEXT,
        materia_id TEXT,
        tipo TEXT NOT NULL CHECK (tipo IN ('evaluacion', 'tp', 'cierre_tp', 'asistencia', 'nota', 'evento', 'ausencia', 'lluvia', 'salida_educativa', 'acto', 'jornada')),
        titulo TEXT NOT NULL,
        descripcion TEXT,
        fecha_inicio TEXT NOT NULL,
        fecha_fin TEXT,
        source_type TEXT,
        source_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE
      );

      INSERT INTO calendario_eventos_migrated (
        id, tenant_id, docente_id, curso_id, materia_id, tipo, titulo, descripcion, fecha_inicio, fecha_fin, source_type, source_id, created_at, updated_at
      )
      SELECT id, tenant_id, docente_id, curso_id, materia_id, tipo, titulo, descripcion, fecha_inicio, fecha_fin, source_type, source_id, created_at, updated_at
      FROM calendario_eventos;

      DROP TABLE calendario_eventos;
      ALTER TABLE calendario_eventos_migrated RENAME TO calendario_eventos;
    `);
    await db.exec('PRAGMA foreign_keys = ON;');
  }
}

async function migrateAlumnosDniTenancy() {
  const alumnosSql = await tableSql('alumnos');
  if (!alumnosSql || !/dni\s+TEXT\s+UNIQUE/i.test(alumnosSql)) return;

  await db.exec('PRAGMA foreign_keys = OFF;');
  await db.exec(`
    CREATE TABLE alumnos_migrated (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
      curso_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      dni TEXT,
      tutor TEXT,
      activo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, dni),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE RESTRICT
    );

    INSERT INTO alumnos_migrated (
      id, tenant_id, curso_id, nombre, dni, tutor, activo, created_at, updated_at
    )
    SELECT id, tenant_id, curso_id, nombre, dni, tutor, activo, created_at, updated_at
    FROM alumnos;

    DROP TABLE alumnos;
    ALTER TABLE alumnos_migrated RENAME TO alumnos;
  `);
  await db.exec('PRAGMA foreign_keys = ON;');
}

async function migrateTenancy() {
  await db.prepare('INSERT OR IGNORE INTO tenants (id, nombre) VALUES (?, ?)').run(DEFAULT_TENANT_ID, 'Cuenta demo');
  await db.prepare('INSERT OR IGNORE INTO tenants (id, nombre) VALUES (?, ?)').run(ADMIN_TENANT_ID, 'Administracion');

  await ensureColumn('usuarios', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  await ensureColumn('cursos', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  await ensureColumn('materias', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  await ensureColumn('materias', 'activo', 'activo INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('alumnos', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  await ensureColumn('docente_cursos', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  await ensureColumn('docente_materias', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  await ensureColumn('asistencias', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  await ensureColumn('notas', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  await ensureColumn('sync_log', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);

  await db.prepare(`
    UPDATE usuarios
    SET tenant_id = CASE WHEN rol = 'admin' THEN ? ELSE ? END
    WHERE tenant_id IS NULL OR tenant_id = ''
  `).run(ADMIN_TENANT_ID, DEFAULT_TENANT_ID);

  for (const table of ['cursos', 'materias', 'alumnos', 'docente_cursos', 'docente_materias', 'asistencias', 'notas', 'sync_log']) {
    await db.prepare(`UPDATE ${table} SET tenant_id = ? WHERE tenant_id IS NULL OR tenant_id = ''`).run(DEFAULT_TENANT_ID);
  }
}

async function createIndexes() {
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_cursos_tenant ON cursos(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_materias_tenant ON materias(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_escuelas_tenant ON escuelas(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_alumnos_tenant_curso ON alumnos(tenant_id, curso_id);
    CREATE INDEX IF NOT EXISTS idx_alumno_materias_tenant ON alumno_materias(tenant_id, alumno_id, materia_id);
    CREATE INDEX IF NOT EXISTS idx_docente_cursos_docente ON docente_cursos(tenant_id, docente_id);
    CREATE INDEX IF NOT EXISTS idx_docente_cursos_curso ON docente_cursos(tenant_id, curso_id);
    CREATE INDEX IF NOT EXISTS idx_docente_materias_docente ON docente_materias(tenant_id, docente_id);
    CREATE INDEX IF NOT EXISTS idx_docente_materias_materia ON docente_materias(tenant_id, materia_id);
    CREATE INDEX IF NOT EXISTS idx_docente_escuelas_docente ON docente_escuelas(tenant_id, docente_id);
    CREATE INDEX IF NOT EXISTS idx_asistencias_tenant_docente_fecha ON asistencias(tenant_id, docente_id, fecha);
    CREATE INDEX IF NOT EXISTS idx_asistencias_docente_alumno ON asistencias(tenant_id, docente_id, alumno_id);
    CREATE INDEX IF NOT EXISTS idx_notas_tenant_docente_fecha ON notas(tenant_id, docente_id, fecha);
    CREATE INDEX IF NOT EXISTS idx_notas_docente_alumno ON notas(tenant_id, docente_id, alumno_id);
    CREATE INDEX IF NOT EXISTS idx_calendario_tenant_fecha ON calendario_eventos(tenant_id, fecha_inicio);
    CREATE INDEX IF NOT EXISTS idx_calendario_tenant_docente ON calendario_eventos(tenant_id, docente_id, fecha_inicio);
    CREATE INDEX IF NOT EXISTS idx_actividades_tenant_contexto ON actividades(tenant_id, colegio, turno, curso_id, materia_id);
    CREATE INDEX IF NOT EXISTS idx_actividades_tenant_docente ON actividades(tenant_id, docente_id);
    CREATE INDEX IF NOT EXISTS idx_sync_log_tenant_docente ON sync_log(tenant_id, docente_id);
    CREATE INDEX IF NOT EXISTS idx_trabajo_entregas_contexto ON trabajo_entregas(tenant_id, docente_id, curso_id, materia_id);
    CREATE INDEX IF NOT EXISTS idx_trabajo_entregas_actividad ON trabajo_entregas(actividad_id);
    CREATE INDEX IF NOT EXISTS idx_trabajo_archivos_entrega ON trabajo_archivos(entrega_id);
    CREATE INDEX IF NOT EXISTS idx_trabajo_archivos_tenant ON trabajo_archivos(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_actividad_preguntas_actividad ON actividad_preguntas(actividad_id, orden);
    CREATE INDEX IF NOT EXISTS idx_actividad_preguntas_tenant ON actividad_preguntas(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_aulas_temporales_token ON aulas_temporales(join_token);
    CREATE INDEX IF NOT EXISTS idx_aulas_temporales_docente ON aulas_temporales(tenant_id, docente_id);
    CREATE INDEX IF NOT EXISTS idx_aula_intentos_aula ON aula_intentos(aula_id);
    CREATE INDEX IF NOT EXISTS idx_aula_intentos_tenant ON aula_intentos(tenant_id);
  `);
}

async function insertUser(user: User & { password: string }) {
  const exists = await db.prepare(`
    SELECT id FROM usuarios
    WHERE id = ? OR lower(email) = lower(?)
  `).get(user.id ?? null, user.email ?? null);
  if (exists) return;

  // LibSQL/Turso: SOLO array posicional de longitud exacta a los `?`. Nunca spread/{...user}/password.
  const params = [
    user.id ?? null,
    user.tenant_id ?? null,
    user.nombre ?? null,
    user.email ?? null,
    bcrypt.hashSync(user.password, 12),
    user.rol ?? null,
  ];

  await db.prepare(`
    INSERT OR IGNORE INTO usuarios (id, tenant_id, nombre, email, password_hash, rol)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(params);
}

export interface CourseViewFilters {
  courseId?: string;
  courseKey?: string;
  subjectId: string;
}

export interface CourseViewSnapshot {
  curso: {
    id: string;
    escuela: string;
    nombre: string;
    turno: string;
  };
  materia: {
    id: string;
    nombre: string;
  };
  alumnos: Array<{
    id: string;
    nombre: string;
    dni: string | null;
    tutor: string | null;
    notas: Array<{
      id: string;
      titulo: string;
      tipoEvaluacion: string | null;
      valor: number | null;
      peso: number;
      fecha: string;
    }>;
    asistencias: Array<{
      id: string;
      fecha: string;
      estado: 'presente' | 'ausente';
    }>;
    promedio: number | null;
    asistenciaPct: number | null;
  }>;
  fetchedAt: string;
}

type CourseViewRow = {
  curso_id: string;
  escuela: string;
  curso_nombre: string;
  turno: string;
  materia_id: string;
  materia_nombre: string;
  alumno_id: string;
  alumno_nombre: string;
  alumno_dni: string | null;
  alumno_tutor: string | null;
  nota_id: string | null;
  nota_titulo: string | null;
  nota_tipo: string | null;
  nota_valor: number | null;
  nota_peso: number | null;
  nota_fecha: string | null;
  asistencia_id: string | null;
  asistencia_fecha: string | null;
  asistencia_estado: 'presente' | 'ausente' | null;
};

function parseCourseKey(courseKey: string) {
  const [escuela, turno, curso] = courseKey.split('||');
  return { escuela, turno, curso_nombre: curso };
}

function docenteScopeClause(alias = 'c') {
  return `
    AND EXISTS (
      SELECT 1
      FROM docente_cursos dc
      WHERE dc.tenant_id = @tenant_id
        AND dc.docente_id = @docente_id
        AND dc.curso_id = ${alias}.id
    )
    AND EXISTS (
      SELECT 1
      FROM docente_materias dm
      WHERE dm.tenant_id = @tenant_id
        AND dm.docente_id = @docente_id
        AND dm.materia_id = m.id
    )
  `;
}

export async function getCourseViewSnapshot(user: User, filters: CourseViewFilters): Promise<CourseViewSnapshot | null> {
  if (!filters.subjectId) return null;

  const courseFilter = filters.courseId
    ? 'AND c.id = @course_id'
    : filters.courseKey
      ? 'AND c.escuela = @escuela AND c.nombre = @curso_nombre AND c.turno = @turno'
      : '';

  if (!filters.courseId && !filters.courseKey) return null;

  const parsedKey = filters.courseKey ? parseCourseKey(filters.courseKey) : null;
  const permissionClause = user.rol === 'admin' ? '' : docenteScopeClause();

  const rows = (await db.prepare(`
    SELECT
      c.id AS curso_id,
      c.escuela,
      c.nombre AS curso_nombre,
      c.turno,
      m.id AS materia_id,
      m.nombre AS materia_nombre,
      a.id AS alumno_id,
      a.nombre AS alumno_nombre,
      a.dni AS alumno_dni,
      a.tutor AS alumno_tutor,
      n.id AS nota_id,
      n.titulo AS nota_titulo,
      n.tipo_evaluacion AS nota_tipo,
      n.valor AS nota_valor,
      n.peso AS nota_peso,
      n.fecha AS nota_fecha,
      ast.id AS asistencia_id,
      ast.fecha AS asistencia_fecha,
      ast.estado AS asistencia_estado
    FROM cursos c
    INNER JOIN alumnos a
      ON a.curso_id = c.id
     AND a.tenant_id = c.tenant_id
     AND a.activo = 1
    INNER JOIN alumno_materias am
      ON am.alumno_id = a.id
     AND am.tenant_id = a.tenant_id
    INNER JOIN materias m
      ON m.id = am.materia_id
     AND m.tenant_id = c.tenant_id
     AND m.activo = 1
    LEFT JOIN notas n
      ON n.alumno_id = a.id
     AND n.materia_id = m.id
     AND n.tenant_id = c.tenant_id
     ${user.rol === 'admin' ? '' : 'AND n.docente_id = @docente_id'}
    LEFT JOIN asistencias ast
      ON ast.alumno_id = a.id
     AND ast.materia_id = m.id
     AND ast.tenant_id = c.tenant_id
     ${user.rol === 'admin' ? '' : 'AND ast.docente_id = @docente_id'}
    WHERE c.tenant_id = @tenant_id
      AND m.id = @subject_id
      ${courseFilter}
      ${permissionClause}
    ORDER BY a.nombre, n.fecha DESC, ast.fecha DESC
  `).all({
    tenant_id: user.tenant_id,
    docente_id: user.id,
    course_id: filters.courseId || null,
    escuela: parsedKey?.escuela || null,
    curso_nombre: parsedKey?.curso_nombre || null,
    turno: parsedKey?.turno || null,
    subject_id: filters.subjectId,
  })) as CourseViewRow[];

  if (!rows.length) return null;

  const first = rows[0];
  const alumnosMap = new Map<string, CourseViewSnapshot['alumnos'][number]>();

  for (const row of rows) {
    let alumno = alumnosMap.get(row.alumno_id);
    if (!alumno) {
      alumno = {
        id: row.alumno_id,
        nombre: row.alumno_nombre,
        dni: row.alumno_dni,
        tutor: row.alumno_tutor,
        notas: [],
        asistencias: [],
        promedio: null,
        asistenciaPct: null,
      };
      alumnosMap.set(row.alumno_id, alumno);
    }

    if (row.nota_id && !alumno.notas.some((nota) => nota.id === row.nota_id)) {
      alumno.notas.push({
        id: row.nota_id,
        titulo: row.nota_titulo || 'Nota',
        tipoEvaluacion: row.nota_tipo,
        valor: row.nota_valor,
        peso: Number(row.nota_peso || 100),
        fecha: row.nota_fecha || '',
      });
    }

    if (row.asistencia_id && !alumno.asistencias.some((item) => item.id === row.asistencia_id)) {
      alumno.asistencias.push({
        id: row.asistencia_id,
        fecha: row.asistencia_fecha || '',
        estado: row.asistencia_estado || 'ausente',
      });
    }
  }

  for (const alumno of alumnosMap.values()) {
    const validGrades = alumno.notas.filter((nota) => nota.valor !== null && Number.isFinite(Number(nota.valor)));
    const totalPeso = validGrades.reduce((acc, nota) => acc + Number(nota.peso || 100), 0);
    alumno.promedio = totalPeso > 0
      ? validGrades.reduce((acc, nota) => acc + Number(nota.valor) * Number(nota.peso || 100), 0) / totalPeso
      : validGrades.length
        ? validGrades.reduce((acc, nota) => acc + Number(nota.valor), 0) / validGrades.length
        : null;

    const presentes = alumno.asistencias.filter((item) => item.estado === 'presente').length;
    alumno.asistenciaPct = alumno.asistencias.length
      ? (presentes / alumno.asistencias.length) * 100
      : null;
  }

  return {
    curso: {
      id: first.curso_id,
      escuela: first.escuela,
      nombre: first.curso_nombre,
      turno: first.turno,
    },
    materia: {
      id: first.materia_id,
      nombre: first.materia_nombre,
    },
    alumnos: [...alumnosMap.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    fetchedAt: new Date().toISOString(),
  };
}

async function seed() {
  const existingUsers = (await db.prepare('SELECT COUNT(*) AS count FROM usuarios').get()) as
    | { count: number | bigint | string }
    | undefined;
  const userCount = Number(existingUsers?.count ?? 0);
  if (userCount > 0) {
    console.log(`[db] seed omitido: ya hay ${userCount} usuario(s) en la base.`);
    return;
  }

  await insertUser({
    id: 'docente-demo',
    tenant_id: DEFAULT_TENANT_ID,
    nombre: 'Docente Demo',
    email: 'docente@aulaclara.test',
    password: 'Docente123!',
    rol: 'docente',
  });

  await insertUser({
    id: 'admin-demo',
    tenant_id: ADMIN_TENANT_ID,
    nombre: 'Admin Demo',
    email: 'admin@aulaclara.test',
    password: 'Admin123!',
    rol: 'admin',
  });

  const insertCourse = db.prepare(`
    INSERT OR IGNORE INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  await insertCourse.run(['curso-6-1-manana', DEFAULT_TENANT_ID, 'Escuela Tecnica 1', '6to 1ra', 'Manana', 2026]);
  await insertCourse.run(['curso-5-2-tarde', DEFAULT_TENANT_ID, 'Escuela Tecnica 1', '5to 2da', 'Tarde', 2026]);

  const insertSchool = db.prepare('INSERT OR IGNORE INTO escuelas (id, tenant_id, nombre) VALUES (?, ?, ?)');
  await insertSchool.run(['escuela-tecnica-1', DEFAULT_TENANT_ID, 'Escuela Tecnica 1']);

  const insertSubject = db.prepare('INSERT OR IGNORE INTO materias (id, tenant_id, nombre) VALUES (?, ?, ?)');
  await insertSubject.run(['matematica', DEFAULT_TENANT_ID, 'Matematica']);
  await insertSubject.run(['programacion', DEFAULT_TENANT_ID, 'Programacion']);
  await insertSubject.run(['literatura', DEFAULT_TENANT_ID, 'Literatura']);

  const insertStudent = db.prepare(`
    INSERT OR IGNORE INTO alumnos (id, tenant_id, curso_id, nombre, dni, tutor)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  await insertStudent.run(['al-1', DEFAULT_TENANT_ID, 'curso-6-1-manana', 'Martina Ruiz', '44111222', 'Laura Ruiz']);
  await insertStudent.run(['al-2', DEFAULT_TENANT_ID, 'curso-6-1-manana', 'Tomas Pereyra', '45222333', 'Ruben Pereyra']);
  await insertStudent.run(['al-3', DEFAULT_TENANT_ID, 'curso-5-2-tarde', 'Sofia Molina', '46333444', 'Ana Molina']);

  const assignCourse = db.prepare('INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)');
  await assignCourse.run([DEFAULT_TENANT_ID, 'docente-demo', 'curso-6-1-manana']);
  await assignCourse.run([DEFAULT_TENANT_ID, 'docente-demo', 'curso-5-2-tarde']);

  const assignSchool = db.prepare('INSERT OR IGNORE INTO docente_escuelas (tenant_id, docente_id, escuela_id) VALUES (?, ?, ?)');
  await assignSchool.run([DEFAULT_TENANT_ID, 'docente-demo', 'escuela-tecnica-1']);

  const assignSubject = db.prepare('INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id) VALUES (?, ?, ?)');
  await assignSubject.run([DEFAULT_TENANT_ID, 'docente-demo', 'matematica']);
  await assignSubject.run([DEFAULT_TENANT_ID, 'docente-demo', 'programacion']);
  await assignSubject.run([DEFAULT_TENANT_ID, 'docente-demo', 'literatura']);

  const assignStudentSubject = db.prepare('INSERT OR IGNORE INTO alumno_materias (tenant_id, alumno_id, materia_id) VALUES (?, ?, ?)');
  await assignStudentSubject.run([DEFAULT_TENANT_ID, 'al-1', 'matematica']);
  await assignStudentSubject.run([DEFAULT_TENANT_ID, 'al-1', 'programacion']);
  await assignStudentSubject.run([DEFAULT_TENANT_ID, 'al-2', 'matematica']);
  await assignStudentSubject.run([DEFAULT_TENANT_ID, 'al-2', 'programacion']);
  await assignStudentSubject.run([DEFAULT_TENANT_ID, 'al-3', 'literatura']);

  const insertGrade = db.prepare(`
    INSERT OR IGNORE INTO notas (id, tenant_id, docente_id, alumno_id, materia_id, titulo, valor, peso, fecha, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  await insertGrade.run([
    'nota-db-1',
    DEFAULT_TENANT_ID,
    'docente-demo',
    'al-1',
    'programacion',
    'TP HTML',
    8,
    40,
    '2026-05-05',
    '2026-05-05T03:00:00.000Z',
  ]);
  await insertGrade.run([
    'nota-db-2',
    DEFAULT_TENANT_ID,
    'docente-demo',
    'al-2',
    'programacion',
    'Integrador',
    5,
    60,
    '2026-05-05',
    '2026-05-05T03:00:00.000Z',
  ]);

  const insertActividad = db.prepare(`
    INSERT OR IGNORE INTO actividades (
      id, tenant_id, docente_id, colegio, turno, curso_id, materia_id,
      tipo, titulo, estado, fecha_publicacion, fecha_vencimiento, contenido_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  await insertActividad.run([
    'act-demo-tp1',
    DEFAULT_TENANT_ID,
    'docente-demo',
    'Escuela Tecnica 1',
    'Manana',
    'curso-6-1-manana',
    'programacion',
    'tp',
    'TP HTML y CSS',
    'publicado',
    '2026-06-01',
    '2026-06-20',
    JSON.stringify({ template: 'tp-v1', bloques: [{ type: 'consigna', texto: 'Desarrollar landing responsive.' }] }),
    new Date().toISOString(),
  ]);
  await insertActividad.run([
    'act-demo-eval1',
    DEFAULT_TENANT_ID,
    'docente-demo',
    'Escuela Tecnica 1',
    'Manana',
    'curso-6-1-manana',
    'matematica',
    'evaluacion',
    'Evaluación funciones',
    'publicado',
    '2026-06-10',
    '2026-06-15',
    JSON.stringify({ template: 'evaluacion-v1', bloques: [{ type: 'pregunta', texto: 'Resolver ejercicios de funciones.', puntaje: 10 }] }),
    new Date().toISOString(),
  ]);
}
