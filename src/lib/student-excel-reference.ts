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
  'Detecta encabezados aunque no estén en la fila 1.',
  'Si no mapeás Materia, se crean escuela y curso, pero Curso actual queda sin materias con nombre.',
  'Apellido y Nombre por separado se unen solos.',
  'Turno: Mañana, Tarde o Noche.',
] as const;
