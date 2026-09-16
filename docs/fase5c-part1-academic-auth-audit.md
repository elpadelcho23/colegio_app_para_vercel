# FASE 5C Part 1 — Authorization & teacher-side dependencies (academic entities)

Audit of how **escuelas / cursos / materias / alumnos / docente_*** are authorized and touched today. Concrete `file:function` references and tenant-isolation notes for designing admin academic-structure APIs.

---

## Auth stack (shared)

| Layer | File | Role |
| --- | --- | --- |
| Middleware | `src/middleware.ts` `onRequest` | Session → `getUserFromToken` → `resolveAuthContext` → sets `locals.user` (with `applyAuthContextToUser`) and `locals.auth`. Protects `/api/*` (except public), pages, and `/admin` / `/api/admin/*` (requires `auth.role === 'admin'`). |
| AuthContext | `src/server/auth-context.ts` `resolveAuthContext` / `resolveAuthContextDetailed` | **Authority for non-guest:** active `institution_memberships` for `(user.id, user.tenant_id)` + tenant not suspended. **Guest:** `usuarios.tenant_id` + `usuarios.rol` (`guest-legacy`). `usuarios.rol` alone never authorizes non-guest. |
| Overlay | `applyAuthContextToUser` | Copies `context.tenantId` → `user.tenant_id`, `context.role` → `user.rol` so legacy handlers reading `user.rol` / `user.tenant_id` see membership values. |
| Session user | `src/server/auth.ts` `getUserFromToken` / `verifyLogin` | Loads raw `usuarios.tenant_id` + `usuarios.rol` from DB (pre-overlay). |

**There is no `canAccessSchool` / `canAccessEscuela`.** School access is only via sync upsert + `docente_escuelas` links and pull JOINs.

---

## A) `canAccess*` and related gates

### `src/server/auth.ts`

#### `canAccessStudent(user, studentId)` — lines ~308–329

1. `resolveAuthContext(user)` → fail if no ctx.
2. Load `alumnos` by **id only**; require `student.tenant_id === ctx.tenantId`.
3. If `ctx.role === 'admin'` → allow (same tenant).
4. Else require row in `docente_cursos` joining `alumnos.curso_id` with `docente_id = user.id` and both `tenant_id = ctx.tenantId`.

**Uses:** AuthContext (`tenantId`, `role`), not `locals.auth` directly. Uses `user.id` for docente link. Does **not** re-read `usuarios.tenant_id` after overlay; relies on caller’s `user` having been overlaid or raw user with matching membership.

#### `canAccessSubject(user, subjectId)` — lines ~332–350

1. AuthContext; load `materias` by id; tenant match.
2. Admin → allow.
3. Else `docente_materias` where `materia_id`, `docente_id = user.id`, `tenant_id = ctx.tenantId`.

#### `canAccessCourse(user, courseId)` — lines ~353–371

1. AuthContext; load `cursos` by id; tenant match.
2. Admin → allow.
3. Else `docente_cursos` for `(curso_id, docente_id, tenant_id)`.

**Call sites:** `src/pages/api/sync.ts`, `src/pages/api/calendar.ts` (POST event), `src/server/excel-import.ts` (asistencias/notas only), `scripts/verify-auth-memberships.ts`.

### `src/server/docente-access.ts` (ensure*, not canAccess*)

#### `ensureDocenteCourseAccess(user, course)` — lines ~28–77

- AuthContext; reject if course id owned by **other** tenant (`courseOwnedByOtherTenant`).
- Admin → OK without assignment.
- Docente: if `docente_cursos` exists → OK; else may **INSERT** `cursos` (if missing + seed fields) and **INSERT OR IGNORE** `docente_cursos`.

#### `ensureDocenteSubjectAccess(user, subject)` — lines ~80–118

- Same pattern for `materias` / `docente_materias`.

**Call sites:** `actividades.ts`, `actividades/enviar.ts`, `actividades/generar.ts`, `trabajos/index.ts`.

**Risk note:** Within a tenant, any docente who knows/sends an existing course/subject id gets an assignment link (and may create missing rows). This is softer than `canAccess*` (which only reads).

### Middleware vs handlers

| Mechanism | Used for academic entities? |
| --- | --- |
| `locals.auth` | Sync pull/push, export, calendar, admin APIs, trabajos GET/POST — explicit checks. |
| `user.rol` (post-overlay) | Export `docenteCourseClause`, calendar `scope`, excel-import `user.rol !== 'admin'`, actividades filters. |
| `usuarios.tenant_id` raw | Only via AuthContext resolution key; writes use `ctx.tenantId` or overlaid `user.tenant_id`. |
| Membership | Via `resolveAuthContext` → `getActiveMembership`; admin area gated by `auth.role === 'admin'`. |

**Gap:** Import API routes (`import/index.ts`, `preview.ts`, `template.ts`, `ai-map.ts`) check `locals.user` only; middleware still returns 403 if `!auth` on protected APIs, so OK in practice but inconsistent with sync/export.

---

## B) Sync pull / sync push

### Pull — `src/server/sync-pull.ts` `pullClientData`

Entry: `src/pages/api/sync/pull.ts` GET → requires `locals.user` + `locals.auth`.

| Entity | Admin | Docente |
| --- | --- | --- |
| `cursos` | `WHERE tenant_id = ?` | JOIN `docente_cursos` on curso + tenant + `docente_id` |
| `escuelas` | tenant | JOIN `docente_escuelas` |
| `materias` | tenant | JOIN `docente_materias` |
| `alumnos` | tenant | JOIN `docente_cursos` via `alumnos.curso_id` |
| `alumno_materias` | tenant | JOIN alumnos + `docente_cursos` (not `docente_materias`) |
| `asistencias` / `notas` | `tenantFilter` admin: tenant only | tenant + `docente_id` |
| `docente_client_state` | by `docente_id` + `tenant_id` (current user) | same |

**Side effect:** If `alumno_materias` references materias not in docente’s `docente_materias`, pull loads those materias and **auto-INSERT** `docente_materias` for the docente (`sync-pull.ts` ~144–163). Expands teacher subject access silently.

Tenant always from AuthContext; never from query string.

### Push — `src/pages/api/sync.ts` POST

Helpers:

- `syncTenantId` / `syncAuth` → AuthContext only.
- `rejectPayloadTenantMismatch` — if payload has `tenantId`/`tenant_id` ≠ session → error.
- `rejectForeignPrimaryKey` — global PK owned by other tenant → error (tables: alumnos, cursos, materias, notas, escuelas, asistencias).
- `resolveSyncDocenteId` — non-admin must use own id; admin may target another user **in same** `ctx.tenantId`.
- Non-admin: POST forces `payload.docenteId = user.id`.

| Entity | Auth checks | Table writes |
| --- | --- | --- |
| `attendance` | `validateAttendancePermission` → `canAccessStudent` + `canAccessSubject` | `asistencias` (+ tenant/docente from session) |
| `student` | curso in tenant; docente needs `docente_cursos` for `cursoId`; update/delete: `canAccessStudent`; subjectIds: tenant + `canAccessSubject` | `alumnos`, `alumno_materias`; soft-delete if deps |
| `course` | update/delete: `canAccessCourse` (or admin); create: any auth user in tenant | `cursos` + `INSERT OR IGNORE docente_cursos` |
| `subject` | update/delete: `canAccessSubject` (or admin); create: any | `materias` + `docente_materias` |
| `school` | **no canAccess***; foreign tenant check on existing id; admin vs unlink `docente_escuelas` | `escuelas` + `docente_escuelas` |
| `grade` | same permission helper as attendance | `notas` |
| `clientState` | own docente (admin may set other) | `docente_client_state` |

**Create semantics:** Docente upsert of new course/subject/school **self-assigns** via `docente_*` — intentional teacher-local catalog, not institution-gated.

Client: `src/scripts/sync-client.ts` `hydrateFromServer` → `/api/sync/pull`; `syncPendingOperations` → `/api/sync`.

---

## C) Excel import / export

### Import APIs

| Route | File | Auth | Types |
| --- | --- | --- | --- |
| POST `/api/import` | `src/pages/api/import/index.ts` | `locals.user` (middleware auth) | `cursos`, `alumnos`, `asistencias`, `notas` |
| POST `/api/import/preview` | `import/preview.ts` | user | alumnos / asistencias / notas |
| GET `/api/import/template` | `import/template.ts` | user | same four types |
| POST `/api/import/ai-map` | `import/ai-map.ts` | user | column mapping AI (no DB writes) |

Core: `src/server/excel-import.ts`

| Function | Behavior vs academic tables |
| --- | --- |
| `ensureSchool` | Find/create `escuelas` by name in `user.tenant_id`; non-admin → `docente_escuelas` |
| `ensureCourse` | Find/create `cursos`; non-admin → **always** `docente_cursos` (including for **pre-existing** courses) |
| `ensureSubject` / `resolveSubject` | Find/create `materias`; non-admin → `docente_materias` |
| `upsertStudentRow` / `importStudentRows` | Create/update `alumnos` by DNI or name; rewrite `alumno_materias`. **No `canAccessStudent`.** |
| `importCourses` | Via `ensureCourse` |
| `importAttendance` / `importGrades` | Resolve course/student/subject; **`canAccessStudent` + `canAccessSubject`** before write |

Uses `user.tenant_id` and `user.rol` (expects middleware overlay). Does not call `resolveAuthContext` itself.

### Export

`src/pages/api/export.ts` GET — requires `locals.user` + `locals.auth`.

- Params: `user.tenant_id`, `user.id` as docente; filters colegio/curso/materia/ciclo/dates from **query** (IDs are filters only; permission via clauses).
- `docenteCourseClause(user)`: admin → tenant; else EXISTS `docente_cursos`.
- Asistencias/notas: tenant + (admin \| `docente_id`).
- Types: `alumnos` | `asistencias` | `notas` | `completo`.

UI: `school-app.js` builds `/api/export?...`; tools hub `tools-ui.js` POSTs `/api/import` (alumnos/asistencias/notas); cursos page uses `initSimpleExcelImport` for type `cursos`.

---

## D) `school-app.js` — expected UI operations (high level)

File: `src/scripts/school-app.js`. Local keys: `aula_clara_{students,courses,schools,subjects,...}` scoped per user via client store. Persistence: `queue` → offline ops → `/api/sync` with `docenteId: currentUser.id`.

| Area | Ops UI expects | Sync entity |
| --- | --- | --- |
| Escuelas | List tags; create by name (`upsertSchoolByName`); select on course/student forms; derived from course.escuela names | `school` upsert |
| Cursos | Create división (escuela+nombre+turno+ciclo); list/accordion with alumnos; Excel import type `cursos`; filter by ciclo/escuela | `course` upsert (no delete UI spotted in initCourses) |
| Materias | CRUD form (`initSubjects`); soft-delete → sync `delete`; create-by-name when assigning to alumno (`upsertSubjectByName`) | `subject` upsert/delete |
| Alumnos | Create/update profile (curso, DNI, tutor, subjectIds, activo); soft-delete with undo; Excel import via tools | `student` upsert/delete |
| Contexto docente | “Curso actual” escuela/curso/materia; `teacherContext` / dashboard filters | `clientState` |
| Asistencias / notas | Mark attendance, grades against teaching context | `attendance` / `grade` |
| Hydration | On load: `hydrateFromServer` replaces catalog from pull | pull |

**Not admin-managed in UI:** structure is teacher-authored offline-first; admin page only assigns existing cursos/materias when inviting teachers.

---

## E) Admin endpoints touching academic structure

**No dedicated CRUD** for escuelas/cursos/materias/alumnos under `/api/admin/*`.

| Endpoint | Relation to academic structure |
| --- | --- |
| `GET/POST /api/admin/teachers` (`admin/teachers/index.ts`) | Lists/creates docentes; POST accepts `cursoIds` / `materiaIds` → `institution-teachers.assignPedagogy` (filters IDs to tenant, writes `docente_cursos` / `docente_materias`). Rejects client `tenant_id` ≠ `auth.tenantId`. |
| `POST /api/admin/register-teacher` | Legacy form → same `addOrInviteTeacher` + curso/materia assignment. |
| `POST .../teachers/revoke` / `reactivate` | Membership only (not unassign pedagogy in detail here). |
| `GET /api/admin/usuarios` | Lists users in `auth.tenantId`. |
| `GET/PATCH /api/admin/tenant` | Institution metadata + `getTenantStats` (counts cursos/materias/alumnos). |
| `admin/usuarios.astro` | Renders checkboxes of **all** tenant `cursos` / `materias` for teacher invite form (`WHERE tenant_id = auth.tenantId`). |
| Backup create/restore | Tenant-scoped backups; not structure editors. |

**Implication for FASE 5C:** Academic structure today is created by **docente sync/import**, not admin APIs. Admin only **assigns** existing IDs to teachers.

---

## F) Tenant isolation risks

### Cross-tenant (generally hardened)

| Control | Where |
| --- | --- |
| AuthContext tenant for all sync writes | `sync.ts` `syncTenantId` / `rejectPayloadTenantMismatch` |
| Foreign global PK rejection | `rejectForeignPrimaryKey` |
| canAccess* tenant check before id | `auth.ts` |
| Pull filtered by AuthContext tenant | `sync-pull.ts` |
| Admin APIs reject other tenant_id in body/query | `admin/teachers`, `admin/tenant`, `admin/usuarios` |
| Middleware denies protected API without AuthContext | `middleware.ts` |

### Residual / design risks

1. **Student Excel import without `canAccessStudent`** (`excel-import.ts` `upsertStudentRow`)  
   - Lookup by `(tenant_id, dni)` can update **any** student in the institution and change `curso_id` / materias.  
   - `ensureCourse` then grants importer `docente_cursos` on that course.  
   - **Intra-tenant privilege expansion / student hijack by DNI.**

2. **Import `ensureCourse` / `ensureSubject` auto-link**  
   - Importing against an existing course/subject silently inserts `docente_cursos` / `docente_materias` for the importer (not only newly created rows).

3. **`ensureDocenteCourseAccess` / `ensureDocenteSubjectAccess`**  
   - Used by actividades/trabajos/generar: knowing an id (or creating with seed names) grants assignment. Cross-tenant blocked; same-tenant open.

4. **Sync pull auto `docente_materias`**  
   - Subjects appearing only via `alumno_materias` on assigned courses become assigned to the teacher.

5. **No `canAccessSchool`**  
   - Any docente in tenant can upsert/rename a school by id (`applySchool`); create always links `docente_escuelas`.  
   - Update of existing same-tenant school does not require prior `docente_escuelas`.

6. **Docente can create shared catalog entities**  
   - Sync course/subject/school create writes tenant-global rows + self-assignment. Fine for solo-teacher model; weak for “admin owns structure”.

7. **Queries by id without `tenant_id` in SELECT** (name leakage / confusion)  
   - `actividades/generar.ts`: `SELECT nombre FROM cursos/materias WHERE id = ?` after ensure* (usually same tenant).  
   - `aula-temporal/[id]/generar-ia.ts`: same for curso/materia.  
   - `canAccess*` / `docente-access` ownership probes: `SELECT tenant_id FROM … WHERE id = ?` then compare — OK if followed by reject.  
   - Prefer `WHERE id = ? AND tenant_id = ?` everywhere for defense in depth.

8. **`docente_client_state` PK = `docente_id` only** (`db.ts`)  
   - Single row per user globally; `ON CONFLICT` updates gated by `tenant_id` match. Multi-institution user switching contexts can collide / fail to store per-tenant state.

9. **Export / calendar trust filter IDs from client**  
   - Mitigated by tenant + `docente_cursos` / `canAccess*` clauses; empty filters do not widen past those. Low risk if clauses stay correct.

10. **Import/export handlers trust overlaid `user.rol`**  
    - Safe if always behind middleware overlay; dangerous if ever called with raw `User` from DB in a script without `applyAuthContextToUser` (verify script uses canAccess with real users — OK).

11. **`trabajos/index.ts` alumno attach**  
    - Loads alumno by `id + tenant_id` but does not call `canAccessStudent` (only entrega ownership). Same-tenant alumno in another course may be linkable depending on later checks — review if FASE 5C tightens pedagogy scope.

12. **Global primary keys** on `cursos` / `materias` / `alumnos` / `escuelas`  
    - Collision across tenants blocked by `rejectForeignPrimaryKey` / ownership checks; ID enumeration still reveals “belongs to another account” errors (info leak low severity).

### Explicit non-risks (verified)

- Sync POST does not take tenant authority from payload.
- Admin teacher assignment filters `cursoIds`/`materiaIds` to `auth.tenantId` (`assignPedagogy`).
- Guest without AuthContext cannot hit protected academic APIs (middleware `no_auth_context`).

---

## Dependency map (FASE 5C planning)

```
AuthContext (membership|guest-legacy)
    ├─ canAccessCourse/Subject/Student  → sync, calendar, excel attendance/grades
    ├─ ensureDocente*                     → actividades, trabajos, generar
    ├─ pullClientData                     → docente_* JOINs + auto materia link
    ├─ sync apply*                        → CRUD academic + docente_* self-assign
    ├─ excel-import ensure*/upsert        → creates structure + docente_* (students skip canAccess)
    └─ admin assignPedagogy               → docente_cursos/materias only (no structure CRUD)
```

**Teacher UI expects** full local CRUD + Excel for structure; **admin UI expects** pick existing cursos/materias when inviting teachers. Any admin “academic structure” API must either (a) coexist with teacher sync creates, or (b) harden teacher paths (import/sync create, ensure*, pull auto-link) to stop open intra-tenant catalog mutation.

---

## Key file index

| Path | Symbols |
| --- | --- |
| `src/middleware.ts` | `onRequest` |
| `src/server/auth-context.ts` | `resolveAuthContext`, `applyAuthContextToUser`, `isInstitutionAdmin` |
| `src/server/auth.ts` | `canAccessStudent`, `canAccessSubject`, `canAccessCourse` |
| `src/server/docente-access.ts` | `ensureDocenteCourseAccess`, `ensureDocenteSubjectAccess` |
| `src/server/sync-pull.ts` | `pullClientData`, `tenantFilter` |
| `src/pages/api/sync.ts` | `applyStudent/Course/Subject/School/...`, `POST` |
| `src/pages/api/sync/pull.ts` | `GET` |
| `src/server/excel-import.ts` | `ensureSchool/Course/Subject`, `upsertStudentRow`, `importAttendance`, `importExcelBuffer` |
| `src/pages/api/export.ts` | `docenteCourseClause`, `GET` |
| `src/pages/api/import/*.ts` | import/preview/template/ai-map |
| `src/server/institution-teachers.ts` | `assignPedagogy`, `addOrInviteTeacher` |
| `src/pages/admin/usuarios.astro` | lists cursos/materias for assignment |
| `src/scripts/school-app.js` | UI CRUD + queue + export/import hooks |
| `src/scripts/sync-client.ts` | `hydrateFromServer`, sync POST |
| `scripts/verify-auth-memberships.ts` | regression for canAccess + pull isolation |
