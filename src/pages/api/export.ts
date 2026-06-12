import type { APIRoute } from 'astro';
import ExcelJS from 'exceljs';
import { db, type User } from '../../server/db';

type ExportRow = Record<string, string | number | null>;

/** Neutraliza celdas que Excel/LibreOffice interpretarían como fórmulas o DDE. */
function sanitizeExcelValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value);
  if (/^[=+\-@|\t\r]/.test(text)) return `'${text}`;
  return text;
}

function sanitizeExportRows(rows: ExportRow[]): ExportRow[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, sanitizeExcelValue(value)]),
    ),
  );
}

function docenteCourseClause(user: User) {
  if (user.rol === 'admin') return '';
  return `
    AND cursos.tenant_id = @tenant_id
    AND EXISTS (
      SELECT 1
      FROM docente_cursos dc
      WHERE dc.tenant_id = @tenant_id
        AND dc.curso_id = cursos.id
        AND dc.docente_id = @docente_id
    )
  `;
}

function buildParams(url: URL, user: User) {
  return {
    tenant_id: user.tenant_id,
    docente_id: user.id,
    colegio: url.searchParams.get('colegio') || null,
    curso_id: url.searchParams.get('curso') || null,
    materia_id: url.searchParams.get('materia') || null,
    desde: url.searchParams.get('desde') || '1900-01-01',
    hasta: url.searchParams.get('hasta') || '2999-12-31',
  };
}

function addWorksheet(workbook: ExcelJS.Workbook, name: string, rows: ExportRow[]) {
  const worksheet = workbook.addWorksheet(name);
  const safeRows = sanitizeExportRows(rows);
  const headers = safeRows.length ? Object.keys(safeRows[0]) : ['Sin datos'];

  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.max(14, Math.min(34, header.length + 4)),
  }));

  if (safeRows.length) worksheet.addRows(safeRows);

  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF226C5F' } };
    cell.alignment = { vertical: 'middle' };
  });

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, safeRows.length + 1), column: headers.length },
  };

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFD9E1DC' } },
      };
    });

    const estadoCell = row.getCell('Estado');
    const estado = String(estadoCell.value || '').toLowerCase();
    if (estado === 'presente') {
      estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
      estadoCell.font = { color: { argb: 'FF1F7A4D' }, bold: true };
    }
    if (estado === 'ausente') {
      estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
      estadoCell.font = { color: { argb: 'FFB42318' }, bold: true };
    }
  });

  for (const column of worksheet.columns) {
    const values = column.values?.slice(1) || [];
    const maxLength = values.reduce<number>((max, value) => Math.max(max, String(value ?? '').length), 0);
    column.width = Math.max(Number(column.width || 14), Math.min(maxLength + 2, 42));
  }

  return worksheet;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const params = buildParams(url, user);
  const coursePermission = docenteCourseClause(user);
  const attendanceTenantFilter = user.rol === 'admin' ? '' : 'AND asistencias.tenant_id = @tenant_id AND asistencias.docente_id = @docente_id';
  const gradeTenantFilter = user.rol === 'admin' ? '' : 'AND notas.tenant_id = @tenant_id AND notas.docente_id = @docente_id';

  const asistencias = db.prepare(`
    WITH ranked_asistencias AS (
      SELECT
        asistencias.*,
        ROW_NUMBER() OVER (
          PARTITION BY asistencias.tenant_id, asistencias.docente_id, asistencias.alumno_id, asistencias.materia_id, asistencias.fecha
          ORDER BY asistencias.updated_at DESC, asistencias.created_at DESC
        ) AS rn
      FROM asistencias
      WHERE asistencias.fecha BETWEEN @desde AND @hasta
        ${attendanceTenantFilter}
    )
    SELECT
      asistencias.fecha AS Fecha,
      cursos.escuela AS Colegio,
      cursos.nombre AS Curso,
      cursos.turno AS Turno,
      materias.nombre AS Materia,
      alumnos.nombre AS Alumno,
      CASE asistencias.estado
        WHEN 'presente' THEN 'Presente'
        WHEN 'ausente' THEN 'Ausente'
        ELSE asistencias.estado
      END AS Estado,
      usuarios.nombre AS Docente
    FROM ranked_asistencias asistencias
    JOIN alumnos ON alumnos.id = asistencias.alumno_id
    JOIN cursos ON cursos.id = alumnos.curso_id
    JOIN materias ON materias.id = asistencias.materia_id
    JOIN usuarios ON usuarios.id = asistencias.docente_id
    WHERE asistencias.rn = 1
      AND (@colegio IS NULL OR cursos.escuela = @colegio)
      AND (@curso_id IS NULL OR cursos.id = @curso_id)
      AND (@materia_id IS NULL OR materias.id = @materia_id)
      ${coursePermission}
    ORDER BY asistencias.fecha, cursos.nombre, alumnos.nombre
  `).all(params) as ExportRow[];

  const notas = db.prepare(`
    SELECT
      notas.fecha AS Fecha,
      cursos.escuela AS Colegio,
      cursos.nombre AS Curso,
      cursos.turno AS Turno,
      materias.nombre AS Materia,
      alumnos.nombre AS Alumno,
      notas.titulo AS Evaluacion,
      COALESCE(notas.calificacion_texto, CAST(notas.valor AS TEXT)) AS Calificacion,
      CASE
        WHEN notas.peso >= 90 THEN 'Alta'
        WHEN notas.peso >= 55 THEN 'Media'
        ELSE 'Baja'
      END AS Importancia,
      notas.fecha_entrega AS Entrega,
      usuarios.nombre AS Docente
    FROM notas
    JOIN alumnos ON alumnos.id = notas.alumno_id
    JOIN cursos ON cursos.id = alumnos.curso_id
    JOIN materias ON materias.id = notas.materia_id
    JOIN usuarios ON usuarios.id = notas.docente_id
    WHERE notas.fecha BETWEEN @desde AND @hasta
      AND (@colegio IS NULL OR cursos.escuela = @colegio)
      AND (@curso_id IS NULL OR cursos.id = @curso_id)
      AND (@materia_id IS NULL OR materias.id = @materia_id)
      ${gradeTenantFilter}
      ${coursePermission}
    ORDER BY notas.fecha, cursos.nombre, alumnos.nombre
  `).all(params) as ExportRow[];

  const alumnos = db.prepare(`
    SELECT alumnos.id, alumnos.nombre, cursos.nombre AS curso, cursos.escuela AS colegio, cursos.turno AS turno
    FROM alumnos
    JOIN cursos ON cursos.id = alumnos.curso_id
    WHERE (@colegio IS NULL OR cursos.escuela = @colegio)
      AND (@curso_id IS NULL OR cursos.id = @curso_id)
      ${user.rol === 'admin' ? '' : 'AND alumnos.tenant_id = @tenant_id'}
      ${coursePermission}
    ORDER BY cursos.nombre, alumnos.nombre
  `).all(params) as Array<{ id: string; nombre: string; curso: string; colegio: string; turno: string }>;

  const resumen = alumnos.map((alumno) => {
    const grades = db.prepare(`
      SELECT valor, peso
      FROM notas
      WHERE alumno_id = @alumno_id
        AND valor IS NOT NULL
        AND fecha BETWEEN @desde AND @hasta
        AND (@materia_id IS NULL OR materia_id = @materia_id)
        ${user.rol === 'admin' ? '' : 'AND tenant_id = @tenant_id AND docente_id = @docente_id'}
    `).all({ ...params, alumno_id: alumno.id }) as Array<{ valor: number; peso: number }>;

    const attendanceRows = db.prepare(`
      SELECT estado
      FROM asistencias
      WHERE alumno_id = @alumno_id
        AND fecha BETWEEN @desde AND @hasta
        AND (@materia_id IS NULL OR materia_id = @materia_id)
        ${user.rol === 'admin' ? '' : 'AND tenant_id = @tenant_id AND docente_id = @docente_id'}
    `).all({ ...params, alumno_id: alumno.id }) as Array<{ estado: string }>;

    const totalPeso = grades.reduce((acc, grade) => acc + Number(grade.peso || 100), 0);
    const promedio = totalPeso > 0
      ? grades.reduce((acc, grade) => acc + Number(grade.valor) * Number(grade.peso || 100), 0) / totalPeso
      : null;
    const presentes = attendanceRows.filter((item) => item.estado === 'presente').length;
    const asistencia = attendanceRows.length ? (presentes / attendanceRows.length) * 100 : null;

    return {
      Colegio: alumno.colegio,
      Curso: alumno.curso,
      Turno: alumno.turno,
      Alumno: alumno.nombre,
      Promedio: promedio === null ? '-' : Number(promedio.toFixed(2)),
      Asistencia: asistencia === null ? '-' : `${asistencia.toFixed(0)}%`,
      'Registros de asistencia': attendanceRows.length,
      'Cantidad de notas': grades.length,
    };
  }) as ExportRow[];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aula Clara';
  workbook.created = new Date();
  workbook.modified = new Date();

  addWorksheet(workbook, 'Asistencias', asistencias);
  addWorksheet(workbook, 'Notas', notas);
  addWorksheet(workbook, 'Resumen', resumen);

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `aula-clara-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
};
