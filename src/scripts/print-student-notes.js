/** Impresión de fichas de alumno (ventana del navegador). */

/**
 * @param {string} title
 * @param {string} bodyHtml
 */
export function openPrintDocument(title, bodyHtml) {
  const ventana = window.open('', '_blank');
  if (!ventana) {
    return false;
  }

  const doc = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", Georgia, serif;
      color: #1a1a1a;
      margin: 0;
      padding: 1.25rem;
      background: #fff;
    }
    h1 { font-size: 1.15rem; margin: 0 0 0.75rem; }
    .meta { color: #555; font-size: 0.9rem; margin-bottom: 1rem; }
    .sheet {
      display: grid;
      gap: 0.85rem;
    }
    .note-card {
      border: 1px dashed #666;
      border-radius: 0.4rem;
      padding: 0.85rem 1rem;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .note-card header {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      border-bottom: 1px solid #ddd;
      padding-bottom: 0.45rem;
      margin-bottom: 0.55rem;
    }
    .note-card h2 {
      font-size: 1.05rem;
      margin: 0;
    }
    .badge {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 0.15rem 0.45rem;
      border: 1px solid #999;
      border-radius: 999px;
      height: fit-content;
    }
    .badge.libre { border-color: #b33; color: #8b1e1e; }
    .badge.riesgo { border-color: #b80; color: #7a5200; }
    .badge.ok { border-color: #2a7; color: #145c3a; }
    .row { margin: 0.25rem 0; font-size: 0.92rem; }
    .cut {
      text-align: center;
      color: #999;
      font-size: 0.75rem;
      margin: 0.15rem 0;
    }
    ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }
    @media print {
      body { padding: 0.4rem; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:1rem;">
    <button onclick="window.print()" style="padding:0.55rem 1rem;font-weight:700;cursor:pointer;">Imprimir</button>
    <button onclick="window.close()" style="padding:0.55rem 1rem;margin-left:0.4rem;cursor:pointer;">Cerrar</button>
  </div>
  <h1>${escapeHtml(title)}</h1>
  ${bodyHtml}
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));<\/script>
</body>
</html>`;

  ventana.document.open();
  ventana.document.write(doc);
  ventana.document.close();
  return true;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {Array<import('../lib/student-situation').StudentSituation>} situations
 * @param {{ title?: string, periodLabel?: string }} [options]
 */
export function buildStudentNotesHtml(situations, options = {}) {
  const period = options.periodLabel || 'Período actual';
  const cards = situations.map((item) => {
    const statusLabel = item.status === 'libre'
      ? 'Libre'
      : item.status === 'riesgo'
        ? 'Riesgo'
        : item.status === 'atencion'
          ? 'Atención'
          : 'OK';
    const badgeClass = item.status === 'libre'
      ? 'libre'
      : item.status === 'riesgo'
        ? 'riesgo'
        : 'ok';
    const grades = item.recentGrades.length
      ? `<ul>${item.recentGrades.map((g) => `<li>${escapeHtml(g.titulo)}: <strong>${escapeHtml(g.display)}</strong>${g.fecha ? ` (${escapeHtml(g.fecha)})` : ''}</li>`).join('')}</ul>`
      : '<div class="row">Sin notas cargadas.</div>';
    const pending = item.pendingWorks.length
      ? `<ul>${item.pendingWorks.map((w) => `<li>${escapeHtml(w.titulo)}${w.fechaReferencia ? ` — ${escapeHtml(w.fechaReferencia)}` : ''}</li>`).join('')}</ul>`
      : '<div class="row">Sin trabajos pendientes detectados.</div>';
    const attendance = item.attendanceRate === null
      ? 'Sin datos'
      : `${item.attendanceRate.toFixed(0)}% (${item.present}/${item.total})`;
    const avg = item.gradeAverage === null ? '-' : item.gradeAverage.toFixed(1);

    return `
      <article class="note-card">
        <header>
          <div>
            <h2>${escapeHtml(item.student.nombre)}</h2>
            <div class="row">${escapeHtml(item.course?.escuela || '')} · ${escapeHtml(item.course?.nombre || '')} ${escapeHtml(item.course?.turno || '')} · ${escapeHtml(item.subjectName)}</div>
          </div>
          <span class="badge ${badgeClass}">${statusLabel}</span>
        </header>
        <div class="row"><strong>Período:</strong> ${escapeHtml(period)}</div>
        <div class="row"><strong>Asistencia:</strong> ${escapeHtml(attendance)}</div>
        <div class="row"><strong>Promedio:</strong> ${escapeHtml(avg)}</div>
        <div class="row"><strong>Calificaciones recientes:</strong></div>
        ${grades}
        <div class="row"><strong>Trabajos a recuperar / pendientes:</strong></div>
        ${pending}
        ${item.student.tutor ? `<div class="row"><strong>Contacto:</strong> ${escapeHtml(item.student.tutor)}</div>` : ''}
      </article>
      <div class="cut">✂ — cortar por aquí —</div>
    `;
  }).join('');

  return `<p class="meta">Generado con Aula Clara · ${escapeHtml(new Date().toLocaleDateString('es-AR'))}</p><div class="sheet">${cards}</div>`;
}

/**
 * @param {Array<import('../lib/student-situation').StudentSituation>} situations
 * @param {{ title?: string, periodLabel?: string }} [options]
 */
export function printStudentNotes(situations, options = {}) {
  if (!situations.length) return false;
  const title = options.title || 'Notas para el cuaderno';
  const body = buildStudentNotesHtml(situations, options);
  return openPrintDocument(title, body);
}
