/** Catálogo curricular liviano (contexto opcional para IA / recuperación). */

export type CurriculumUnit = {
  id: string;
  titulo: string;
  temas: string[];
};

export type CurriculumEntry = {
  id: string;
  materia: string;
  anio: string;
  modalidad: string;
  unidades: CurriculumUnit[];
};

export const CURRICULUM_LITE: CurriculumEntry[] = [
  {
    id: 'mat-1-comun',
    materia: 'Matemática',
    anio: '1º',
    modalidad: 'Común',
    unidades: [
      { id: 'u1', titulo: 'Números y operaciones', temas: ['Números enteros', 'Operaciones combinadas', 'Potenciación'] },
      { id: 'u2', titulo: 'Geometría', temas: ['Ángulos', 'Triángulos', 'Perímetro y área'] },
    ],
  },
  {
    id: 'prog-tec',
    materia: 'Programación',
    anio: '6º',
    modalidad: 'Técnica',
    unidades: [
      { id: 'u1', titulo: 'Fundamentos web', temas: ['HTML semántico', 'CSS básico', 'Formularios'] },
      { id: 'u2', titulo: 'Lógica y algoritmos', temas: ['Variables', 'Condicionales', 'Bucles'] },
    ],
  },
  {
    id: 'eco-5',
    materia: 'Elementos de micro y macroeconomía',
    anio: '5º',
    modalidad: 'Economía',
    unidades: [
      { id: 'u1', titulo: 'Aspectos generales', temas: ['Bienes escasos', 'Necesidades sociales', 'Modelo económico'] },
      { id: 'u2', titulo: 'Microeconomía', temas: ['Mercados', 'Oferta y demanda', 'Elasticidad'] },
      { id: 'u3', titulo: 'Macroeconomía', temas: ['PIB', 'Inflación', 'Política monetaria'] },
    ],
  },
  {
    id: 'lit-comun',
    materia: 'Literatura',
    anio: 'Común',
    modalidad: 'Común',
    unidades: [
      { id: 'u1', titulo: 'Géneros literarios', temas: ['Narrativa', 'Lírica', 'Dramática'] },
      { id: 'u2', titulo: 'Lectura crítica', temas: ['Contexto histórico', 'Autores canónicos', 'Producción escrita'] },
    ],
  },
];

export function findCurriculumForSubject(subjectName: string): CurriculumEntry | null {
  const needle = subjectName.trim().toLowerCase();
  if (!needle) return null;
  return CURRICULUM_LITE.find((entry) =>
    entry.materia.toLowerCase().includes(needle) || needle.includes(entry.materia.toLowerCase())
  ) || null;
}

export function curriculumContextText(subjectName: string): string {
  const entry = findCurriculumForSubject(subjectName);
  if (!entry) {
    return `Materia: ${subjectName}. Usá contenidos típicos del nivel secundario argentino.`;
  }
  const units = entry.unidades
    .map((unit) => `${unit.titulo}: ${unit.temas.join(', ')}`)
    .join(' | ');
  return `Diseño curricular (${entry.modalidad}, ${entry.anio} — ${entry.materia}): ${units}`;
}
