# Arquitectura propuesta

## Estructura

```text
src/
  components/        Componentes reutilizables de UI
  layouts/           Layout base y navegacion comun
  pages/             Rutas Astro: panel, alumnos, asistencia, notas, cursos
  scripts/           JavaScript de interaccion del navegador
  styles/            CSS global importado desde el layout
  db/schema.sql      Modelo relacional para SQLite/MySQL
```

Astro genera rutas desde `src/pages`. Los componentes no deben incluir `html`, `head` ni `body`; esas etiquetas pertenecen al layout. Esa mezcla era la causa principal del problema visual anterior.

## CSS en Astro

Astro encapsula los estilos escritos dentro de un componente. Eso es bueno para componentes aislados, pero puede confundir cuando se espera que una clase afecte toda la app. Para estilos de sistema conviene:

- Importar `src/styles/global.css` desde `src/layouts/Layout.astro`.
- Usar estilos locales solo para componentes muy especificos.
- Evitar componentes con documentos HTML completos dentro de paginas.
- Evitar rutas manuales a CSS desde HTML; importar CSS desde el frontmatter o el layout.

## Backend con Astro

Para endpoints reales, instala el adaptador Node y el driver SQLite:

```sh
npm install @astrojs/node better-sqlite3
```

Luego configura `astro.config.mjs` con `output: 'server'` y el adapter de Node. Un endpoint tipico quedaria en `src/pages/api/alumnos.ts`:

```ts
import type { APIRoute } from 'astro';
import { db } from '../../server/db';

export const GET: APIRoute = () => {
  const alumnos = db.prepare(`
    SELECT alumnos.*, cursos.nombre AS curso
    FROM alumnos
    JOIN cursos ON cursos.id = alumnos.curso_id
    WHERE alumnos.activo = 1
  `).all();

  return Response.json(alumnos);
};
```

La capa `server/db.ts` deberia abrir SQLite en desarrollo y exponer consultas preparadas. Para MySQL, conserva servicios por entidad (`alumnos.service.ts`, `notas.service.ts`) y cambia solo el adaptador de base de datos.

## Decisiones tecnicas

- La version actual usa `localStorage` para funcionar inmediatamente sin instalar dependencias extra.
- El modelo de datos esta separado en `src/db/schema.sql` para migrar a SQLite.
- Las notas usan promedio ponderado por `peso`.
- La asistencia usa clave unica por alumno, materia y fecha para evitar duplicados.
- La UI prioriza tablas escaneables, filtros visibles y acciones directas para docentes.

## Ejecucion local

```sh
npm install
npm run dev
```

Abre `http://localhost:4321`.

## Mejoras futuras

- Login con roles `admin` y `docente`.
- Exportacion PDF/Excel de asistencia y boletines.
- Importacion masiva de alumnos desde CSV.
- Auditoria de cambios por usuario.
- Deploy con adaptador Node en VPS, Render, Railway o servidor escolar.
- Migraciones con Drizzle, Prisma o Knex cuando el modelo crezca.
