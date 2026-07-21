export const STUDENT_EXCEL_SHEET = 'Alumnos';

export const STUDENT_EXCEL_COLUMNS = [
  { label: 'Escuela', required: true, hint: 'Nombre del colegio' },
  { label: 'Curso', required: true, hint: 'Ej: 6to 1ra' },
  { label: 'Turno', required: true, hint: 'Mañana, Tarde o Noche' },
  { label: 'Nombre', required: true, hint: 'Nombre y apellido' },
  { label: 'DNI', required: false, hint: 'Opcional' },
  { label: 'Tutor', required: false, hint: 'Contacto del tutor' },
  { label: 'Materias', required: false, hint: 'Separadas por coma (también podés mapear como Materia)' },
] as const;

export const STUDENT_EXCEL_EXAMPLE_ROWS = [
  {
    Escuela: 'Escuela Técnica 1',
    Curso: '6to 1ra',
    Turno: 'Mañana',
    Nombre: 'Martina Ruiz',
    DNI: '44111222',
    Tutor: 'Laura Ruiz',
    Materias: 'Matemática, Programación',
  },
  {
    Escuela: 'Escuela Técnica 1',
    Curso: '6to 1ra',
    Turno: 'Mañana',
    Nombre: 'Tomás Pereyra',
    DNI: '45222333',
    Tutor: 'Rubén Pereyra',
    Materias: 'Matemática, Programación',
  },
  {
    Escuela: 'Escuela Técnica 1',
    Curso: '5to 2da',
    Turno: 'Tarde',
    Nombre: 'Sofía Molina',
    DNI: '',
    Tutor: 'Ana Molina',
    Materias: 'Literatura',
  },
] as const;

export const STUDENT_EXCEL_NOTES = [
  'La app detecta encabezados aunque no estén en la fila 1 (títulos arriba, datos más abajo).',
  'Si tu Excel usa otra estructura, asigná las columnas manualmente y guardá una plantilla para la próxima vez.',
  'Podés mapear Apellido y Nombre por separado: la app los une automáticamente.',
  'Columnas flexibles: Colegio/Escuela, Alumno/Nombre, Documento/DNI, etc.',
  'Turno acepta Mañana, Tarde, Noche (con o sin tilde).',
  'Si la escuela o el curso no existen, se crean al importar.',
  'Las filas con error se omiten; el resto se carga igual.',
] as const;
