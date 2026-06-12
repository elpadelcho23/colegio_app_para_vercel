import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dbPath } from './db';

const uploadsRoot = join(dirname(dbPath), 'uploads');

function safeFilename(name: string) {
  return basename(String(name || 'archivo'))
    .replace(/[^\w.\-()áéíóúñÁÉÍÓÚÑ ]+/g, '_')
    .slice(0, 120) || 'archivo';
}

export function getUploadsRoot() {
  mkdirSync(uploadsRoot, { recursive: true });
  return uploadsRoot;
}

export async function saveTrabajoFileAsync(options: {
  tenantId: string;
  entregaId: string;
  file: File;
}) {
  const { tenantId, entregaId, file } = options;
  const filename = safeFilename(file.name);
  const fileId = `arch-${randomUUID()}`;
  const relativePath = join(tenantId, entregaId, `${fileId}-${filename}`);
  const absolutePath = join(getUploadsRoot(), relativePath);

  mkdirSync(dirname(absolutePath), { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(absolutePath, buffer);

  return {
    id: fileId,
    filename,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    storagePath: relativePath.replace(/\\/g, '/'),
    absolutePath,
  };
}

export function readTrabajoFile(storagePath: string) {
  const absolutePath = join(getUploadsRoot(), storagePath);
  if (!existsSync(absolutePath)) return null;
  return readFileSync(absolutePath);
}

export function copyTrabajoFile(storagePath: string, tenantId: string, entregaId: string) {
  const source = join(getUploadsRoot(), storagePath);
  if (!existsSync(source)) return null;

  const originalName = basename(storagePath).replace(/^arch-[^-]+-/, '');
  const fileId = `arch-${randomUUID()}`;
  const relativePath = join(tenantId, entregaId, `${fileId}-${originalName}`);
  const target = join(getUploadsRoot(), relativePath);

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);

  return {
    id: fileId,
    filename: originalName,
    storagePath: relativePath.replace(/\\/g, '/'),
  };
}
