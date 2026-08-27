/**
 * Utilidades DOM seguras: evitan innerHTML con datos dinámicos.
 * El contenido de texto se asigna con textContent; atributos y dataset con APIs nativas.
 */

function normalizeChildren(children) {
  return children.flat().filter((child) => child != null && child !== false);
}

function appendChildren(node, children) {
  normalizeChildren(children).forEach((child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
      return;
    }
    node.appendChild(child);
  });
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  const { className, class: classProp, dataset, attrs, text, html, ...rest } = props;

  if (className || classProp) node.className = className || classProp;
  if (dataset) {
    Object.entries(dataset).forEach(([key, value]) => {
      node.dataset[key] = String(value ?? '');
    });
  }
  if (attrs) {
    Object.entries(attrs).forEach(([key, value]) => {
      node.setAttribute(key, String(value ?? ''));
    });
  }
  Object.entries(rest).forEach(([key, value]) => {
    if (key in node && key !== 'type') {
      node[key] = value;
      return;
    }
    if (value != null) node.setAttribute(key, String(value));
  });

  if (text != null) node.textContent = String(text);
  if (html != null) node.innerHTML = String(html);
  appendChildren(node, children);
  return node;
}

export function replaceContent(parent, ...children) {
  if (!parent) return;
  parent.replaceChildren(...normalizeChildren(children));
}

export function emptyState(title, message = '', options = {}) {
  const { ctaLabel = '', spaNav = '', onClick = null } = options;
  const children = [
    el('h3', {}, title),
    message ? el('p', {}, message) : null,
  ];

  if (ctaLabel && (spaNav || onClick)) {
    const props = {
      className: 'btn btn-primary empty-cta',
      type: 'button',
    };
    if (spaNav) props.dataset = { spaNav };
    const button = el('button', props, ctaLabel);
    if (onClick) button.addEventListener('click', onClick);
    children.push(button);
  }

  return el('div', { className: 'empty' }, ...children);
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function metricIcon(label) {
  const key = String(label || '').toLowerCase();
  const svg = svgEl('svg', {
    class: 'metric-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });

  const add = (tag, attrs) => svg.appendChild(svgEl(tag, attrs));

  if (key.includes('alumno')) {
    add('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' });
    add('circle', { cx: '9', cy: '7', r: '4' });
    add('path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' });
    add('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' });
  } else if (key.includes('curso')) {
    add('path', { d: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z' });
    add('path', { d: 'M8 7h8' });
    add('path', { d: 'M8 11h8' });
  } else if (key.includes('materia')) {
    add('path', { d: 'M12 7v14' });
    add('path', { d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z' });
  } else if (key.includes('promedio') || key.includes('aprobad')) {
    add('path', { d: 'M3 3v16a2 2 0 0 0 2 2h16' });
    add('path', { d: 'm19 9-5 5-4-4-3 3' });
  } else if (key.includes('asist') || key.includes('presente') || key.includes('acredita')) {
    add('path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' });
    add('path', { d: 'm9 11 3 3L22 4' });
  } else if (key.includes('ausente')) {
    add('circle', { cx: '12', cy: '12', r: '10' });
    add('path', { d: 'm15 9-6 6' });
    add('path', { d: 'm9 9 6 6' });
  } else if (key.includes('calific') || key.includes('registro') || key.includes('evaluac')) {
    add('path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z' });
    add('path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' });
    add('path', { d: 'M10 13h4' });
    add('path', { d: 'M10 17h4' });
  } else if (key.includes('período') || key.includes('periodo')) {
    add('path', { d: 'M8 2v4' });
    add('path', { d: 'M16 2v4' });
    add('rect', { x: '3', y: '4', width: '18', height: '18', rx: '2' });
    add('path', { d: 'M3 10h18' });
  } else {
    add('rect', { x: '3', y: '3', width: '7', height: '7', rx: '1' });
    add('rect', { x: '14', y: '3', width: '7', height: '7', rx: '1' });
    add('rect', { x: '3', y: '14', width: '7', height: '7', rx: '1' });
    add('rect', { x: '14', y: '14', width: '7', height: '7', rx: '1' });
  }

  return svg;
}

export function metric(value, label, options = {}) {
  const { view = '', hint = 'Abrir' } = options;
  const children = [
    el('strong', {}, value),
    el('span', { className: 'metric-label' }, label),
    metricIcon(label),
  ];

  if (view) {
    children.push(el('small', { className: 'metric-hint' }, hint));
    return el('button', {
      type: 'button',
      className: 'metric metric--link',
      dataset: { spaNav: view },
      attrs: {
        'aria-label': `${label}: ${value}. Ir a la sección`,
      },
    }, ...children);
  }

  return el('div', { className: 'metric' }, ...children);
}

export function panelMetric(label, value) {
  return el('article', { className: 'metric panel' },
    el('span', {}, label),
    el('strong', {}, value),
  );
}

export function renderMetrics(container, items) {
  replaceContent(
    container,
    ...items.map(({ value, label, view, hint }) => metric(value, label, { view, hint })),
  );
}

export function renderPanelMetrics(container, items) {
  replaceContent(container, ...items.map(({ label, value }) => panelMetric(label, value)));
}

export function tag(text, className = 'tag') {
  return el('span', { className }, text);
}

export function renderTags(container, items, labeler, emptyText = 'Sin datos') {
  if (!items.length) {
    replaceContent(container, tag(emptyText));
    return;
  }
  replaceContent(container, ...items.map((item) => tag(labeler(item))));
}

export function td(...children) {
  return el('td', {}, ...children);
}

export function th(text) {
  return el('th', {}, text);
}

function headerCell(header) {
  if (header instanceof HTMLElement) {
    return header.tagName === 'TH' ? header : el('th', {}, header);
  }
  if (header && typeof header === 'object') {
    const { text = '', title = '', className = '' } = header;
    return el('th', {
      className,
      attrs: title ? { title } : {},
    }, text);
  }
  return th(header);
}

function bodyCell(cell) {
  if (cell instanceof HTMLElement && cell.tagName === 'TD') return cell;
  if (cell instanceof HTMLElement) return td(cell);
  if (Array.isArray(cell)) return td(...cell);
  return td(String(cell ?? ''));
}

function rowConfig(row) {
  if (row && typeof row === 'object' && !Array.isArray(row) && Array.isArray(row.cells)) {
    return row;
  }
  return { cells: row };
}

export function buildTable(headers, rows, options = {}) {
  const wrapClass = ['table-wrap', options.wrapClass].filter(Boolean).join(' ');
  const thead = el('thead', {},
    el('tr', {}, ...headers.map((header) => headerCell(header))),
  );
  const tbody = el('tbody', {},
    ...rows.map((row) => {
      const cfg = rowConfig(row);
      return el('tr', { className: cfg.className || '', dataset: cfg.dataset }, ...cfg.cells.map((cell) => bodyCell(cell)));
    }),
  );
  return el('div', { className: wrapClass }, el('table', { className: options.tableClass || '' }, thead, tbody));
}

export function renderTable(container, headers, rows, empty = null, options = {}) {
  if (!rows.length) {
    replaceContent(container, empty || emptyState('Sin datos'));
    return;
  }
  replaceContent(container, buildTable(headers, rows, options));
}

export function fillSelectOptions(select, items, placeholder, valueKey = 'id', labeler = (item) => item.nombre) {
  if (!select) return;
  replaceContent(select,
    el('option', { value: '' }, placeholder),
    ...items.map((item) => el('option', { value: item[valueKey] }, labeler(item))),
  );
}

export function fillStaticSelectOptions(select, options) {
  if (!select) return;
  replaceContent(select, ...options.map((value) => el('option', { value }, value)));
}

/** Solo para HTML confiable generado en servidor (p. ej. vista previa de actividades). */
export function setTrustedHtml(container, html) {
  if (!container) return;
  container.replaceChildren();
  if (!html) return;
  const template = document.createElement('template');
  template.innerHTML = html;
  container.appendChild(template.content);
}
