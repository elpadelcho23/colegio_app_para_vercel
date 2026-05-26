# Aula Clara - Gestion Escolar Astro

Aplicacion web para docentes construida con Astro. Incluye registro de alumnos, toma de asistencia, carga de notas, calculo automatico de promedios y seguimiento de rendimiento.

## Estructura

```text
src/
  components/
  db/schema.sql
  layouts/Layout.astro
  pages/
  scripts/school-app.js
  styles/global.css
docs/arquitectura.md
```

## Comandos

| Comando | Accion |
| :-- | :-- |
| `npm install` | Instala dependencias |
| `npm run dev` | Inicia el servidor local en `localhost:4321` |
| `npm run build` | Genera la version de produccion |
| `npm run preview` | Previsualiza el build |

## Base de datos

El esquema relacional esta en `src/db/schema.sql`. La version actual funciona en navegador con `localStorage` para facilitar pruebas inmediatas. Para backend real con SQLite, ver `docs/arquitectura.md`.
