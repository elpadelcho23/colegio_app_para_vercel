# CRUD, dashboard filtrable y dark mode

## UX de cursos

Se implemento accordion en `/cursos` en lugar de ruta `/cursos/[id]`.

Motivo: para uso docente cotidiano conviene abrir un curso, ver alumnos/materias y ejecutar acciones rapidas sin cambiar de pantalla. La ruta dinamica queda como mejora futura cuando haya ficha profunda del curso, historiales o permisos mas finos.

## CRUD offline

Las acciones de alumnos, notas y materias actualizan primero la UI local y luego generan `pending_operations`.

Entidades soportadas por sync:

- `student`
- `grade`
- `subject`
- `attendance`

Acciones:

- `upsert`
- `delete`

El backend valida sesion, `docenteId`, permisos y aplica last-write-wins usando `updatedAt`.

## Reglas de eliminacion

- Alumno con notas/asistencias: no se borra fisicamente, queda `activo = false`.
- Materia con notas/asistencias: no se borra fisicamente, queda `activo = false`.
- Nota: se elimina fisicamente porque no rompe otras relaciones.

## Dashboard

El dashboard tiene filtros persistidos en `localStorage`:

- Escuela
- Curso
- Materia

Los KPIs y alertas se calculan solo sobre ese contexto.

## Dark mode

El toggle esta en la navegacion. Guarda preferencia en:

```text
aula_clara_theme
```

El tema se aplica con `:root[data-theme="dark"]` y variables CSS, para evitar colores sueltos inconsistentes.

## Prueba manual

1. Entrar en `/login`.
2. Ir a `/registro`, editar un alumno y eliminar otro.
3. Ir a `/notas`, editar/eliminar una nota.
4. Ir a `/materias`, editar/eliminar una materia.
5. Ir a `/cursos`, abrir un curso y usar acciones rapidas.
6. Ir al dashboard `/`, cambiar filtros y recargar: deben persistir.
7. Activar `Modo oscuro`, recargar: debe persistir.
8. Simular offline, hacer cambios, volver online y presionar `Sincronizar`.

Validacion tecnica:

```sh
npx tsc --noEmit
npm run build
```
