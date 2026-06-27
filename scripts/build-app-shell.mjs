import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '..');
const pagesDir = path.join(base, 'src/pages');

const views = [
  { file: 'index.astro', view: 'panel', title: 'Panel docente', hidden: false, extraAttrs: '' },
  { file: 'registro.astro', view: 'registro', title: 'Registro de alumnos', hidden: true, extraAttrs: '' },
  { file: 'cursos.astro', view: 'cursos', title: 'Cursos', hidden: true, extraAttrs: ' data-courses' },
  { file: 'asistencia.astro', view: 'asistencia', title: 'Asistencia', hidden: true, extraAttrs: ' data-attendance' },
  { file: 'notas.astro', view: 'notas', title: 'Calificaciones', hidden: true, extraAttrs: ' data-grades' },
];

function spaLink(html) {
  const spaRoutes = ['asistencia', 'notas', 'actividades', 'registro', 'cursos'];
  let out = html;
  for (const route of spaRoutes) {
    const re = new RegExp(`<a([^>]*?)href="/${route}"([^>]*)>`, 'g');
    out = out.replace(re, `<button type="button" data-spa-nav="${route}"$1$2>`);
  }
  return out.replace(/<button type="button" data-spa-nav="([^"]+)"([^>]*)>([\s\S]*?)<\/button>/g, (match, view, attrs, text) => {
    if (attrs.includes('href=')) return match;
    return `<button type="button" data-spa-nav="${view}"${attrs}>${text}</button>`;
  });
}

function extractMain(file) {
  const src = fs.readFileSync(path.join(pagesDir, file), 'utf8');
  const match = src.match(/<main[^>]*>([\s\S]*)<\/main>/);
  if (!match) throw new Error(`No main in ${file}`);
  return spaLink(match[1]).trim();
}

const sections = views.map((v) => {
  const hidden = v.hidden ? ' spa-view--hidden' : '';
  const content = extractMain(v.file);
  return `  <section class="spa-view page page-stack${hidden}" data-spa-view="${v.view}" data-spa-title="${v.title}"${v.extraAttrs}>\n${content}\n  </section>`;
}).join('\n\n');

const actSrc = fs.readFileSync(path.join(pagesDir, 'actividades.astro'), 'utf8');
const actMatch = actSrc.match(/<main[^>]*>([\s\S]*)<\/main>/);
if (!actMatch) throw new Error('No main in actividades.astro');
const actHtml = spaLink(actMatch[1]).trim();

const actSection = `  <section class="spa-view page page-stack spa-view--hidden" data-spa-view="actividades" data-spa-title="Actividades" data-activities data-calendar>\n${actHtml}\n  </section>`;

const frontmatter = `---
import { ACTIVITY_AI_LIMITS, activityLimitsSummaryLines, formatActivityChars } from '../../lib/activity-ai-limits';
import { TRABAJO_UPLOAD_LIMITS } from '../../lib/trabajo-upload-limits';

interface Props {
  initialView?: string;
}

const { initialView = 'panel' } = Astro.props;
const limitsLines = activityLimitsSummaryLines();
---`;

const out = `${frontmatter}\n\n<div id="spa-root" data-spa-root data-initial-view={initialView}>\n${sections}\n\n${actSection}\n</div>\n`;
const outPath = path.join(base, 'src/components/spa/AppShell.astro');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
console.log('AppShell written:', out.length, 'chars');
