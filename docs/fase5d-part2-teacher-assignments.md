# Fase 5D Part 2 — Asignaciones docentes

**Fecha:** 2026-09-16  
**Base:** `main` @ `d476d84` (FASE 5C Part 2)  
**Branch:** `cursor/teacher-assignments-fase5d-part2-2df7`

---

## Objetivo

Permitir que un **admin** de una institución gestione las asignaciones académicas de sus docentes activos:

- docente → escuela (`docente_escuelas`)
- docente → curso (`docente_cursos`)
- docente → materia (`docente_materias`)

Sin tablas nuevas, sin jerarquía artificial, sin cambios offline/sync.

---

## Modelo reutilizado

| Tabla | Uso admin | Efecto runtime |
|-------|-----------|----------------|
| `docente_escuelas` | asignar/quitar | pull de escuelas |
| `docente_cursos` | asignar/quitar | `canAccessCourse` / alumnos / export / calendario |
| `docente_materias` | asignar/quitar | `canAccessSubject` / notas / actividades |

PK existente: `(tenant_id, docente_id, recurso_id)`.

**No hay jerarquía** escuela → curso → materia. Las tres relaciones son **independientes**.  
Las materias siguen siendo catálogo tenant-scoped (sin FK a curso).  
`cursos.escuela` permanece TEXT.

**No se creó tabla nueva.**

---

## Endpoints

`/api/admin/teacher-assignments`

| Método | Acción |
|--------|--------|
| `GET ?teacher_id=` | Snapshot: catálogo del tenant + flags de asignación |
| `GET` (sin teacher) | Lista docentes **activos** asignables |
| `POST` `{ teacher_id, type, resource_id }` | Crear asignación (`type`: `school` \| `course` \| `subject`) |
| `POST` + `action=unassign` | Quitar (forms HTML) |
| `DELETE` mismo body | Quitar |

Servicio: `src/server/institution-assignments.ts`  
UI: `/admin/asignaciones`

---

## Autorización

- `locals.auth` / `resolveAuthContext`
- Requiere `auth.role === 'admin'`
- Tenant: **solo** `auth.tenantId`
- Nunca `user.rol` / `user.tenant_id` / `tenant_id` del cliente como autoridad
- Docente objetivo: membership **active** + `role=docente` en `auth.tenantId`
- Recurso: existe y `tenant_id = auth.tenantId`

---

## Aislamiento tenant

Un admin de A no puede:

- listar/asignar docentes de B
- asignar recursos de B
- combinar docente A + recurso B
- enviar `tenant_id` ajeno (rechazo `forbidden`)

Cross-tenant → `not_found` / `forbidden` (fail closed, patrón 5C).

---

## UI

`/admin/asignaciones` + entrada en `AdminSubnav`.

1. Seleccionar docente activo.
2. Ver escuelas / cursos / materias del tenant con estado asignado / sin asignar.
3. Botones Asignar / Quitar por recurso.
4. Flash de éxito/error.

No se listan guests ni docentes revocados como seleccionables.

---

## Reglas de asignación

Antes de crear:

1. AuthContext admin
2. Teacher membership active docente en tenant
3. Recurso existe en tenant
4. Relación no duplicada (`conflict` si ya existe)
5. INSERT en la junction correspondiente

Antes de eliminar: mismas validaciones; DELETE scoped a `(tenant_id, docente_id, recurso_id)`.

No modifica usuario, membership, tenant, ni el recurso académico.

---

## Docentes revocados

- No reciben **nuevas** asignaciones (`code: revoked`).
- No aparecen en el selector de activos.
- **No** se borran automáticamente sus filas `docente_*` al revocar (deliberado).
- Acceso efectivo sigue dependiendo de AuthContext/membership (fail closed si revoked).

---

## Guests

- No tienen membership docente → no son administrables.
- No se crean memberships para ellos desde esta UI/API.

---

## Compatibilidad con sync

**Self-assign de sync/ensure/import/pull permanece pendiente** (deuda documentada en Part 1).

Esta fase **no modifica**:

- `school-app.js`
- IndexedDB / offline queue
- sync client / `sync-pull`
- semántica de `canAccess*`

Las asignaciones admin alimentan las mismas tablas que sync y `canAccess*` ya usan.

---

## Tests

`npm run verify:institution-assignments`

Cubre list/assign/unassign (3 tipos), duplicados, cross-tenant, revoked, guest, sin auth, docente no-admin, `canAccess*`, no mutación de tenant/membership/usuario/recurso.

Regresión: auth-memberships, memberships, institution, teachers, settings, academic, auth-email, guides, build.

---

## Limitaciones conocidas

1. **Self-assign de sync** sigue pudiendo crear `docente_*` intra-tenant sin admin.
2. **Revoke no elimina relaciones** automáticamente.
3. **No existe jerarquía** escuela → curso → materia (ni se impone en UI).
4. **No se creó tabla nueva** ni migración.
5. Soft-delete de escuela/materia no limpia junctions (comportamiento previo).
