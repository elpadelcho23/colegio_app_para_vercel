#!/usr/bin/env node
/**
 * Verifica que las guías del product tour tengan IDs en el menú
 * y que los selectores clave existan en el markup de src/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tourFile = fs.readFileSync(path.join(root, 'src/scripts/product-tour.js'), 'utf8');
const navFile = fs.readFileSync(path.join(root, 'src/components/Navigation.astro'), 'utf8');

function extractObjectBlock(source, name) {
  const start = source.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Bloque incompleto: ${name}`);
}

function extractGuideIds(block) {
  const ids = [];
  const re = /^\s{2}([a-z0-9-]+):\s*\{/gm;
  let match;
  while ((match = re.exec(block))) ids.push(match[1]);
  return ids;
}

function extractSelectors(block) {
  const selectors = [];
  const re = /(target|preferTarget|requireClick):\s*'([^']+)'/g;
  let match;
  while ((match = re.exec(block))) {
    match[2].split(',').forEach((part) => {
      const trimmed = part.trim();
      if (trimmed) selectors.push(trimmed);
    });
  }
  return [...new Set(selectors)];
}

/** Extrae tokens verificables de un selector CSS simple. */
function tokensFromSelector(selector) {
  const tokens = [];
  const attrRe = /\[([^\]]+)\]/g;
  let match;
  while ((match = attrRe.exec(selector))) {
    const raw = match[1].trim();
    const name = raw.split('=')[0].trim();
    tokens.push({ kind: 'attr', needle: name.includes('data-') || name.includes('aria-') ? `[${name}` : `[${raw}` });
  }
  const classRe = /\.([a-zA-Z0-9_-]+)/g;
  while ((match = classRe.exec(selector))) {
    tokens.push({ kind: 'class', needle: `class="${match[1]}"|class='${match[1]}'|class=.*\b${match[1]}\b|\.${match[1]}` });
  }
  return tokens;
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (/\.(astro|html|js|ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const srcFiles = walkFiles(path.join(root, 'src'));
const corpus = srcFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const basicBlock = extractObjectBlock(tourFile, 'BASIC_TOUR');
const topicsBlock = extractObjectBlock(tourFile, 'TOPIC_GUIDES');
const topicIds = extractGuideIds(topicsBlock);
const menuIds = [...navFile.matchAll(/data-tour-start="([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'basico');

const errors = [];
const warnings = [];

for (const id of topicIds) {
  if (!menuIds.includes(id)) errors.push(`Guía "${id}" no tiene botón en el menú de ayuda`);
}
for (const id of menuIds) {
  if (!topicIds.includes(id)) errors.push(`Menú tiene data-tour-start="${id}" sin guía definida`);
}

const allSelectors = [
  ...extractSelectors(basicBlock),
  ...extractSelectors(topicsBlock),
];

for (const selector of allSelectors) {
  const tokens = tokensFromSelector(selector);
  if (!tokens.length) {
    warnings.push(`Selector sin tokens verificables: ${selector}`);
    continue;
  }
  for (const token of tokens) {
    if (token.kind === 'attr') {
      if (!corpus.includes(token.needle) && !corpus.includes(token.needle.replace('[', ''))) {
        // data-foo must appear as data-foo in markup
        const attrName = token.needle.replace(/^\[/, '').replace(/\]$/, '');
        const bare = attrName.split('=')[0];
        if (!corpus.includes(bare)) {
          errors.push(`Atributo ausente en src/ para selector "${selector}": ${bare}`);
        }
      }
    }
    if (token.kind === 'class') {
      const className = token.needle.match(/\.([a-zA-Z0-9_-]+)$/)?.[1]
        || selector.match(/\.([a-zA-Z0-9_-]+)/)?.[1];
      // Prefer simple search for class name usage
      const cls = selector.match(/\.([a-zA-Z0-9_-]+)/g)?.map((c) => c.slice(1)) || [];
      for (const c of cls) {
        const found =
          corpus.includes(`class="${c}`)
          || corpus.includes(`class='${c}`)
          || corpus.includes(` ${c}`)
          || corpus.includes(`.${c}`)
          || corpus.includes(`'${c}'`)
          || corpus.includes(`"${c}"`);
        if (!found) errors.push(`Clase ausente en src/ para selector "${selector}": .${c}`);
      }
    }
  }
}

// Views referenced by steps
const views = [...tourFile.matchAll(/view:\s*'([a-z]+)'/g)].map((m) => m[1]);
const uniqueViews = [...new Set(views)];
for (const view of uniqueViews) {
  if (!corpus.includes(`data-spa-view="${view}"`) && view !== 'panel') {
    // panel also has data-spa-view="panel"
    if (!corpus.includes(`data-spa-view="${view}"`)) {
      errors.push(`Vista SPA ausente: data-spa-view="${view}"`);
    }
  }
  if (!corpus.includes(`data-spa-view="${view}"`)) {
    errors.push(`Vista SPA ausente: data-spa-view="${view}"`);
  }
}

console.log('Guías temáticas:', topicIds.join(', '));
console.log('Botones menú:', menuIds.join(', '));
console.log('Vistas usadas:', uniqueViews.join(', '));
console.log(`Selectores verificados: ${allSelectors.length}`);

if (warnings.length) {
  console.log('\nAvisos:');
  warnings.forEach((w) => console.log(`- ${w}`));
}

if (errors.length) {
  console.error('\nErrores:');
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}

console.log('\nOK: guías y selectores coherentes con el markup.');
