# FASE 5C — Parte 1: Auditoría y diseño de integración

**Estado:** auditoría + diseño (sin CRUD admin nuevo).  
**Base:** Fases 1–5B (AuthContext, memberships, docentes, settings).  
**Regla:** Admin debe administrar las **mismas** entidades que usa el docente — no un modelo paralelo.

---

## 1. Mapa actual de entidades

### A) `escuelas`

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | Global PK |
| `tenant_id` | TEXT NOT NULL | FK → `tenants` CASCADE |
| `nombre` | TEXT NOT NULL | |
| `activo` | INTEGER DEFAULT 1 | Soft-delete |
| `created_at` / `updated_at` | TEXT | |

- **Relaciones:** `docente_escuelas(escuela_id)`. **No hay FK** desde `cursos` — `cursos.escuela` es TEXT con el **nombre**.
- **Quién crea/modifica:** docentes (y admin vía sync) por `/api/sync` entity `school`; Excel import `ensureSchool`.
- **Consumo docente:** tags/selector de escuela en cursos/alumnos; pull filtra por `docente_escuelas` (admin: todo el tenant).
- **Sin `canAccessSchool`.**

### B) `cursos`

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | |
| `tenant_id` | TEXT NOT NULL | FK tenants |
| `escuela` | TEXT NOT NULL | **Nombre**, no `escuela_id` |
| `nombre` | TEXT NOT NULL | División / año |
| `turno` | TEXT NOT NULL | |
| `ciclo_lectivo` | INTEGER DEFAULT 2026 | No hay tabla `ciclos` |
| timestamps | TEXT | |

- **Relaciones:** `alumnos.curso_id` (RESTRICT), `docente_cursos.curso_id` (CASCADE).
- **Ciclo:** filtro SQL vía `ciclo-lectivo.ts` sobre `ciclo_lectivo`.
- **Quién crea:** sync `course`, Excel `ensureCourse`, `ensureDocenteCourseAccess`.
- **Docente:** listado/accordion, contexto “curso actual”, asistencia/notas/actividades.

### C) `materias`

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | |
| `tenant_id` | TEXT NOT NULL | |
| `nombre` | TEXT NOT NULL | |
| `activo` | INTEGER DEFAULT 1 | Soft-delete |
| timestamps | TEXT | |

- **Sin FK a curso.** Catálogo tenant-global. Vinculación alumno↔materia: `alumno_materias`.
- **Docente:** `docente_materias`; notas/actividades/trabajos requieren materia.

### D) `alumnos`

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | |
| `tenant_id` | TEXT NOT NULL | |
| `curso_id` | TEXT NOT NULL | FK cursos **RESTRICT** |
| `nombre` | TEXT NOT NULL | |
| `dni` | TEXT | UNIQUE `(tenant_id, dni)` |
| `tutor` | TEXT | nullable |
| `activo` | INTEGER DEFAULT 1 | Soft-delete |
| timestamps | TEXT | |

- **Mover de curso:** update `curso_id` (sync/import). Impacta visibilidad docente (`docente_cursos` del nuevo curso), planillas, filtros.
- **Delete hard** bloqueado si hay dependencias → soft `activo=0`.

### E) Asignaciones docentes

| Tabla | PK | Significado |
|-------|-----|-------------|
| `docente_escuelas` | `(tenant_id, docente_id, escuela_id)` | Docente ↔ escuela |
| `docente_cursos` | `(tenant_id, docente_id, curso_id)` | Docente ↔ curso (**autoridad primaria** para ver alumnos) |
| `docente_materias` | `(tenant_id, docente_id, materia_id)` | Docente ↔ materia (notas/actividades) |

**Jerarquía:** independientes a nivel FK. En práctica:
- Acceso a alumnos = `docente_cursos` (no exige escuela).
- Acceso a notas/asistencias = alumno (vía curso) + materia (`docente_materias` / `canAccessSubject`).
- Pull puede **auto-insertar** `docente_materias` si aparecen vía `alumno_materias`.
- Crear curso/materia/escuela por sync **self-asigna** `docente_*`.

### Adyacente

- `alumno_materias` — materias del alumno (no es asignación docente).
- **No existe tabla `ciclos`** — solo `cursos.ciclo_lectivo`.

---

## 2. Relaciones (diagrama)

```
tenants
  ├── escuelas ─── docente_escuelas ─── usuarios
  ├── cursos ──── docente_cursos ───── usuarios
  │     │         (cursos.escuela TEXT ≈ escuelas.nombre)
  │     └── alumnos ── alumno_materias ── materias
  └── materias ── docente_materias ─── usuarios
```

**Gap estructural clave:** `cursos.escuela` (string) ≠ FK a `escuelas.id`. Rename/delete de escuela requiere match por nombre.

---

## 3. Endpoints actuales

### Estructura académica (CRUD real)

| Operación | Endpoint | Helper / apply |
|-----------|----------|----------------|
| Crear/editar/borrar escuela | `POST /api/sync` entity `school` | `applySchool` |
| Crear/editar/borrar curso | `POST /api/sync` entity `course` | `applyCourse` |
| Crear/editar/borrar materia | `POST /api/sync` entity `subject` | `applySubject` |
| Crear/editar/borrar alumno | `POST /api/sync` entity `student` | `applyStudent` |
| Pull catálogo | `GET /api/sync/pull` | `pullClientData` |
| Import Excel cursos/alumnos | `POST /api/import` | `excel-import.ts` |
| Export | `GET /api/export` | filtros curso/materia/ciclo |
| Plantillas | `GET /api/import/template` | |

**No hay** `/api/admin/escuelas|cursos|materias|alumnos`.

### Admin que toca estructura (solo asignación)

| Endpoint | Qué hace |
|----------|----------|
| `POST /api/admin/teachers` | `assignPedagogy` → `docente_cursos` / `docente_materias` (IDs filtrados a `auth.tenantId`) |
| `POST /api/admin/register-teacher` | Igual (legacy) |
| `GET/PATCH /api/admin/tenant` | Stats de conteos; no CRUD académico |
| `/admin/usuarios` | Lista cursos/materias del tenant para checkboxes |

### Páginas

| Ruta | Rol |
|------|-----|
| `/cursos` | UI escuelas + cursos + ciclo (`SchoolCyclePanel`) |
| `/materias` | Redirect → `/notas` |
| `/registro` | Planilla alumnos |
| `/admin/usuarios`, `/admin/institucion` | Docentes / settings (no estructura) |

---

## 4. Servicios / helpers

| Archivo | Función |
|---------|---------|
| `auth.ts` | `canAccessStudent`, `canAccessCourse`, `canAccessSubject` (AuthContext + `docente_*`) |
| `docente-access.ts` | `ensureDocenteCourseAccess`, `ensureDocenteSubjectAccess` (puede crear + asignar) |
| `sync-pull.ts` | `pullClientData` |
| `sync.ts` | `applySchool/Course/Subject/Student/...` |
| `excel-import.ts` | `ensureSchool/Course/Subject`, `upsertStudentRow`, imports |
| `ciclo-lectivo.ts` | filtros `ciclo_lectivo` |
| `institution-teachers.ts` | `assignPedagogy` |
| `tenant.ts` | `getTenantStats` |
| `backup.ts` | restore **omite** `escuelas`, `docente_escuelas`, `alumno_materias` |

Detalle ampliado de autorización: ver sección 7–8 y el anexo `docs/fase5c-part1-academic-auth-audit.md` (misma auditoría).

---

## 5. Dependencias del lado docente

| Área | Dependencia de estructura |
|------|---------------------------|
| Dashboard / contexto | escuela + curso + materia “actual” (`clientState` / UI) |
| Alumnos | `alumnos.curso_id` + acceso vía `docente_cursos` |
| Cursos / materias | tablas + `docente_*`; UI offline-first |
| Asistencia / calificaciones | alumno + materia + tenant; sync entities |
| Actividades / trabajos | `ensureDocente*` + curso/materia IDs |
| Informes / export | filtros curso/materia/ciclo + `docente_cursos` |
| Excel | crea/asegura escuela/curso/materia/alumno |
| Offline | IndexedDB/local keys en `school-app.js` + cola |
| Sync | push/pull de las mismas filas |

**Garantía buscada:** Admin edita **esas** filas → pull docente las ve → misma representación.

---

## 6. Dependencias offline / sync

| Componente | Relación |
|------------|----------|
| `school-app.js` | CRUD local escuelas/cursos/materias/alumnos → queue sync |
| `sync-client.ts` | `hydrateFromServer` ← pull; `syncPendingOperations` → POST |
| IndexedDB / local store | Catálogo por docente; **no tocar en 5C Part 1–2 sin diseño** |
| Soft-delete | `activo` en escuelas/materias/alumnos; cursos hard-delete si sin alumnos |

**Regla de fase:** no modificar `school-app.js`, offline-db, sync-client, IndexedDB en Part 1.

---

## 7. Problemas de tenant isolation

### Endurecidos (OK)

- Sync escribe con `syncTenantId` (AuthContext); rechaza payload `tenant_id` distinto.
- `rejectForeignPrimaryKey` para PKs globales de otro tenant.
- `canAccess*` exige `tenant_id === ctx.tenantId`.
- Pull siempre filtra por AuthContext tenant.
- Admin teachers/settings rechazan `tenant_id` ajeno.

### Riesgos residuales (intra-tenant / diseño)

1. **Import alumnos sin `canAccessStudent`** — DNI puede actualizar cualquier alumno del tenant y cambiar `curso_id`.
2. **Import `ensureCourse`/`ensureSubject`** auto-enlazan al importador aunque el curso ya exista.
3. **`ensureDocente*`** otorga asignación conociendo el id (mismo tenant).
4. **Pull auto `docente_materias`** expande materias del docente.
5. **Sin `canAccessSchool`** — cualquier docente del tenant puede upsert escuela por id.
6. **Docente crea catálogo compartido** del tenant (modelo “profesor-autor”).
7. Algunos `SELECT … WHERE id = ?` sin `tenant_id` (defensa en profundidad incompleta).
8. **`docente_client_state` PK = `docente_id`** — fricción multi-institución futura.
9. **Backup restore omite `escuelas` / `docente_escuelas` / `alumno_materias`**.

---

## 8. Problemas de autorización

| Hallazgo | Severidad | Nota |
|----------|-----------|------|
| Admin bypass en `canAccess*` (mismo tenant) | Esperado | OK para futuro admin CRUD |
| Docente crea estructura sin gate institucional | Diseño actual | Choca con “admin dueño de estructura” |
| Import/API usan `user.rol` post-overlay | Bajo | Seguro si siempre hay middleware |
| Import routes no leen `locals.auth` explícito | Bajo | Middleware ya exige AuthContext |
| Revoke docente (5A) no limpia `docente_*` | Medio | Docente revocado pierde AuthContext; filas huérfanas quedan |

---

## 9. Propuesta de integración Admin → modelo actual

### Decisión arquitectónica (respuestas explícitas)

| # | Pregunta | Respuesta |
|---|----------|-----------|
| 1 | ¿Usar tablas existentes? | **Sí.** `escuelas`, `cursos`, `materias`, `alumnos`, `docente_*` son la fuente única. |
| 2 | ¿Cambios mínimos? | APIs admin que lean/escriban esas tablas con `auth.tenantId`; UI admin; **sin** tablas nuevas. Opcional: reforzar filtros `id+tenant_id`. |
| 3 | ¿Migración? | **No obligatoria** para CRUD admin. Opcional futura: `cursos.escuela_id` FK (hoy string). **No** en Part 1. |
| 4 | ¿Qué no cambiar? | Sync docente, offline, IndexedDB, asistencia/notas semantics, memberships, single-context. |
| 5 | ¿Qué reforzar? | Tenant check en todo write admin; validar FKs internas; política clara create vs assign; backup tables gap. |
| 6 | ¿Qué exponer al Admin ya? | List/create/update escuelas, cursos, materias; list alumnos; assign/unassign `docente_*` (extender 5A). |
| 7 | ¿Qué es peligroso? | Delete curso con alumnos; hard-delete escuela con cursos; mover alumnos masivo; borrar materias con notas; cambiar `ciclo_lectivo` con datos históricos. |
| 8 | ¿Qué dejar para después? | FK escuela_id; bloquear create docente; ciclos como entidad; sedes; permisos granulares; cleanup `docente_*` al revoke; dashboard. |

### Flujo objetivo

```
Admin (auth.role=admin, auth.tenantId)
  → CRUD sobre escuelas/cursos/materias/(alumnos)
  → mismas filas tenant
Docente
  → pull / UI existente consume esas filas
  → docente_* define alcance pedagógico
```

### Principios de implementación (Part 2+)

1. Autoridad: `locals.auth` + `auth.tenantId` + `auth.role === 'admin'`.
2. Nunca confiar en `tenant_id` / `rol` del cliente.
3. Toda mutación: `WHERE id = ? AND tenant_id = auth.tenantId`.
4. No duplicar entidades; no escribir a IndexedDB desde admin.
5. Deletes: preferir soft (`activo=0`) o bloquear si hay dependencias (como sync cursos).
6. Coexistencia: docentes pueden seguir creando por sync hasta que se decida endurecer (fase posterior).

---

## 10. Migraciones necesarias

| Migración | ¿Ahora? |
|-----------|---------|
| Nuevas tablas académicas | **No** |
| `cursos.escuela_id` | No (fase futura; documentado) |
| Ampliar backup restore (`escuelas`, `docente_escuelas`, `alumno_materias`) | Recomendado en Part 2 como fix aislado |
| Limpiar `usuarios.tenant_id` / `rol` | **No** (fuera de alcance) |

---

## 11. Operaciones recomendadas para la siguiente parte (5C Part 2)

Prioridad SEGURIDAD > AISLAMIENTO > COMPATIBILIDAD:

1. **Admin list** escuelas / cursos / materias del `auth.tenantId`.
2. **Admin create/update** escuela (nombre, activo).
3. **Admin create/update** curso (escuela nombre o id+nombre, división, turno, ciclo_lectivo) — documentar vínculo string.
4. **Admin create/update** materia (nombre, activo).
5. **Admin list alumnos** (read-only o edit suave: nombre/DNI/curso) con confirmación al cambiar `curso_id`.
6. **Assign/unassign** docente↔curso/materia (API dedicada o extender teachers).
7. Verify script: aislamiento A/B, no create tenant, no touch memberships, deletes seguros.
8. Fix backup table list (si se toca backup en la misma fase).

---

## 12. Operaciones que NO implementar todavía

- Tablas académicas nuevas / modelo paralelo
- Institution switch / superadmin / preceptor
- Reescritura de `school-app.js` / offline / sync-client
- Bloqueo total de create por docentes (cambio de producto)
- Migración `escuela` TEXT → `escuela_id`
- Eliminación masiva de alumnos / purge histórico notas-asistencias
- Dashboard institucional avanzado
- Reactivación tenant suspended
- Eliminar `usuarios.tenant_id` / `usuarios.rol`

---

## 13. Archivos modificados (esta parte)

Solo documentación:

- `docs/fase5c-part1-academic-structure-audit.md` (este informe)
- `docs/fase5c-part1-academic-auth-audit.md` (anexo auth/deps detallado)

**Sin cambios de runtime.**

---

## 14. Tests

Ejecutados tras la auditoría (sin cambios funcionales):

| Script | Resultado |
|--------|-----------|
| `verify:auth-memberships` | OK (19) |
| `verify:memberships` | OK (12) |
| `verify:institution` | OK (12) |
| `verify:institution-teachers` | OK (18) |
| `verify:institution-settings` | OK (15) |
| `verify:auth-email` | OK (15) |
| `verify:guides` | OK |
| `npm run build` | OK |

---

## 15. Build

`npm run build` — **OK** (Astro + Vercel adapter).

---

## Confirmaciones

- **No** se crearon tablas académicas nuevas.
- **No** se duplicó el modelo.
- **No** se modificó funcionalidad docente/offline/sync.
- Admin futuro debe operar sobre `escuelas` / `cursos` / `materias` / `alumnos` / `docente_*` existentes.
