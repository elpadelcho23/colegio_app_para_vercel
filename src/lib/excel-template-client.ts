/** Utilidades cliente para plantillas Excel reutilizables (mapeo por índice o por nombre de columna). */

export type ExcelTemplateRecord = {
  id: string;
  name: string;
  headerRow: number;
  columns: Record<string, number | null>;
  columnLabels?: string[];
  columnNames?: Record<string, string>;
  updatedAt?: string;
};

export type MappableField = {
  field: string;
  label: string;
  required?: boolean;
  hint?: string;
};

export function normalizeExcelHeaderLabel(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function findColumnIndexByHeaderName(headers: string[], columnName: string) {
  const target = normalizeExcelHeaderLabel(columnName);
  if (!target) return null;
  const index = headers.findIndex((header) => normalizeExcelHeaderLabel(header) === target);
  return index >= 0 ? index : null;
}

/** Resuelve índices de columna desde nombres guardados en la plantilla. */
export function resolveTemplateColumns(
  template: Pick<ExcelTemplateRecord, 'columns' | 'columnNames'>,
  detectedHeaders: string[],
) {
  const resolved: Record<string, number | null> = { ...(template.columns || {}) };

  if (template.columnNames && detectedHeaders.length) {
    Object.entries(template.columnNames).forEach(([field, columnName]) => {
      const index = findColumnIndexByHeaderName(detectedHeaders, columnName);
      if (index != null) resolved[field] = index;
    });
  }

  return resolved;
}

export function buildMappingFromTemplate(
  template: ExcelTemplateRecord,
  detectedHeaders: string[],
) {
  return {
    headerRow: template.headerRow || 1,
    columns: resolveTemplateColumns(template, detectedHeaders),
  };
}

export function extractColumnNamesFromMapping(
  columns: Record<string, number | null | undefined>,
  detectedHeaders: string[],
) {
  const columnNames: Record<string, string> = {};
  Object.entries(columns).forEach(([field, index]) => {
    if (index == null || index === '') return;
    const label = detectedHeaders[Number(index)];
    if (label) columnNames[field] = String(label).trim();
  });
  return columnNames;
}

export function scoreExcelTemplateMatch(template: ExcelTemplateRecord, headers: string[]) {
  const names = Object.values(template.columnNames || {}).filter(Boolean);
  const labels = template.columnLabels || [];
  const tokens = names.length ? names : labels;
  if (!tokens.length || !headers.length) return 0;

  let hits = 0;
  tokens.forEach((label) => {
    const normalized = normalizeExcelHeaderLabel(label);
    if (!normalized) return;
    if (headers.some((header) => normalizeExcelHeaderLabel(header) === normalized)) hits += 1;
  });
  return hits / Math.max(tokens.length, headers.length);
}

export function findBestExcelTemplate(templates: ExcelTemplateRecord[], headers: string[]) {
  let best: ExcelTemplateRecord | null = null;
  let bestScore = 0;
  templates.forEach((template) => {
    const score = scoreExcelTemplateMatch(template, headers);
    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  });
  return bestScore >= 0.45 ? best : null;
}

export function validateMappingClient(
  importType: 'alumnos' | 'asistencias',
  mapping: { columns?: Record<string, number | null> },
  fields: MappableField[],
) {
  const errors: string[] = [];
  const columns = mapping?.columns || {};

  fields.filter((field) => field.required).forEach((field) => {
    if (columns[field.field] == null || columns[field.field] === '') {
      errors.push(`Asigná la columna de ${field.label}.`);
    }
  });

  if (importType === 'alumnos') {
    if ((columns.nombre == null || columns.nombre === '') && (columns.apellido == null || columns.apellido === '')) {
      errors.push('Asigná al menos Nombre o Apellido.');
    }
  }

  return errors;
}

export function computeMappingProgress(
  importType: 'alumnos' | 'asistencias',
  mapping: { columns?: Record<string, number | null> },
  fields: MappableField[],
) {
  const columns = mapping?.columns || {};
  const requiredFields = fields.filter((field) => field.required);
  let requiredDone = 0;
  requiredFields.forEach((field) => {
    if (columns[field.field] != null && columns[field.field] !== '') requiredDone += 1;
  });

  if (importType === 'alumnos') {
    const hasName = columns.nombre != null && columns.nombre !== '';
    const hasLast = columns.apellido != null && columns.apellido !== '';
    if (hasName || hasLast) requiredDone += 1;
    return {
      requiredTotal: requiredFields.length + 1,
      requiredDone: requiredDone,
      optionalDone: fields.filter((field) => !field.required && columns[field.field] != null && columns[field.field] !== '').length,
      optionalTotal: fields.filter((field) => !field.required).length,
      complete: requiredDone >= requiredFields.length + 1,
    };
  }

  return {
    requiredTotal: requiredFields.length,
    requiredDone,
    optionalDone: fields.filter((field) => !field.required && columns[field.field] != null && columns[field.field] !== '').length,
    optionalTotal: fields.filter((field) => !field.required).length,
    complete: requiredDone >= requiredFields.length,
  };
}

export function suggestTemplateName(fileName = '', importType: 'alumnos' | 'asistencias' = 'alumnos') {
  const base = String(fileName).replace(/\.(xlsx|xls)$/i, '').trim();
  if (base) return `Planilla ${base}`;
  return importType === 'alumnos' ? 'Plantilla alumnos' : 'Plantilla asistencias';
}
