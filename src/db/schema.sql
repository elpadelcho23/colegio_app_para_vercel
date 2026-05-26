PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
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
  tenant_id TEXT NOT NULL,
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
  tenant_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alumnos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
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
  tenant_id TEXT NOT NULL,
  docente_id TEXT NOT NULL,
  curso_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, docente_id, curso_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (curso_id) REFERENCES cursos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS docente_materias (
  tenant_id TEXT NOT NULL,
  docente_id TEXT NOT NULL,
  materia_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, docente_id, materia_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alumno_materias (
  tenant_id TEXT NOT NULL,
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
  tenant_id TEXT NOT NULL,
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
  tenant_id TEXT NOT NULL,
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
  tenant_id TEXT NOT NULL,
  docente_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_cursos_tenant ON cursos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_materias_tenant ON materias(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alumnos_tenant_curso ON alumnos(tenant_id, curso_id);
CREATE INDEX IF NOT EXISTS idx_alumno_materias_tenant ON alumno_materias(tenant_id, alumno_id, materia_id);
CREATE INDEX IF NOT EXISTS idx_asistencias_tenant_docente_fecha ON asistencias(tenant_id, docente_id, fecha);
CREATE INDEX IF NOT EXISTS idx_notas_tenant_docente_fecha ON notas(tenant_id, docente_id, fecha);
CREATE INDEX IF NOT EXISTS idx_calendario_tenant_fecha ON calendario_eventos(tenant_id, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_actividades_tenant_contexto ON actividades(tenant_id, colegio, turno, curso_id, materia_id);
