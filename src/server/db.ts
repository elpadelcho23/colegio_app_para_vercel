import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const dbPath = join(dirname(fileURLToPath(import.meta.url)), '../../.data/aula-clara.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const DEFAULT_TENANT_ID = 'tenant-demo';
export const ADMIN_TENANT_ID = 'tenant-admin';

export interface User {
  id: string;
  tenant_id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'docente';
}

export function createTenant(nombre: string, id = `tenant-${randomBytes(8).toString('hex')}`) {
  db.prepare(`
    INSERT OR IGNORE INTO tenants (id, nombre)
    VALUES (?, ?)
  `).run(id, nombre.trim() || 'Cuenta docente');
  return id;
}

export function createUser(user: Omit<User, 'id' | 'tenant_id'> & { password: string; tenant_id?: string }) {
  const email = String(user.email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM usuarios WHERE lower(email) = lower(?)').get(email);
  if (existing) return null;

  const id = `docente-${randomBytes(8).toString('hex')}`;
  const tenantId = user.tenant_id || createTenant(`Cuenta de ${user.nombre.trim() || email}`);
  db.prepare(`
    INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, user.nombre.trim(), email, bcrypt.hashSync(user.password, 12), user.rol);

  return { id, tenant_id: tenantId, nombre: user.nombre.trim(), email, rol: user.rol } as User;
}

db.exec(`
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

  CREATE TABLE IF NOT EXISTS alumnos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
    curso_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    dni TEXT UNIQUE,
    tutor TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_alumnos_curso ON alumnos(curso_id);
`);

migrateTenancy();
migrateAcademicStructure();
createIndexes();
seed();

function tableColumns(table: string) {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
}

function ensureColumn(table: string, column: string, ddl: string) {
  if (tableColumns(table).some((item) => item.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
}

function tableSql(table: string) {
  return (db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table) as { sql: string } | undefined)?.sql || '';
}

function migrateAcademicStructure() {
  db.exec(`
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

  const notasSql = tableSql('notas');
  if (notasSql.includes('valor REAL NOT NULL')) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
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
    db.exec('PRAGMA foreign_keys = ON;');
  }

  ensureColumn('notas', 'tipo_evaluacion', 'tipo_evaluacion TEXT');
  ensureColumn('notas', 'calificacion_texto', 'calificacion_texto TEXT');
  ensureColumn('notas', 'fecha_entrega', 'fecha_entrega TEXT');

  const calendarioSql = tableSql('calendario_eventos');
  if (calendarioSql.includes("CHECK (tipo IN ('evaluacion', 'tp', 'cierre_tp', 'asistencia', 'nota', 'evento'))")) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
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
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function migrateTenancy() {
  db.prepare('INSERT OR IGNORE INTO tenants (id, nombre) VALUES (?, ?)').run(DEFAULT_TENANT_ID, 'Cuenta demo');
  db.prepare('INSERT OR IGNORE INTO tenants (id, nombre) VALUES (?, ?)').run(ADMIN_TENANT_ID, 'Administracion');

  ensureColumn('usuarios', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  ensureColumn('cursos', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  ensureColumn('materias', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  ensureColumn('materias', 'activo', 'activo INTEGER NOT NULL DEFAULT 1');
  ensureColumn('alumnos', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  ensureColumn('docente_cursos', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  ensureColumn('docente_materias', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  ensureColumn('asistencias', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  ensureColumn('notas', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  ensureColumn('sync_log', 'tenant_id', `tenant_id TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);

  db.prepare(`
    UPDATE usuarios
    SET tenant_id = CASE WHEN rol = 'admin' THEN ? ELSE ? END
    WHERE tenant_id IS NULL OR tenant_id = ''
  `).run(ADMIN_TENANT_ID, DEFAULT_TENANT_ID);

  for (const table of ['cursos', 'materias', 'alumnos', 'docente_cursos', 'docente_materias', 'asistencias', 'notas', 'sync_log']) {
    db.prepare(`UPDATE ${table} SET tenant_id = ? WHERE tenant_id IS NULL OR tenant_id = ''`).run(DEFAULT_TENANT_ID);
  }
}

function createIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cursos_tenant ON cursos(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_materias_tenant ON materias(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_alumnos_tenant_curso ON alumnos(tenant_id, curso_id);
    CREATE INDEX IF NOT EXISTS idx_alumno_materias_tenant ON alumno_materias(tenant_id, alumno_id, materia_id);
    CREATE INDEX IF NOT EXISTS idx_asistencias_tenant_docente_fecha ON asistencias(tenant_id, docente_id, fecha);
    CREATE INDEX IF NOT EXISTS idx_notas_tenant_docente_fecha ON notas(tenant_id, docente_id, fecha);
    CREATE INDEX IF NOT EXISTS idx_calendario_tenant_fecha ON calendario_eventos(tenant_id, fecha_inicio);
    CREATE INDEX IF NOT EXISTS idx_actividades_tenant_contexto ON actividades(tenant_id, colegio, turno, curso_id, materia_id);
  `);
}

function insertUser(user: User & { password: string }) {
  const exists = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(user.id);
  if (exists) return;

  db.prepare(`
    INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol)
    VALUES (@id, @tenant_id, @nombre, @email, @password_hash, @rol)
  `).run({
    ...user,
    password_hash: bcrypt.hashSync(user.password, 12),
  });
}

function seed() {
  insertUser({
    id: 'docente-demo',
    tenant_id: DEFAULT_TENANT_ID,
    nombre: 'Docente Demo',
    email: 'docente@aulaclara.test',
    password: 'Docente123!',
    rol: 'docente',
  });

  insertUser({
    id: 'admin-demo',
    tenant_id: ADMIN_TENANT_ID,
    nombre: 'Admin Demo',
    email: 'admin@aulaclara.test',
    password: 'Admin123!',
    rol: 'admin',
  });

  const insertCourse = db.prepare(`
    INSERT OR IGNORE INTO cursos (id, tenant_id, escuela, nombre, turno, ciclo_lectivo)
    VALUES (@id, @tenant_id, @escuela, @nombre, @turno, @ciclo_lectivo)
  `);
  insertCourse.run({ id: 'curso-6-1-manana', tenant_id: DEFAULT_TENANT_ID, escuela: 'Escuela Tecnica 1', nombre: '6to 1ra', turno: 'Manana', ciclo_lectivo: 2026 });
  insertCourse.run({ id: 'curso-5-2-tarde', tenant_id: DEFAULT_TENANT_ID, escuela: 'Escuela Tecnica 1', nombre: '5to 2da', turno: 'Tarde', ciclo_lectivo: 2026 });

  const insertSubject = db.prepare('INSERT OR IGNORE INTO materias (id, tenant_id, nombre) VALUES (?, ?, ?)');
  insertSubject.run('matematica', DEFAULT_TENANT_ID, 'Matematica');
  insertSubject.run('programacion', DEFAULT_TENANT_ID, 'Programacion');
  insertSubject.run('literatura', DEFAULT_TENANT_ID, 'Literatura');

  const insertStudent = db.prepare(`
    INSERT OR IGNORE INTO alumnos (id, tenant_id, curso_id, nombre, dni, tutor)
    VALUES (@id, @tenant_id, @curso_id, @nombre, @dni, @tutor)
  `);
  insertStudent.run({ id: 'al-1', tenant_id: DEFAULT_TENANT_ID, curso_id: 'curso-6-1-manana', nombre: 'Martina Ruiz', dni: '44111222', tutor: 'Laura Ruiz' });
  insertStudent.run({ id: 'al-2', tenant_id: DEFAULT_TENANT_ID, curso_id: 'curso-6-1-manana', nombre: 'Tomas Pereyra', dni: '45222333', tutor: 'Ruben Pereyra' });
  insertStudent.run({ id: 'al-3', tenant_id: DEFAULT_TENANT_ID, curso_id: 'curso-5-2-tarde', nombre: 'Sofia Molina', dni: '46333444', tutor: 'Ana Molina' });

  const assignCourse = db.prepare('INSERT OR IGNORE INTO docente_cursos (tenant_id, docente_id, curso_id) VALUES (?, ?, ?)');
  assignCourse.run(DEFAULT_TENANT_ID, 'docente-demo', 'curso-6-1-manana');
  assignCourse.run(DEFAULT_TENANT_ID, 'docente-demo', 'curso-5-2-tarde');

  const assignSubject = db.prepare('INSERT OR IGNORE INTO docente_materias (tenant_id, docente_id, materia_id) VALUES (?, ?, ?)');
  assignSubject.run(DEFAULT_TENANT_ID, 'docente-demo', 'matematica');
  assignSubject.run(DEFAULT_TENANT_ID, 'docente-demo', 'programacion');
  assignSubject.run(DEFAULT_TENANT_ID, 'docente-demo', 'literatura');

  const assignStudentSubject = db.prepare('INSERT OR IGNORE INTO alumno_materias (tenant_id, alumno_id, materia_id) VALUES (?, ?, ?)');
  assignStudentSubject.run(DEFAULT_TENANT_ID, 'al-1', 'matematica');
  assignStudentSubject.run(DEFAULT_TENANT_ID, 'al-1', 'programacion');
  assignStudentSubject.run(DEFAULT_TENANT_ID, 'al-2', 'matematica');
  assignStudentSubject.run(DEFAULT_TENANT_ID, 'al-2', 'programacion');
  assignStudentSubject.run(DEFAULT_TENANT_ID, 'al-3', 'literatura');

  const insertGrade = db.prepare(`
    INSERT OR IGNORE INTO notas (id, tenant_id, docente_id, alumno_id, materia_id, titulo, valor, peso, fecha, updated_at)
    VALUES (@id, @tenant_id, @docente_id, @alumno_id, @materia_id, @titulo, @valor, @peso, @fecha, @updated_at)
  `);
  insertGrade.run({
    id: 'nota-db-1',
    tenant_id: DEFAULT_TENANT_ID,
    docente_id: 'docente-demo',
    alumno_id: 'al-1',
    materia_id: 'programacion',
    titulo: 'TP HTML',
    valor: 8,
    peso: 40,
    fecha: '2026-05-05',
    updated_at: '2026-05-05T03:00:00.000Z',
  });
  insertGrade.run({
    id: 'nota-db-2',
    tenant_id: DEFAULT_TENANT_ID,
    docente_id: 'docente-demo',
    alumno_id: 'al-2',
    materia_id: 'programacion',
    titulo: 'Integrador',
    valor: 5,
    peso: 60,
    fecha: '2026-05-05',
    updated_at: '2026-05-05T03:00:00.000Z',
  });
}
