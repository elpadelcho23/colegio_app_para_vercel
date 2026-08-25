import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKER_SPECS = [
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  'pdfjs-dist/build/pdf.worker.mjs',
];

function toFileUrl(path: string) {
  return pathToFileURL(path).href;
}

function resolveFromRequire() {
  const require = createRequire(import.meta.url);
  for (const spec of WORKER_SPECS) {
    try {
      return toFileUrl(require.resolve(spec));
    } catch {
      // seguir buscando
    }
  }
  return '';
}

function resolveFromDisk() {
  const bases = new Set<string>([process.cwd()]);
  try {
    bases.add(dirname(fileURLToPath(import.meta.url)));
  } catch {
    // import.meta.url puede no ser un path de archivo en algún bundle.
  }

  for (const base of bases) {
    let dir = base;
    for (let i = 0; i < 6; i += 1) {
      for (const spec of WORKER_SPECS) {
        const full = join(dir, 'node_modules', spec);
        if (existsSync(full)) return toFileUrl(full);
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return '';
}

export function resolvePdfWorkerSrc() {
  return resolveFromRequire() || resolveFromDisk();
}

export function configurePdfJsWorker(pdfjs: {
  GlobalWorkerOptions?: { workerSrc?: string };
}) {
  const src = resolvePdfWorkerSrc();
  if (src && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = src;
  }
  return src;
}
