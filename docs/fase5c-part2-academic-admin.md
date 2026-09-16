# FASE 5C Part 2 — Administración de estructura académica

## Alcance

Admin institucional gestiona **las mismas** tablas docentes:

- `escuelas`
- `cursos`
- `materias`

Sin tablas paralelas. Sin CRUD alumnos. Sin reasignación docente completa. Sin cambios offline/sync.

## Endpoints

| Método | Ruta | Entidad |
|--------|------|---------|
| GET/POST/PATCH | `/api/admin/schools` | escuelas |
| GET/POST/PATCH | `/api/admin/courses` | cursos |
| GET/POST/PATCH | `/api/admin/subjects` | materias |

Helpers: `src/server/institution-academic.ts`.

## UI

- `/admin/escuelas`
- `/admin/cursos`
- `/admin/materias`
- Nav compartida: `AdminSubnav` (Institución / Docentes / Escuelas / Cursos / Materias)

## Autorización

- `locals.auth` + `auth.role === 'admin'`
- Toda query/write: `tenant_id = auth.tenantId`
- `tenant_id` cliente ajeno → 403
- ID de otro tenant → `not_found` (scoped)
- Membership revoked / tenant suspended → AuthContext niega → 403

## Soft-delete / delete

| Entidad | Política |
|---------|----------|
| escuelas | `activo=0` (no hard-delete) |
| materias | `activo=0` (no hard-delete) |
| cursos | Sin campo activo; hard-delete **solo** si no hay alumnos (como sync) |

## Limitación `cursos.escuela` TEXT

- Se mantiene TEXT.
- UI puede elegir escuela del catálogo; se guarda el **nombre**.
- Rename de escuela actualiza `cursos.escuela` del mismo tenant que matcheaban el nombre anterior.
- **No** se introduce `escuela_id` / FK en esta fase.

## Pospuesto

- CRUD alumnos
- Assign docente↔curso/materia completo
- Migración escuela TEXT → FK
- Fix backup restore escuelas
- Bloqueo create docente vía sync
- Import/canAccessStudent hardening

## Confirmaciones

- No modelo paralelo
- `cursos.escuela` sigue TEXT
- No se modificó school-app.js / offline / sync-client / IndexedDB
