import { createId } from './offline-db.ts';
import {
  buildMappingFromTemplate,
  computeMappingProgress,
  extractColumnNamesFromMapping,
  findBestExcelTemplate,
  resolveTemplateColumns,
  suggestTemplateName,
  validateMappingClient,
} from '../lib/excel-template-client.ts';

const TEMPLATE_STORE_KEY = 'aula_clara_excel_templates';
const LEGACY_STUDENT_TEMPLATES_KEY = 'aula_clara_student_excel_mappings';

const MAPPABLE_FIELDS = {
  alumnos: [
    { field: 'escuela', label: 'Escuela', required: true, aliases: ['colegio', 'institucion', 'escuela'] },
    { field: 'curso', label: 'Curso', required: true, aliases: ['curso', 'division', 'ano', 'grado'] },
    { field: 'turno', label: 'Turno', required: true, aliases: ['turno', 'jornada'] },
    { field: 'apellido', label: 'Apellido', required: false, hint: 'Opcional si ya tenés Nombre completo', aliases: ['apellido', 'apellidos'] },
    { field: 'nombre', label: 'Nombre', required: false, hint: 'Obligatorio si no usás Apellido', aliases: ['nombre', 'nombres', 'alumno', 'estudiante'] },
    { field: 'dni', label: 'DNI', required: false, aliases: ['dni', 'documento', 'legajo'] },
    { field: 'tutor', label: 'Tutor / contacto', required: false, aliases: ['tutor', 'contacto', 'responsable'] },
    { field: 'materias', label: 'Materias', required: false, aliases: ['materias', 'materia', 'asignaturas'] },
  ],
  asistencias: [
    { field: 'fecha', label: 'Fecha', required: true, hint: 'AAAA-MM-DD o fecha de Excel', aliases: ['fecha', 'dia'] },
    { field: 'escuela', label: 'Escuela / Colegio', required: true, aliases: ['escuela', 'colegio', 'institucion'] },
    { field: 'curso', label: 'Curso', required: true, aliases: ['curso', 'division', 'ano'] },
    { field: 'turno', label: 'Turno', required: true, aliases: ['turno', 'jornada'] },
    { field: 'materia', label: 'Materia', required: true, aliases: ['materia', 'asignatura'] },
    { field: 'nombre', label: 'Alumno', required: true, aliases: ['alumno', 'nombre', 'estudiante'] },
    { field: 'estado', label: 'Estado', required: true, hint: 'Presente, Ausente, P o A', aliases: ['estado', 'asistencia', 'presentismo'] },
  ],
};

function currentUserId() {
  return window.__AULA_CLARA_USER__?.id || null;
}

function storageKey(key) {
  const userId = currentUserId();
  return userId ? `${key}:${userId}` : key;
}

function readTemplateStore() {
  try {
    const raw = localStorage.getItem(storageKey(TEMPLATE_STORE_KEY));
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }

  const legacy = localStorage.getItem(storageKey(LEGACY_STUDENT_TEMPLATES_KEY));
  if (legacy) {
    try {
      const migrated = { alumnos: JSON.parse(legacy), asistencias: [] };
      localStorage.setItem(storageKey(TEMPLATE_STORE_KEY), JSON.stringify(migrated));
      return migrated;
    } catch {
      /* ignore */
    }
  }

  return { alumnos: [], asistencias: [] };
}

function writeTemplateStore(store) {
  localStorage.setItem(storageKey(TEMPLATE_STORE_KEY), JSON.stringify(store));
}

function readTemplates(importType) {
  const store = readTemplateStore();
  return Array.isArray(store[importType]) ? store[importType] : [];
}

function writeTemplates(importType, templates) {
  const store = readTemplateStore();
  store[importType] = templates;
  writeTemplateStore(store);
}

function debounce(fn, ms = 450) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function validateExcelFile(input, feedbackEl, maxFileMb) {
  const file = input?.files?.[0];
  if (!file) return { ok: false, error: 'Seleccioná un archivo Excel (.xlsx).' };
  const maxBytes = (maxFileMb || 8) * 1024 * 1024;
  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return { ok: false, error: 'El archivo debe ser .xlsx o .xls.' };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: `El archivo supera ${maxFileMb || 8} MB.` };
  }
  if (feedbackEl) {
    feedbackEl.classList.remove('is-hidden', 'is-warning');
    feedbackEl.classList.add('is-ok');
    feedbackEl.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
  }
  return { ok: true, file };
}

function renderImportResult(el, result, isError) {
  if (!el) return;
  el.hidden = false;
  el.className = `import-result ${isError ? 'import-result-error' : 'import-result-ok'}`;
  if (isError) {
    el.textContent = result.error || result.errors?.[0]?.message || 'No se pudo importar.';
    return;
  }
  el.textContent = result.message || `Importación completada: ${result.imported || 0} nuevos, ${result.updated || 0} actualizados.`;
}

function setWorkspaceStep(workspace, step) {
  const order = ['template', 'file', 'mapping', 'confirm'];
  const currentIndex = order.indexOf(step);
  workspace.querySelectorAll('[data-excel-step]').forEach((item) => {
    const itemStep = item.getAttribute('data-excel-step');
    const itemIndex = order.indexOf(itemStep || '');
    item.classList.toggle('is-active', itemStep === step);
    item.classList.toggle('is-done', itemIndex >= 0 && itemIndex < currentIndex);
  });
}

function initExcelImportWorkspace(workspace, options = {}) {
  const importType = workspace.dataset.importType;
  if (!importType || !MAPPABLE_FIELDS[importType]) return;

  const maxFileMb = Number(workspace.dataset.maxFileMb || 8);
  const fields = MAPPABLE_FIELDS[importType];

  const form = workspace.querySelector('[data-excel-workspace-form]');
  const fileInput = workspace.querySelector('[data-excel-file]');
  const dropzone = workspace.querySelector('[data-excel-dropzone]');
  const dropzoneLabel = workspace.querySelector('[data-excel-dropzone-label]');
  const feedbackEl = workspace.querySelector('[data-excel-feedback]');
  const previewEl = workspace.querySelector('[data-excel-preview]');
  const previewPanel = workspace.querySelector('[data-excel-preview-panel]');
  const previewTable = workspace.querySelector('[data-excel-preview-table]');
  const resultEl = workspace.querySelector('[data-excel-result]');
  const submitBtn = workspace.querySelector('[data-excel-submit]');
  const mappingPanel = workspace.querySelector('[data-excel-mapping-panel]');
  const mappingFields = workspace.querySelector('[data-excel-mapping-fields]');
  const mappingProgress = workspace.querySelector('[data-excel-mapping-progress]');
  const mappingProgressText = workspace.querySelector('[data-excel-mapping-progress-text]');
  const mappingProgressFill = workspace.querySelector('[data-excel-mapping-progress-fill]');
  const detectedHeadersWrap = workspace.querySelector('[data-excel-detected-headers]');
  const headerChips = workspace.querySelector('[data-excel-header-chips]');
  const headerRowInput = workspace.querySelector('[data-excel-header-row]');
  const sheetNameInput = workspace.querySelector('[data-excel-sheet-name]');
  const templateNameInput = workspace.querySelector('[data-excel-template-name]');
  const templateSaveBtn = workspace.querySelector('[data-excel-template-save]');
  const templateDeleteBtn = workspace.querySelector('[data-excel-template-delete]');
  const templateEditBtn = workspace.querySelector('[data-excel-template-edit]');
  const templateDuplicateBtn = workspace.querySelector('[data-excel-template-duplicate]');
  const templateNewBtn = workspace.querySelector('[data-excel-template-new]');
  const templateCards = workspace.querySelector('[data-excel-template-cards]');
  const templateEmpty = workspace.querySelector('[data-excel-template-empty]');
  const saveCta = workspace.querySelector('[data-excel-save-cta]');
  const toastEl = workspace.querySelector('[data-excel-toast]');
  const builderPanel = workspace.querySelector('[data-excel-template-builder]');
  const builderFields = workspace.querySelector('[data-excel-builder-fields]');
  const builderNameInput = workspace.querySelector('[data-excel-builder-name]');
  const builderHeaderRowInput = workspace.querySelector('[data-excel-builder-header-row]');
  const builderSaveBtn = workspace.querySelector('[data-excel-builder-save]');
  const builderCancelBtn = workspace.querySelector('[data-excel-builder-cancel]');

  let currentPreview = null;
  let appliedTemplateName = '';
  let selectedTemplateId = '';
  let editingTemplateId = '';
  let previewRequestId = 0;
  let toastTimer = null;

  const showToast = (message, type = 'ok') => {
    if (!toastEl) return;
    toastEl.hidden = false;
    toastEl.classList.remove('is-hidden', 'is-ok', 'is-warning', 'is-error');
    toastEl.classList.add(type === 'error' ? 'is-error' : type === 'warning' ? 'is-warning' : 'is-ok');
    toastEl.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.add('is-hidden');
    }, 3200);
  };

  const templateProgressLabel = (template) => {
    const names = template.columnNames || {};
    const mapped = fields.filter((field) => {
      if (field.required && names[field.field]) return true;
      if (!field.required && names[field.field]) return false;
      return false;
    }).length;
    const requiredNames = fields.filter((field) => field.required).filter((field) => names[field.field]).length;
    const optionalNames = fields.filter((field) => !field.required && names[field.field]).length;
    const totalRequired = importType === 'alumnos'
      ? fields.filter((field) => field.required).length + 1
      : fields.filter((field) => field.required).length;
    const hasNamePair = importType === 'alumnos'
      && (names.nombre || names.apellido);
    const done = importType === 'alumnos'
      ? requiredNames + (hasNamePair ? 1 : 0)
      : requiredNames;
    return `${done}/${totalRequired} obligatorios${optionalNames ? ` · ${optionalNames} opc.` : ''}`;
  };

  const renderTemplateCards = () => {
    const templates = readTemplates(importType);
    if (!templateCards) return;

    templateCards.querySelectorAll('.excel-template-card').forEach((node) => node.remove());
    templateEmpty?.classList.toggle('is-hidden', templates.length > 0);

    templates.forEach((template) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `excel-template-card${template.id === selectedTemplateId ? ' is-selected' : ''}`;
      card.dataset.templateId = template.id;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', template.id === selectedTemplateId ? 'true' : 'false');

      const columnPreview = Object.values(template.columnNames || {})
        .filter(Boolean)
        .slice(0, 3)
        .join(' · ') || (template.columnLabels || []).filter(Boolean).slice(0, 3).join(' · ') || 'Sin columnas definidas';

      card.innerHTML = `
        <strong>${escapeHtml(template.name)}</strong>
        <span class="excel-template-badge">${templateProgressLabel(template)}</span>
        <small>Fila ${template.headerRow || 1} · ${escapeHtml(columnPreview)}</small>
      `;

      card.addEventListener('click', () => {
        selectTemplate(template.id);
      });
      templateCards.appendChild(card);
    });
  };

  const selectTemplate = async (templateId) => {
    const template = readTemplates(importType).find((item) => item.id === templateId);
    if (!template) return;

    selectedTemplateId = template.id;
    if (templateNameInput) templateNameInput.value = template.name;
    if (headerRowInput) headerRowInput.value = String(template.headerRow || 1);
    renderTemplateCards();

    const check = validateExcelFile(fileInput, feedbackEl, maxFileMb);
    if (check.ok) {
      const mapping = buildMappingFromTemplate(template, currentPreview?.detectedHeaders || []);
      await previewExcelFile(check.file, mapping, template.name);
    } else {
      showToast(`Plantilla "${template.name}" seleccionada. Subí un Excel para importar.`, 'ok');
      openBuilder(template.id);
    }
  };

  const renderBuilderFields = (template = null) => {
    if (!builderFields) return;
    const columnNames = template?.columnNames || {};
    builderFields.innerHTML = fields.map((field) => {
      const tag = field.required ? 'obligatorio' : 'opcional';
      const hint = field.hint ? `<small>${field.hint}</small>` : '';
      const aliases = (field.aliases || []).slice(0, 3).join(', ');
      const value = columnNames[field.field] || '';
      return `
        <label class="excel-builder-field">
          <span>${field.label} <span class="excel-ref-tag">${tag}</span></span>
          <input
            type="text"
            data-excel-builder-field="${field.field}"
            value="${escapeHtml(value)}"
            placeholder="Ej: ${aliases || field.label}"
            aria-label="Columna Excel para ${field.label}"
          />
          ${hint}
        </label>
      `;
    }).join('');
  };

  const openBuilder = (templateId = '') => {
    editingTemplateId = templateId;
    const template = templateId
      ? readTemplates(importType).find((item) => item.id === templateId)
      : null;

    if (builderNameInput) builderNameInput.value = template?.name || '';
    if (builderHeaderRowInput) builderHeaderRowInput.value = String(template?.headerRow || headerRowInput?.value || 1);
    renderBuilderFields(template);
    builderPanel?.classList.remove('is-hidden');
    builderPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const closeBuilder = () => {
    editingTemplateId = '';
    builderPanel?.classList.add('is-hidden');
  };

  const collectBuilderTemplate = () => {
    const name = String(builderNameInput?.value || '').trim();
    const headerRow = Math.max(1, Number(builderHeaderRowInput?.value || 1));
    const columnNames = {};
    builderFields?.querySelectorAll('[data-excel-builder-field]').forEach((input) => {
      const field = input.getAttribute('data-excel-builder-field');
      const value = String(input.value || '').trim();
      if (field && value) columnNames[field] = value;
    });
    return { name, headerRow, columnNames };
  };

  const saveTemplateRecord = (template, message) => {
    const templates = readTemplates(importType);
    const existingByName = templates.find((item) => item.name.toLowerCase() === template.name.toLowerCase() && item.id !== template.id);
    if (existingByName) {
      if (!window.confirm(`Ya existe "${existingByName.name}". ¿Reemplazarla?`)) return false;
      writeTemplates(importType, templates.filter((item) => item.id !== existingByName.id));
    }

    const current = readTemplates(importType);
    const existing = current.find((item) => item.id === template.id);
    const next = existing
      ? current.map((item) => (item.id === template.id ? template : item))
      : [...current, template];

    writeTemplates(importType, next);
    selectedTemplateId = template.id;
    if (templateNameInput) templateNameInput.value = template.name;
    renderTemplateCards();
    showToast(message || `Plantilla "${template.name}" guardada.`);
    return true;
  };

  const renderMappingTable = (preview) => {
    if (!mappingFields) return;
    const columns = preview?.availableColumns || [];
    const mapping = preview?.mapping?.columns || collectMapping().columns;
    const mappableFields = preview?.mappableFields || fields;

    mappingFields.innerHTML = `
      <div class="excel-mapping-table-head">
        <span>Dato del sistema</span>
        <span>Columna en tu Excel</span>
        <span>Estado</span>
      </div>
    ` + mappableFields.map((field) => {
      const options = ['<option value="">— Sin asignar —</option>'];
      columns.forEach((column) => {
        const selected = Number(mapping[field.field]) === column.index ? ' selected' : '';
        const label = column.label || `Columna ${column.index + 1}`;
        options.push(`<option value="${column.index}"${selected}>${escapeHtml(label)}</option>`);
      });
      const mapped = mapping[field.field] != null && mapping[field.field] !== '';
      const tag = field.required ? 'obligatorio' : 'opcional';
      const status = mapped ? '✓ Conectado' : (field.required ? 'Falta' : '—');
      const statusClass = mapped ? 'is-mapped' : (field.required ? 'is-missing' : 'is-optional');
      return `
        <div class="excel-mapping-row ${statusClass}" data-excel-map-row="${field.field}">
          <div class="excel-mapping-row-label">
            <strong>${field.label}</strong>
            <span class="excel-ref-tag">${tag}</span>
            ${field.hint ? `<small>${field.hint}</small>` : ''}
          </div>
          <select data-excel-map-field="${field.field}" aria-label="Columna para ${field.label}">
            ${options.join('')}
          </select>
          <span class="excel-mapping-status">${status}</span>
        </div>
      `;
    }).join('');

    mappingFields.querySelectorAll('[data-excel-map-field]').forEach((select) => {
      select.addEventListener('change', () => {
        updateMappingProgress();
        debouncedPreviewRefresh();
      });
    });
  };

  const renderDetectedHeaders = (preview) => {
    const headers = preview?.detectedHeaders || [];
    if (!headerChips || !detectedHeadersWrap) return;
    if (!headers.length) {
      detectedHeadersWrap.classList.add('is-hidden');
      return;
    }
    detectedHeadersWrap.classList.remove('is-hidden');
    headerChips.innerHTML = headers.map((header, index) => {
      const label = header || `Columna ${index + 1}`;
      return `<span class="excel-header-chip" title="Columna ${index + 1}">${escapeHtml(label)}</span>`;
    }).join('');
  };

  const collectMapping = () => {
    const headerRow = Math.max(1, Number(headerRowInput?.value || currentPreview?.headerRow || 1));
    const columns = {};
    mappingFields?.querySelectorAll('[data-excel-map-field]').forEach((select) => {
      const field = select.getAttribute('data-excel-map-field');
      if (!field) return;
      columns[field] = select.value === '' ? null : Number(select.value);
    });
    return { headerRow, columns };
  };

  const updateMappingProgress = () => {
    const mapping = collectMapping();
    const progress = computeMappingProgress(importType, mapping, fields);
    if (mappingProgressText) {
      mappingProgressText.textContent = `${progress.requiredDone} de ${progress.requiredTotal} obligatorios${progress.optionalTotal ? ` · ${progress.optionalDone} opcionales` : ''}`;
    }
    if (mappingProgressFill) {
      const pct = progress.requiredTotal ? Math.round((progress.requiredDone / progress.requiredTotal) * 100) : 0;
      mappingProgressFill.style.width = `${pct}%`;
    }
    mappingProgress?.classList.toggle('is-complete', progress.complete);

    mappingFields?.querySelectorAll('[data-excel-map-row]').forEach((row) => {
      const field = row.getAttribute('data-excel-map-row');
      const select = row.querySelector('[data-excel-map-field]');
      const status = row.querySelector('.excel-mapping-status');
      const mapped = select?.value !== '';
      row.classList.toggle('is-mapped', mapped);
      row.classList.toggle('is-missing', !mapped && fields.find((item) => item.field === field)?.required);
      if (status) status.textContent = mapped ? '✓ Conectado' : (fields.find((item) => item.field === field)?.required ? 'Falta' : '—');
    });

    const shouldPromptSave = progress.complete && !selectedTemplateId && !appliedTemplateName;
    saveCta?.classList.toggle('is-hidden', !shouldPromptSave);
    if (shouldPromptSave && templateNameInput && !templateNameInput.value) {
      const file = fileInput?.files?.[0];
      templateNameInput.value = suggestTemplateName(file?.name || '', importType);
    }
  };

  const showMappingPanel = (preview) => {
    mappingPanel?.classList.remove('is-hidden');
    previewPanel?.classList.remove('is-hidden');
    if (headerRowInput) headerRowInput.value = String(preview?.mapping?.headerRow || preview?.headerRow || 1);
    if (sheetNameInput) sheetNameInput.value = preview?.sheetName || '—';
    renderDetectedHeaders(preview);
    renderMappingTable(preview);
    updateMappingProgress();
    renderTemplateCards();
    setWorkspaceStep(workspace, 'mapping');
  };

  const hideMappingPanel = () => {
    mappingPanel?.classList.add('is-hidden');
    previewPanel?.classList.add('is-hidden');
    if (mappingFields) mappingFields.innerHTML = '';
    appliedTemplateName = '';
    saveCta?.classList.add('is-hidden');
  };

  const renderPreviewTable = (preview) => {
    if (!previewTable) return;
    const rows = preview?.preview || [];
    if (!rows.length) {
      previewTable.classList.add('is-hidden');
      previewTable.innerHTML = '';
      return;
    }

    if (importType === 'asistencias') {
      previewTable.innerHTML = `
        <table>
          <thead><tr><th>Alumno</th><th>Fecha</th><th>Estado</th><th>Curso</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.nombre)}</td>
                <td>${escapeHtml(row.fecha)}</td>
                <td>${escapeHtml(row.estado)}</td>
                <td>${escapeHtml(row.curso)} ${escapeHtml(row.turno || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      previewTable.innerHTML = `
        <table>
          <thead><tr><th>Nombre</th><th>Curso</th><th>Turno</th><th>DNI</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.nombre)}</td>
                <td>${escapeHtml(row.curso)}</td>
                <td>${escapeHtml(row.turno)}</td>
                <td>${escapeHtml(row.dni || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
    previewTable.classList.remove('is-hidden');
  };

  const renderPreview = (preview) => {
    if (!previewEl) return;
    if (!preview) {
      previewEl.hidden = true;
      previewEl.textContent = '';
      if (previewTable) {
        previewTable.classList.add('is-hidden');
        previewTable.innerHTML = '';
      }
      if (submitBtn) submitBtn.disabled = true;
      setWorkspaceStep(workspace, 'template');
      return;
    }

    previewEl.hidden = false;
    previewEl.className = `import-result ${preview.canImport ? 'import-result-ok' : 'import-result-error'}`;
    const lines = [
      `Hoja "${preview.sheetName || '?'}" · encabezados en fila ${preview.headerRow || 1}.`,
      `${preview.validRows} fila(s) lista(s) · ${preview.invalidRows} con error · ${preview.totalRows} total.`,
    ];
    if (appliedTemplateName) lines.push(`Plantilla activa: ${appliedTemplateName}.`);
    if (preview.requiresMapping) lines.push('Completá el mapeo de columnas obligatorias.');
    if (preview.mappingErrors?.length) lines.push(`Mapeo: ${preview.mappingErrors.join(' · ')}`);
    if (preview.errors?.length) {
      const errorPreview = preview.errors.slice(0, 3).map((item) => `Fila ${item.row}: ${item.message}`);
      lines.push(`Errores: ${errorPreview.join(' · ')}${preview.errors.length > 3 ? ' · …' : ''}`);
    }
    previewEl.textContent = lines.join(' ');
    renderPreviewTable(preview);
    if (submitBtn) submitBtn.disabled = !preview.canImport;
    setWorkspaceStep(workspace, preview.canImport ? 'confirm' : 'mapping');
    updateMappingProgress();
  };

  const previewExcelFile = async (file, mapping = null, templateName = '') => {
    if (!file) {
      renderPreview(null);
      hideMappingPanel();
      currentPreview = null;
      return null;
    }

    const requestId = ++previewRequestId;
    const formData = new FormData();
    formData.append('type', importType);
    formData.append('file', file);
    if (mapping) formData.append('mapping', JSON.stringify(mapping));

    const response = await fetch('/api/import/preview', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
    });
    const preview = await response.json().catch(() => ({}));
    if (requestId !== previewRequestId) return null;

    if (!response.ok) {
      renderPreview({ canImport: false, errors: [{ row: 0, message: preview.error || 'No se pudo leer la planilla.' }] });
      return null;
    }

    appliedTemplateName = templateName;
    currentPreview = preview;
    showMappingPanel(preview);
    renderPreview(preview);
    return preview;
  };

  const debouncedPreviewRefresh = debounce(async () => {
    const check = validateExcelFile(fileInput, feedbackEl, maxFileMb);
    if (!check.ok) return;
    const mapping = collectMapping();
    const mappingErrors = validateMappingClient(importType, mapping, fields);
    if (mappingErrors.length) {
      renderPreview({
        ...currentPreview,
        canImport: false,
        mappingErrors,
        errors: mappingErrors.map((message) => ({ row: 0, message })),
      });
      return;
    }
    await previewExcelFile(check.file, mapping, appliedTemplateName);
  });

  const tryApplyMatchingTemplate = async (file, preview) => {
    if (selectedTemplateId) {
      const template = readTemplates(importType).find((item) => item.id === selectedTemplateId);
      if (template) {
        return previewExcelFile(file, buildMappingFromTemplate(template, preview?.detectedHeaders || []), template.name) || preview;
      }
    }

    const templates = readTemplates(importType);
    const matched = findBestExcelTemplate(templates, preview?.detectedHeaders || []);
    if (!matched) return preview;

    selectedTemplateId = matched.id;
    renderTemplateCards();
    if (templateNameInput) templateNameInput.value = matched.name;
    if (headerRowInput) headerRowInput.value = String(matched.headerRow || preview.headerRow || 1);
    showToast(`Plantilla "${matched.name}" detectada automáticamente.`);

    return previewExcelFile(file, buildMappingFromTemplate(matched, preview?.detectedHeaders || []), matched.name) || preview;
  };

  const handleFileSelected = async () => {
    const check = validateExcelFile(fileInput, feedbackEl, maxFileMb);
    if (dropzoneLabel) {
      dropzoneLabel.textContent = check.ok ? check.file.name : 'Sin archivo seleccionado';
    }
    if (!check.ok) {
      if (feedbackEl) {
        feedbackEl.classList.remove('is-hidden', 'is-ok');
        feedbackEl.classList.add('is-warning');
        feedbackEl.textContent = check.error || '';
      }
      renderPreview(null);
      hideMappingPanel();
      return;
    }
    if (resultEl) {
      resultEl.hidden = true;
      resultEl.textContent = '';
    }
    if (templateNameInput && !templateNameInput.value) {
      templateNameInput.value = suggestTemplateName(check.file.name, importType);
    }
    setWorkspaceStep(workspace, 'file');
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Analizando...';
      }
      const preview = await previewExcelFile(check.file);
      if (check.file && preview) {
        await tryApplyMatchingTemplate(check.file, preview);
      }
    } catch (error) {
      console.error('[aula-clara] excel preview failed', error);
      renderPreview({ canImport: false, errors: [{ row: 0, message: 'No se pudo analizar la planilla.' }] });
    } finally {
      if (submitBtn) submitBtn.textContent = submitBtn.dataset.defaultLabel || 'Importar';
    }
  };

  fileInput?.addEventListener('change', () => { void handleFileSelected(); });

  dropzone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    const file = event.dataTransfer?.files?.[0];
    if (!file || !fileInput) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    void handleFileSelected();
  });

  headerRowInput?.addEventListener('change', () => debouncedPreviewRefresh());

  templateNewBtn?.addEventListener('click', () => openBuilder(''));
  templateEditBtn?.addEventListener('click', () => {
    const id = selectedTemplateId || editingTemplateId;
    if (!id) {
      showToast('Seleccioná una plantilla primero.', 'warning');
      return;
    }
    openBuilder(id);
  });

  templateDuplicateBtn?.addEventListener('click', () => {
    const id = selectedTemplateId;
    if (!id) {
      showToast('Seleccioná una plantilla para duplicar.', 'warning');
      return;
    }
    const source = readTemplates(importType).find((item) => item.id === id);
    if (!source) return;
    openBuilder('');
    if (builderNameInput) builderNameInput.value = `${source.name} (copia)`;
    if (builderHeaderRowInput) builderHeaderRowInput.value = String(source.headerRow || 1);
    renderBuilderFields({ columnNames: { ...(source.columnNames || {}) } });
  });

  builderCancelBtn?.addEventListener('click', closeBuilder);

  builderSaveBtn?.addEventListener('click', () => {
    const { name, headerRow, columnNames } = collectBuilderTemplate();
    if (!name) {
      showToast('Escribí un nombre para la plantilla.', 'warning');
      builderNameInput?.focus();
      return;
    }

    const mapping = { headerRow, columns: {} };
    const mappingErrors = validateMappingClient(importType, {
      columns: Object.fromEntries(
        Object.keys(columnNames).map((field) => [field, columnNames[field] ? 0 : null]),
      ),
    }, fields);

    const hasRequiredNames = fields.filter((field) => field.required).every((field) => columnNames[field.field]);
    const hasStudentName = importType !== 'alumnos' || columnNames.nombre || columnNames.apellido;
    if (!hasRequiredNames || !hasStudentName) {
      showToast('Completá al menos los campos obligatorios con el nombre de columna de tu Excel.', 'warning');
      return;
    }

    const template = {
      id: editingTemplateId || createId('excel-map'),
      name,
      headerRow,
      columns: mapping.columns,
      columnNames,
      columnLabels: Object.values(columnNames),
      updatedAt: new Date().toISOString(),
    };

    if (saveTemplateRecord(template, `Plantilla "${name}" guardada.`)) {
      selectedTemplateId = template.id;
      closeBuilder();
      const check = validateExcelFile(fileInput, feedbackEl, maxFileMb);
      if (check.ok) {
        void previewExcelFile(check.file, buildMappingFromTemplate(template, currentPreview?.detectedHeaders || []), template.name);
      }
    }
  });

  const persistCurrentMappingAsTemplate = () => {
    const mapping = collectMapping();
    const mappingErrors = validateMappingClient(importType, mapping, fields);
    if (mappingErrors.length) {
      showToast(mappingErrors[0], 'warning');
      return false;
    }

    const name = String(templateNameInput?.value || '').trim();
    if (!name) {
      showToast('Escribí un nombre para la plantilla.', 'warning');
      templateNameInput?.focus();
      return false;
    }

    const columnNames = extractColumnNamesFromMapping(mapping.columns, currentPreview?.detectedHeaders || []);
    const existing = readTemplates(importType).find((item) => item.id === selectedTemplateId || item.name.toLowerCase() === name.toLowerCase());

    const template = {
      id: existing?.id || createId('excel-map'),
      name,
      headerRow: mapping.headerRow,
      columns: mapping.columns,
      columnNames,
      columnLabels: (currentPreview?.detectedHeaders || []).map((label) => String(label || '')),
      updatedAt: new Date().toISOString(),
    };

    return saveTemplateRecord(template, `Plantilla "${name}" guardada.`);
  };

  templateSaveBtn?.addEventListener('click', () => {
    persistCurrentMappingAsTemplate();
  });

  templateDeleteBtn?.addEventListener('click', () => {
    const templateId = selectedTemplateId;
    if (!templateId) {
      showToast('Seleccioná una plantilla para eliminar.', 'warning');
      return;
    }
    const templates = readTemplates(importType);
    const target = templates.find((item) => item.id === templateId);
    if (!target) return;
    if (!window.confirm(`¿Eliminar la plantilla "${target.name}"?`)) return;

    writeTemplates(importType, templates.filter((item) => item.id !== templateId));
    selectedTemplateId = '';
    if (templateNameInput) templateNameInput.value = '';
    appliedTemplateName = '';
    renderTemplateCards();
    showToast('Plantilla eliminada.');
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const check = validateExcelFile(fileInput, feedbackEl, maxFileMb);
    if (!check.ok) {
      showToast(check.error || 'Seleccioná un archivo Excel válido.', 'warning');
      fileInput?.focus();
      return;
    }

    const mapping = collectMapping();
    const mappingErrors = validateMappingClient(importType, mapping, fields);
    if (mappingErrors.length) {
      showToast(mappingErrors.join(' · '), 'warning');
      return;
    }

    const defaultLabel = submitBtn?.dataset.defaultLabel || submitBtn?.textContent || 'Importar';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Importando...';
    }
    if (resultEl) {
      resultEl.hidden = true;
      resultEl.textContent = '';
    }

    try {
      const formData = new FormData();
      formData.append('type', importType);
      formData.append('file', check.file);
      formData.append('mapping', JSON.stringify(mapping));

      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        renderImportResult(resultEl, result, true);
        return;
      }

      if (!selectedTemplateId && saveCta && !saveCta.classList.contains('is-hidden')) {
        persistCurrentMappingAsTemplate();
      }

      renderImportResult(resultEl, result, false);
      showToast('Importación completada.');
      form.reset();
      if (dropzoneLabel) dropzoneLabel.textContent = 'Sin archivo seleccionado';
      hideMappingPanel();
      currentPreview = null;
      renderPreview(null);
      if (feedbackEl) {
        feedbackEl.textContent = '';
        feedbackEl.classList.add('is-hidden');
        feedbackEl.classList.remove('is-ok', 'is-warning');
      }
      setWorkspaceStep(workspace, 'template');
      options.onImported?.(importType, result);
    } catch (error) {
      console.error('[aula-clara] excel import failed', error);
      renderImportResult(resultEl, { error: 'Error de red al importar.' }, true);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = defaultLabel;
      }
    }
  });

  if (submitBtn) submitBtn.dataset.defaultLabel = submitBtn.textContent || '';
  renderTemplateCards();
}

export function initExcelImportWorkspaces(options = {}) {
  document.querySelectorAll('[data-excel-workspace]').forEach((workspace) => {
    initExcelImportWorkspace(workspace, options);
  });
}

export { MAPPABLE_FIELDS };
