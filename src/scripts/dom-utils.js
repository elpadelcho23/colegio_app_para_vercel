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

export function emptyState(title, message = '') {
  return el('div', { className: 'empty' },
    el('h3', {}, title),
    message ? el('p', {}, message) : null,
  );
}

export function metric(value, label) {
  return el('div', { className: 'metric' },
    el('strong', {}, value),
    el('span', {}, label),
  );
}

export function panelMetric(label, value) {
  return el('article', { className: 'metric panel' },
    el('span', {}, label),
    el('strong', {}, value),
  );
}

export function renderMetrics(container, items) {
  replaceContent(container, ...items.map(({ value, label }) => metric(value, label)));
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

export function buildTable(headers, rows) {
  const thead = el('thead', {},
    el('tr', {}, ...headers.map((header) => th(header))),
  );
  const tbody = el('tbody', {},
    ...rows.map((row) => el('tr', {}, ...row.map((cell) => {
      if (cell instanceof HTMLElement) return td(cell);
      if (Array.isArray(cell)) return td(...cell);
      return td(String(cell ?? ''));
    }))),
  );
  return el('div', { className: 'table-wrap' }, el('table', {}, thead, tbody));
}

export function renderTable(container, headers, rows, empty = null) {
  if (!rows.length) {
    replaceContent(container, empty || emptyState('Sin datos'));
    return;
  }
  replaceContent(container, buildTable(headers, rows));
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
