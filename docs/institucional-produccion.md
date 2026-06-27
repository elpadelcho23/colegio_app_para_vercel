# Mejoras institucionales y produccion

## Registro de profesores

Ruta:

```text
/admin/usuarios
```

Solo accesible por usuarios `admin`.

Validaciones:

- Email unico.
- Contrasena minima de 10 caracteres.
- Debe incluir minuscula, mayuscula, numero y simbolo.
- Asignacion inicial de cursos y materias.

Usuarios demo:

```text
admin@aulaclara.test / Admin123!
docente@aulaclara.test / Docente123!
```

## Backup automatico

La base SQLite esta en:

```text
.data/aula-clara.sqlite
```

Los backups quedan en:

```text
.data/backups/
```

Frecuencia configurable:

```sh
BACKUP_INTERVAL_HOURS=24 npm run dev
```

Tambien se puede crear backup manual desde `/admin/usuarios`.

Restauracion:

- Disponible en `/admin/usuarios`.
- Antes de restaurar, el sistema genera un backup `pre-restore`.
- La restauracion reemplaza tablas principales desde el archivo seleccionado.

## Formato institucional

Se agrego:

- Encabezado con institucion.
- Datos del usuario logueado.
- Navegacion con acceso admin solo para admin.
- Estilos consistentes para formularios, tablas, botones y paneles.
- Estilos de impresion para reportes limpios.

Lineamiento visual:

- Tipografia: system UI moderna, legible y sobria.
- Paleta: verde institucional, superficies neutras y estados semaforizados.
- Bordes: 8px maximo para tarjetas/paneles, mas propio de sistema operativo que de landing page.
- Tablas: encabezados compactos, alto contraste, informacion escaneable.

## Filtro de materia en notas

Ruta:

```text
/notas
```

El selector permite:

- Todas las materias.
- Matematica.
- Literatura.
- Programacion.
- Materias nuevas activas.

La tabla recalcula:

- Notas visibles.
- Promedio.
- Asistencia.
- Estado: Riesgo, Atencion o Correcto.

## Mejoras criticas para produccion

1. Migraciones formales: usar Drizzle, Prisma o Knex antes de crecer el esquema.
2. Auditoria: guardar quien edito/eliminó alumno, nota o asistencia.
3. Paginacion: con muchos alumnos, evitar renderizar todo junto.
4. Busqueda: agregar busqueda por nombre/DNI en alumnos y notas.
5. Multi-docente: mostrar conflictos cuando dos docentes editan el mismo registro sensible.
6. Backups externos: copiar `.data/backups` a Drive/S3/NAS institucional.
7. Retencion: mantener backups diarios 30 dias, semanales 6 meses, mensuales 2 anos.
8. Recuperacion probada: no basta crear backups; probar restauracion cada cierto tiempo.
9. Politica de contrasenas: obligar cambio de contrasena temporal al primer login.
10. Permisos finos: separar admin tecnico, preceptor, docente y directivo.
11. Rendimiento offline: mover datos grandes a IndexedDB tambien para alumnos/notas, no solo cola.
12. Seguridad HTTP: usar HTTPS obligatorio en produccion para cookies `Secure`.
13. CSRF: Astro ya bloquea POST cross-site por defecto; mantener formularios same-origin.
14. Observabilidad: logs de sync fallido, backup fallido y login fallido.
15. Exportes: incluir membrete institucional y periodo en cada hoja Excel.

## Validacion

```sh
npx tsc --noEmit
npm run build
```
