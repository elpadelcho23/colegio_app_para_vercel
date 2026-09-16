# Fase 5D Part 1 — Auditoría de asignaciones docentes

**Fecha:** 2026-09-16  
**Base de auditoría:** `main` @ `d476d84` (merge FASE 5C Part 2)  
**Alcance:** documentación únicamente. Sin migraciones, sin tablas nuevas, sin cambios de runtime.

---

## Estado actual

### Consolidación previa a la auditoría

| Item | Estado |
|------|--------|
| `main` antes | `2309cd6` (fases 1–5B + 5C Part 1 docs) |
| PR #13 (5C Part 2) | Estaba OPEN; **mergeado a main** como `d476d84` |
| Docs 5C en main | Presentes (`fase5c-part1-*`, `fase5c-part2-academic-admin.md`) |
| Verifies + build en base | OK (auth-memberships, memberships, institution, teachers, settings, academic, auth-email, guides, build) |

### Arquitectura vigente (contexto)

- `tenants` = instituciones.
- `institution_memberships` = pertenencia/rol (autoridad).
- `AuthContext` = autoridad runtime (single-context vía `usuarios.tenant_id` como clave de lookup).
- Admin ya gestiona escuelas/cursos/materias (`/api/admin/schools|courses|subjects`) **sin** escribir `docente_*` en create.
- Admin invite docente puede llamar `assignPedagogy` → solo `docente_cursos` + `docente_materias`.
- Docente offline/sync **sí** auto-crea `docente_*` al crear escuela/curso/materia.

---

## Tablas existentes

### `docente_escuelas`

| Columna | Tipo | Notas |
|---------|------|-------|
| `tenant_id` | TEXT NOT NULL | FK → tenants CASCADE |
| `docente_id` | TEXT NOT NULL | FK → usuarios CASCADE |
| `escuela_id` | TEXT NOT NULL | FK → escuelas CASCADE |
| **PK** | `(tenant_id, docente_id, escuela_id)` | Sin columnas extra |

Índice: `idx_docente_escuelas_docente (tenant_id, docente_id)`.

### `docente_cursos`

| Columna | Tipo | Notas |
|---------|------|-------|
| `tenant_id` | TEXT NOT NULL | FK tenants |
| `docente_id` | TEXT NOT NULL | FK usuarios |
| `curso_id` | TEXT NOT NULL | FK cursos CASCADE |
| **PK** | `(tenant_id, docente_id, curso_id)` | |

Índices: por docente y por curso.

### `docente_materias`

| Columna | Tipo | Notas |
|---------|------|-------|
| `tenant_id` | TEXT NOT NULL | FK tenants |
| `docente_id` | TEXT NOT NULL | FK usuarios |
| `materia_id` | TEXT NOT NULL | FK materias CASCADE |
| **PK** | `(tenant_id, docente_id, materia_id)` | |

Índices: por docente y por materia.

**Hallazgo estructural:** no hay `curso_materias`. Las materias son catálogo del tenant; el vínculo curso↔materia es indirecto vía `alumnos` + `alumno_materias`.

---

## Funciones relevantes

### Autorización (lectura)

| Función | Archivo | Relación usada |
|---------|---------|----------------|
| `canAccessCourse` | `src/server/auth.ts` | `docente_cursos` (+ AuthContext; admin bypass mismo tenant) |
| `canAccessSubject` | `auth.ts` | `docente_materias` |
| `canAccessStudent` | `auth.ts` | `docente_cursos` vía `alumnos.curso_id` |
| — | — | **`docente_escuelas` NO se usa en canAccess\*** |

Orden típico: `resolveAuthContext` → match `tenant_id` del recurso → admin OK → else JOIN `docente_*`.

### Mutación / ensure (escritura)

| Función | Qué escribe | Quién |
|---------|-------------|-------|
| `ensureDocenteCourseAccess` | puede INSERT `cursos` + `docente_cursos` | docente (mismo tenant) |
| `ensureDocenteSubjectAccess` | puede INSERT `materias` + `docente_materias` | docente |
| **No existe** `ensureDocenteEscuela` como helper nombrado | sync `applySchool` hace el INSERT | docente/admin sync |
| `assignPedagogy` | `docente_cursos` + `docente_materias` (IDs filtrados a tenant) | admin invite |
| `applyCourse` / `applySubject` / `applySchool` | self-assign al upsert | sync |
| `pullClientData` | auto-INSERT `docente_materias` si aparecen vía alumnos | pull docente |
| Excel `ensureSchool/Course/Subject` | self-link si no admin | import |
| `ensureTeachingContextRows` | curso+materia + `docente_*` | aula temporal |
| `deleteCourseForInstitutionAdmin` | DELETE `docente_cursos` del curso | admin |
| `revokeMembership` / `revokeTeacher` | **no toca** `docente_*` | admin |

---

## Flujo actual de autorización

```
Request
  → middleware: resolveAuthContext → locals.auth
  → si null en API protegida → 403 (fail closed)
  → handler:
       admin (ctx.role): acceso a recursos del mismo ctx.tenantId
       docente: canAccess* / ensure* / JOINs en pull-export-calendar
```

**Autoridad:** AuthContext (membership).  
**No autoridad:** `usuarios.rol` crudo ni `tenant_id` del cliente (sync rechaza mismatch).

**Bypass admin:** dentro del mismo tenant, `canAccess*` retorna true sin fila `docente_*`.

---

## Flujo actual de sync

| Operación sync | ¿Crea asignación? | ¿Requiere asignación previa? |
|----------------|-------------------|------------------------------|
| Upsert school | Sí → `docente_escuelas` | No (tampoco hay canAccessSchool) |
| Upsert course | Sí → `docente_cursos` | Create: no; update/delete: `canAccessCourse` |
| Upsert subject | Sí → `docente_materias` | Create: no; update/delete: `canAccessSubject` |
| Upsert student | No | Sí (`docente_cursos` del curso) |
| Attendance / grade | No | `canAccessStudent` + `canAccessSubject` |
| Pull catalog | Puede auto-link materias | Filtra por `docente_*` (admin: todo el tenant) |

**Conclusión sync:** el docente puede **otorgarse** acceso a catálogo del tenant al crear/actualizar escuela/curso/materia, y el pull puede **ampliar** materias. Eso no es cross-tenant (AuthContext + foreign PK checks), pero **sí** es asignación no otorgada explícitamente por admin.

---

## Matriz de autorización

Leyenda: **A** = admin mismo tenant · **DA** = docente asignado · **DN** = docente no asignado · **XT** = otro tenant.

| Recurso | A | DA | DN | XT | Función / relación | AuthContext | Notas |
|---------|---|----|----|----|--------------------|-------------|-------|
| Escuela (pull list) | Sí | Si `docente_escuelas` | No | No | pull JOIN | Sí | No hay `canAccessSchool` |
| Escuela (sync upsert) | Sí | Sí (self-link) | Sí create → self-link | No | `applySchool` | Sí | DN puede crear/adjuntar |
| Curso | Sí | `docente_cursos` | Create sync → self; ensure* puede linkear | No | `canAccessCourse` / ensure / sync | Sí | |
| Materia | Sí | `docente_materias` | Idem | No | `canAccessSubject` / ensure / sync / pull auto | Sí | |
| Alumno | Sí | vía curso en `docente_cursos` | No | No | `canAccessStudent` | Sí | No usa escuela/materia |
| Asistencia | Sí* | student+subject | No | No | sync validate + canAccess* | Sí | *admin vía canAccess |
| Notas | Sí* | student+subject | No | No | igual | Sí | |
| Actividades | Sí | ensure* puede crear link | ensure* puede crear link | No | `ensureDocente*` | Sí | Soft privilege expand |
| Trabajos | Sí | ensure* / ownership | ensure* | No | trabajos + ensure* | Sí | |
| Calendario | Sí | `docente_cursos` / canAccess | No list | No | calendar scope | Sí | |
| Export | Sí | cursos vía `docente_cursos` | vacío/filtrado | No | `docenteCourseClause` | Sí | |
| Admin schools/courses/subjects | Sí | No | No | No | `institution-academic` | Sí | No escribe assign |
| Admin teachers assign | Sí | No | No | No | `assignPedagogy` | Sí | Solo cursos+materias |

**Cruce de tenant:** denegado de forma consistente cuando AuthContext + `tenant_id` del recurso no coinciden / `rejectForeignPrimaryKey`.

---

## Semántica de `docente_escuelas`

**Qué habilita hoy:**

- Visibilidad de escuelas en **sync pull** (docente solo ve escuelas linkeadas).
- Persistencia de “mis escuelas” creadas/editadas vía sync.

**Qué NO habilita:**

- Acceso a cursos, alumnos, asistencia, notas, actividades (ningún `canAccess*` la consulta).
- Admin pedagogy invite (no se escribe en `assignPedagogy`).

**Naturaleza:** eje **independiente** de catálogo/UI, no jerarquía de autorización.

---

## Semántica de `docente_cursos`

**Qué habilita:**

- `canAccessCourse`.
- `canAccessStudent` (alumnos del curso).
- Pull de cursos y alumnos.
- Export / calendario filtrados por curso.
- Crear/editar alumnos vía sync (requiere link).
- Base para asistencia/notas (vía alumno).

**Naturaleza:** **relación primaria** de alcance pedagógico del docente.

---

## Semántica de `docente_materias`

**Qué habilita:**

- `canAccessSubject`.
- Asistencia/notas/actividades/trabajos que requieren materia.
- Pull de materias (más auto-link).
- Snapshot de vista curso+materia.

**Naturaleza:** **independiente** de `docente_cursos` a nivel FK. Un docente puede tener materia sin curso y viceversa.

---

## ¿Independientes o jerárquicas?

**Respuesta: independientes (A), no jerarquía real (B).**

No existe:

`docente → escuela → curso → materia`

como cadena de FK o de autorización.

- Escuela y curso se relacionan por **nombre TEXT** (`cursos.escuela`), no por `escuela_id`.
- Materia no pertenece a un curso en schema.
- Las tres tablas `docente_*` no se validan entre sí.

Cualquier UI admin “paso a paso escuela→curso→materia” sería **producto/UX**, no reflejo del modelo actual — y si se impone validación cruzada, sería un **cambio de semántica** (documentar en Part 2).

---

## Inconsistencias encontradas

1. **Materia sin curso / curso sin materia:** permitido y frecuente; auth lo soporta.
2. **Curso “de otra escuela”:** posible porque `cursos.escuela` es texto libre vs `escuelas.id`.
3. **Escuela asignada sin cursos:** válido; casi sin efecto en gates de datos.
4. **Relaciones de otro tenant:** prevenidas en writes con AuthContext; PKs globales + checks.
5. **Duplicados:** PK compuesto evita duplicados exactos.
6. **Huérfanas:** CASCADE limpia si se borra curso/materia/usuario; soft-delete de materia/escuela **no** limpia `docente_*`.
7. **Auto-creación sync/ensure/import/pull:** docente obtiene links sin admin.
8. **Admin create curso/materia (5C):** no crea `docente_*` — asimetría con sync docente.
9. **Revoke membership:** deja `docente_*` intactas → reactivate restaura acceso completo.
10. **Backup restore:** histórico omite `escuelas` / `docente_escuelas` (deuda 5C audit).
11. **Import alumnos** sin `canAccessStudent` (deuda previa; fuera de 5D pero afecta alumnos del curso asignado).

---

## Riesgos de seguridad

| Riesgo | Severidad | Scope |
|--------|-----------|-------|
| Self-assign intra-tenant vía sync/ensure/excel/pull | Medio (producto/governance) | Mismo tenant |
| Escalada cross-tenant vía `docente_*` | Bajo (controles actuales) | — |
| Revoke sin unassign → revive con pedagogy | Medio | Membership lifecycle |
| Soft-delete materia/escuela deja links activos | Bajo–medio | Al reactivar entidad |
| Admin no gestiona `docente_escuelas` | Bajo | Consistencia pull |
| `ensureDocente*` en actividades/trabajos | Medio | Bypass de “solo admin asigna” |

**No se corrigieron** en esta fase (según instrucciones).

---

## Diseño propuesto para 5D Part 2

### 1. ¿Reutilizar tablas existentes?

**Sí.** `docente_escuelas`, `docente_cursos`, `docente_materias` son suficientes. No hace falta modelo paralelo.

### 2. ¿Migración?

**No obligatoria** para un CRUD admin de asignaciones. Opcional futura: cleanup al revoke; índices; no `escuela_id` en cursos (fuera de 5D).

### 3. ¿Nuevos endpoints?

Sí, mínimos, estilo admin existente, p.ej.:

- `GET/POST/DELETE /api/admin/teachers/:userId/schools` (o body `{ docenteId, escuelaId }`)
- igual para `courses` / `subjects`

o un único `/api/admin/teacher-assignments` con `type=school|course|subject`.

Siempre `auth.tenantId` + verificar que docente tiene membership (idealmente active) en ese tenant + recurso pertenece al tenant.

### 4. ¿Qué puede modificar el admin?

- Listar asignaciones del docente en `auth.tenantId`.
- Añadir/quitar filas en las tres tablas (IDs validados al tenant).
- Opcional: replace-set (diff) al guardar formulario.

### 5. ¿Qué puede modificar el docente?

**Hoy:** mucho (sync/ensure).  
**Recomendación 5D:** no abrir endpoints docente para self-edit de asignaciones.  
**No bloquear sync self-assign en Part 2** salvo decisión explícita de producto (sería cambio de comportamiento docente; documentar como follow-up).

### 6–8. ¿Jerarquía escuela→curso→materia? ¿Validar entre sí? ¿Materia∈curso?

- **No** imponer jerarquía en DB.
- UI puede sugerir filtros (cursos cuyo `escuela` TEXT matchea escuela elegida) sin validación dura.
- Materia **no** pertenece a curso en el modelo; UI debe tratar materias como catálogo institucional.

### 9. UI

En `/admin/usuarios` o página docente detalle:

- Multiselect escuelas / cursos / materias del tenant.
- Mostrar estado membership (revoked → warning: asignaciones inertes hasta reactivar).

### 10. Aislamiento

- Resolver docente por `userId` + membership/`usuarios` scoped a `auth.tenantId`.
- Resolver escuela/curso/materia con `WHERE id=? AND tenant_id=auth.tenantId`.
- Rechazar `tenant_id` cliente.

### 11. AuthContext

Toda API admin: `locals.auth.role==='admin'`. No `user.rol` solo.

### 12. Docente revocado

- Fail closed vía AuthContext (ya).
- Part 2: **no** borrar `docente_*` automáticamente en revoke (cambio de semántica); opcional flag “limpiar asignaciones” documentado.
- UI: no permitir nuevas assigns a membership revoked (recomendado).

### 13–14. Delete/desactivar escuela/curso/materia

| Evento | Comportamiento actual | Propuesta 5D |
|--------|----------------------|--------------|
| Delete curso (admin, sin alumnos) | CASCADE/`DELETE docente_cursos` | Mantener |
| Soft-delete escuela/materia | Links quedan | Mantener; listados admin pueden ocultar inactivas |
| Rename escuela | 5C actualiza `cursos.escuela` TEXT | Assignments por `escuela_id` intactas |

## Cambios que NO son necesarios

- Tablas nuevas de asignación.
- Migrar `cursos.escuela` a FK.
- Reescribir sync/offline/school-app.js.
- CRUD alumnos.
- Institution switch / superadmin.
- Forzar jerarquía escuela→curso→materia en schema.
- Eliminar self-assign docente (salvo decisión explícita posterior).

---

## Test plan

1. Admin A asigna docente A → curso A; docente obtiene `canAccessCourse` / pull.
2. Docente A no accede curso B (otro tenant o sin assign).
3. Admin A no puede assign curso/escuela/materia de tenant B (403/404).
4. Docente no tiene endpoint para mutar sus assigns (o 403).
5. Docente revoked: AuthContext null aunque existan `docente_*`.
6. Reactivate: acceso vuelve con assigns previas (documentar).
7. IDs de institución B con sesión A → fail closed.
8. Multi-membership: single-context; assign solo en `auth.tenantId`.
9. Sync create course sigue self-assign (regresión) **o** test explícito si se decide endurecer.
10. Regresión: `verify:auth-memberships`, memberships, institution, teachers, settings, academic, auth-email, guides, build.

---

## Archivos inspeccionados (principales)

- `src/server/db.ts`, `src/db/schema.sql`
- `src/server/auth.ts`, `auth-context.ts`, `docente-access.ts`
- `src/server/sync-pull.ts`, `src/pages/api/sync.ts`
- `src/server/excel-import.ts`, `export.ts`
- `src/server/institution-teachers.ts`, `institution-academic.ts`
- `src/pages/api/calendar.ts`, `actividades*`, `trabajos*`, `admin/teachers*`
- Docs 5C Part 1 auth/structure audits

---

## Decisión recomendada (Part 2)

**Reutilizar las tres tablas `docente_*` con APIs admin scoped a AuthContext.**  
Tratar las relaciones como **independientes**.  
No migrar schema.  
No tocar offline/sync en el primer corte.  
Documentar deuda: self-assign docente + revoke-without-unassign + `docente_escuelas` infrautilizada en gates.
