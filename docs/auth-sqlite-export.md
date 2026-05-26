# Auth + SQLite + Sync + Export

## Estructura actualizada

```text
src/
  middleware.ts
  server/
    auth.ts
    db.ts
  pages/
    login.astro
    api/
      auth/login.ts
      auth/logout.ts
      sync.ts
      export.ts
  scripts/
    offline-db.ts
    sync-client.ts
```

## Usuarios demo

- Docente: `docente@aulaclara.test` / `Docente123!`
- Admin: `admin@aulaclara.test` / `Admin123!`

Las contrasenas se guardan con `bcryptjs`. La sesion usa cookie `HttpOnly`, `SameSite=Lax` y `Secure` cuando el sitio corre en HTTPS.

## SQLite

La base queda en `.data/aula-clara.sqlite`.

Tablas principales:

- `usuarios`
- `sessions`
- `cursos`
- `materias`
- `alumnos`
- `docente_cursos`
- `docente_materias`
- `asistencias`
- `notas`
- `sync_log`

`sync_log.client_mutation_id` es `PRIMARY KEY`, por eso una operacion offline reenviada no duplica datos.

## Sync

`/api/sync` requiere sesion. Cada asistencia enviada incluye:

```ts
{
  clientMutationId: string;
  entity: 'attendance';
  action: 'upsert';
  payload: {
    docenteId: string;
    studentId: string;
    subjectId: string;
    fecha: string;
    estado: 'presente' | 'ausente';
    updatedAt: string;
  }
}
```

El backend valida:

- El usuario esta logueado.
- El `docenteId` coincide con la sesion, salvo admin.
- El docente tiene permiso sobre el alumno.
- El docente tiene permiso sobre la materia.
- El `clientMutationId` no fue aplicado antes.

Conflictos: `last write wins` con `updatedAt`. Si llega una escritura mas vieja que la registrada, se ignora el cambio pero la operacion queda como sincronizada para no bloquear la cola.

## Export Excel

Endpoint:

```text
/api/export?curso=curso-6-1-manana&materia=programacion&desde=2026-05-01&hasta=2026-05-31
```

Genera `.xlsx` con:

- Hoja 1: `Asistencias`
- Hoja 2: `Notas`
- Hoja 3: `Resumen`

El docente solo exporta cursos asignados. Admin puede exportar todo.

## Prueba manual

1. Ejecutar `npm run dev`.
2. Abrir `http://127.0.0.1:4321/login`.
3. Entrar con `docente@aulaclara.test` / `Docente123!`.
4. Ir a `/asistencia`.
5. Simular offline desde DevTools.
6. Marcar presente/ausente.
7. Volver online.
8. Presionar `Sincronizar`.
9. Descargar Excel desde `Exportar Excel`.

Validacion tecnica:

```sh
npx tsc --noEmit
npm run build
```
