import katex from 'katex';

function escapeHtml(value: string) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderLatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex.trim(), {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    });
  } catch {
    const fallback = displayMode ? `$$${latex}$$` : `$${latex}$`;
    return escapeHtml(fallback);
  }
}

type LatexSegment = { type: 'text' | 'inline' | 'block'; value: string };

function parseLatexSegments(text: string): LatexSegment[] {
  const segments: LatexSegment[] = [];
  let i = 0;
  let textBuf = '';

  const flushText = () => {
    if (textBuf) {
      segments.push({ type: 'text', value: textBuf });
      textBuf = '';
    }
  };

  while (i < text.length) {
    if (text[i] === '$' && text[i + 1] === '$') {
      const close = text.indexOf('$$', i + 2);
      if (close !== -1) {
        flushText();
        segments.push({ type: 'block', value: text.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    }

    if (text.startsWith('\\[', i)) {
      const close = text.indexOf('\\]', i + 2);
      if (close !== -1) {
        flushText();
        segments.push({ type: 'block', value: text.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    }

    if (text.startsWith('\\(', i)) {
      const close = text.indexOf('\\)', i + 2);
      if (close !== -1) {
        flushText();
        segments.push({ type: 'inline', value: text.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    }

    if (text[i] === '$' && text[i + 1] !== '$') {
      const close = text.indexOf('$', i + 1);
      if (close !== -1 && text[close + 1] !== '$') {
        flushText();
        segments.push({ type: 'inline', value: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    textBuf += text[i];
    i += 1;
  }

  flushText();
  return segments;
}

export function formatTextWithLatex(text: string): string {
  const segments = parseLatexSegments(String(text ?? ''));
  return segments.map((segment) => {
    if (segment.type === 'text') return escapeHtml(segment.value);
    const rendered = renderLatex(segment.value, segment.type === 'block');
    if (segment.type === 'block') {
      return `<div class="latex-block" style="margin: 10px 0; overflow-x: auto; text-align: center;">${rendered}</div>`;
    }
    return rendered;
  }).join('');
}
