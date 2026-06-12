import { formatTextWithLatex } from './latex-html';

export type ActivityGenerationKind = 'tp' | 'examen' | 'integrador';

export type GeneratedActivityBlock = {
  titulo?: string;
  contenido: string;
};

export type GeneratedActivityPayload = {
  titulo: string;
  introduccion?: string;
  bloques: GeneratedActivityBlock[];
  instruccionesAlumno?: string[];
  hojaRespuestas?: string;
  criteriosDocente?: string[];
  tipo: ActivityGenerationKind;
};

function escapeHtml(value: string) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function kindLabel(kind: ActivityGenerationKind) {
  if (kind === 'tp') return 'Trabajo Práctico';
  if (kind === 'integrador') return 'Trabajo Integrador';
  return 'Examen';
}

export function buildActivityDocumentHtml(options: {
  titulo: string;
  colegio?: string;
  turno?: string;
  curso?: string;
  materia?: string;
  tipo: ActivityGenerationKind;
  payload: GeneratedActivityPayload;
}) {
  const { titulo, colegio, turno, curso, materia, tipo, payload } = options;
  const tituloDoc = escapeHtml(titulo.toUpperCase());

  let body = `
    <div class="doc-root" style="font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; max-width: 820px; margin: 0 auto; line-height: 1.55;">
      <header style="text-align: center; border-bottom: 2px solid #226c5f; padding-bottom: 12px; margin-bottom: 22px;">
        <h1 style="margin: 0; font-size: 22px; color: #174c43; letter-spacing: 0.02em;">${tituloDoc}</h1>
        <p style="margin: 8px 0 0; color: #617069; font-size: 13px;">${escapeHtml(kindLabel(tipo))}</p>
      </header>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 22px; font-size: 13px;">
        <tr>
          <td style="padding: 8px; border: 1px solid #d9e1dc;"><strong>Colegio:</strong> ${escapeHtml(colegio || '-')}</td>
          <td style="padding: 8px; border: 1px solid #d9e1dc;"><strong>Turno:</strong> ${escapeHtml(turno || '-')}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #d9e1dc;"><strong>Curso:</strong> ${escapeHtml(curso || '-')}</td>
          <td style="padding: 8px; border: 1px solid #d9e1dc;"><strong>Materia:</strong> ${escapeHtml(materia || '-')}</td>
        </tr>
      </table>
  `;

  if (payload.introduccion) {
    body += `
      <section style="margin-bottom: 20px;">
        <h2 style="font-size: 16px; color: #174c43; margin: 0 0 8px;">Presentación</h2>
        <p style="margin: 0; white-space: pre-wrap;">${formatTextWithLatex(payload.introduccion)}</p>
      </section>
    `;
  }

  if (payload.instruccionesAlumno?.length) {
    body += `
      <section style="margin-bottom: 20px;">
        <h2 style="font-size: 16px; color: #174c43; margin: 0 0 8px;">Indicaciones generales</h2>
        <ul style="margin: 0; padding-left: 20px;">
          ${payload.instruccionesAlumno.map((item) => `<li style="margin-bottom: 6px;">${formatTextWithLatex(item)}</li>`).join('')}
        </ul>
      </section>
    `;
  }

  payload.bloques.forEach((bloque, index) => {
    const heading = bloque.titulo ? escapeHtml(bloque.titulo) : `Actividad ${index + 1}`;
    body += `
      <section style="margin-bottom: 22px; page-break-inside: avoid;">
        <h3 style="font-size: 15px; color: #174c43; margin: 0 0 10px; border-left: 4px solid #226c5f; padding-left: 10px;">${heading}</h3>
        <div style="white-space: pre-wrap; font-size: 14px;">${formatTextWithLatex(bloque.contenido)}</div>
      </section>
    `;
  });

  if (payload.hojaRespuestas) {
    body += `
      <section style="margin-top: 28px; padding-top: 16px; border-top: 2px dashed #d9e1dc; page-break-before: always;">
        <h2 style="font-size: 16px; color: #174c43; margin: 0 0 10px;">Hoja de respuestas / criterios (solo docente)</h2>
        <div style="white-space: pre-wrap; font-size: 13px; background: #f6f7f3; padding: 14px; border: 1px solid #d9e1dc; border-radius: 8px;">
          ${formatTextWithLatex(payload.hojaRespuestas)}
        </div>
      </section>
    `;
  }

  if (payload.criteriosDocente?.length) {
    body += `
      <section style="margin-top: 18px;">
        <h3 style="font-size: 14px; color: #174c43; margin: 0 0 8px;">Criterios de evaluación sugeridos</h3>
        <ul style="margin: 0; padding-left: 20px;">
          ${payload.criteriosDocente.map((item) => `<li style="margin-bottom: 5px;">${formatTextWithLatex(item)}</li>`).join('')}
        </ul>
      </section>
    `;
  }

  body += '</div>';
  return body;
}

export function payloadToEditorContent(payload: GeneratedActivityPayload, tipoDb: 'tp' | 'evaluacion') {
  const bloquesTexto = payload.bloques.map((b) => {
    const title = b.titulo ? `${b.titulo}\n` : '';
    return `${title}${b.contenido}`.trim();
  });

  if (tipoDb === 'evaluacion') {
    const preguntas = bloquesTexto.join('\n\n');
    const extra = payload.hojaRespuestas ? `\n\n[Hoja docente]\n${payload.hojaRespuestas}` : '';
    return { questions: `${preguntas}${extra}`.trim() };
  }

  const consigna = [
    payload.introduccion,
    ...bloquesTexto,
    payload.instruccionesAlumno?.length ? `Indicaciones:\n- ${payload.instruccionesAlumno.join('\n- ')}` : '',
  ].filter(Boolean).join('\n\n');

  const criterios = [
    ...(payload.criteriosDocente || []),
    payload.hojaRespuestas ? `Hoja docente: ${payload.hojaRespuestas}` : '',
  ].filter(Boolean).join(', ');

  return { brief: consigna.trim(), criteria: criterios.trim() };
}
