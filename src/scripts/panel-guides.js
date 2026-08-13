/**
 * Guías por panel + tutorial guiado (Excel primero por velocidad).
 */

/** @typedef {'panel' | 'registro' | 'cursos' | 'asistencia' | 'notas' | 'actividades' | 'herramientas'} SpaViewId */
/** @typedef {'excel' | 'manual'} TutorialPath */

/**
 * @typedef {object} PanelGuideTip
 * @property {string} title
 * @property {string} body
 * @property {string} [connects]
 * @property {string} [target]
 * @property {string} [action]
 * @property {string} [example]
 */

/**
 * @typedef {object} PanelGuide
 * @property {string} title
 * @property {PanelGuideTip[]} tips
 */

/**
 * @typedef {object} TutorialChoice
 * @property {string} id
 * @property {string} label
 * @property {string} [hint]
 * @property {boolean} [recommended]
 * @property {TutorialPath} path
 */

/**
 * @typedef {object} TutorialStep
 * @property {string} id
 * @property {SpaViewId | null} [view]
 * @property {string | null} [target]
 * @property {string} title
 * @property {string} body
 * @property {string} [action]
 * @property {string} [example]
 * @property {string} [connects]
 * @property {'click' | 'input' | 'change' | 'next' | 'choice'} [advance]
 * @property {TutorialChoice[]} [choices]
 * @property {'excel-alumnos'} [prepare]
 * @property {boolean} [optionalTarget]
 */

/** @type {Record<SpaViewId, PanelGuide>} */
export const PANEL_GUIDES = {
  panel: {
    title: 'Panel docente',
    tips: [
      {
        title: 'Tu resumen del día',
        body: 'Acá ves de un vistazo el curso que elegiste arriba: números, alertas y accesos rápidos.',
        action: 'Miralo después de elegir curso y materia arriba.',
        connects: 'Todo depende del “Curso actual” de la barra superior.',
        target: '[data-spa-view="panel"] [data-panel-hero]',
      },
      {
        title: 'Atajos del día',
        body: 'Los botones te llevan a Asistencia, Actividades o a importar alumnos con Excel (lo más rápido).',
        action: 'Si faltan alumnos, usá “Importar alumnos”.',
        target: '[data-spa-view="panel"] [data-spa-nav="herramientas"]',
      },
      {
        title: 'Seguimiento',
        body: 'Más abajo ves quién necesita atención: baja asistencia o trabajos pendientes.',
        connects: 'Sale de lo que guardaste en Asistencia, Notas y Actividades.',
        target: '[data-spa-view="panel"] [data-seguimiento]',
      },
    ],
  },
  cursos: {
    title: 'Cursos',
    tips: [
      {
        title: 'Ciclo activo',
        body: 'Es el año de la escuela (ej. 2026). Solo ves cursos y alumnos de ese ciclo.',
        action: 'Elegí el ciclo en este selector si necesitás cambiar.',
        connects: 'Asistencia, Notas y Actividades usan el mismo ciclo.',
        target: '[data-spa-view="cursos"] [data-cycle-active]',
      },
      {
        title: 'Copiar un ciclo anterior',
        body: 'Si ya armaste cursos el año pasado, cloná la estructura al ciclo nuevo. Los alumnos no se copian.',
        action: 'Completá origen y destino y tocá “Clonar estructura al nuevo ciclo”.',
        target: '[data-spa-view="cursos"] [data-cycle-clone]',
      },
      {
        title: 'Agregar escuela',
        body: 'Si no usás Excel, creá la escuela acá y después el curso.',
        action: 'Escribí el nombre y tocá “Añadir escuela”.',
        example: 'Escuela Demo',
        target: '[data-spa-view="cursos"] [data-new-school]',
      },
      {
        title: 'Crear curso',
        body: 'Completá escuela, nombre del curso y turno. Con Excel esto se crea solo al importar.',
        action: 'Ejemplo de curso: 6to 1ra · Turno: Mañana.',
        example: '6to 1ra',
        connects: 'Ese curso aparece después en “Curso actual” arriba.',
        target: '[data-spa-view="cursos"] [data-course-form] input[name="nombre"]',
      },
    ],
  },
  registro: {
    title: 'Alumnos',
    tips: [
      {
        title: 'Excel es más rápido',
        body: 'Si tenés el listado en planilla, importalo desde Excel en lugar de cargar uno por uno.',
        action: 'Andá a Excel → Alumnos cuando quieras importar masivo.',
        connects: 'La importación crea escuela, curso, materias y alumnos juntos.',
        target: '[data-spa-nav="herramientas"]',
      },
      {
        title: 'Nombre del alumno',
        body: 'Si cargás a mano, empezá por el nombre completo. Después escuela, curso y materias.',
        action: 'Escribí el nombre acá.',
        example: 'Ana Pérez',
        connects: 'Sin alumnos, Asistencia y Notas no tienen a quién marcar.',
        target: '[data-spa-view="registro"] [data-student-form] input[name="nombre"]',
      },
      {
        title: 'Materias del alumno',
        body: 'Cada materia habilita lista y notas. En Excel van en la columna Materias (separadas por coma).',
        action: 'Escribí la materia y tocá “Agregar materia”.',
        example: 'Matemática',
        connects: 'Esas materias aparecen en el selector de arriba.',
        target: '[data-spa-view="registro"] [data-student-new-subject]',
      },
      {
        title: 'Guardar',
        body: 'Cuando esté completo, guardá el alumno.',
        action: 'Hacé clic en “Guardar alumno”.',
        target: '[data-spa-view="registro"] [data-student-form] button[type="submit"]',
      },
    ],
  },
  asistencia: {
    title: 'Asistencia',
    tips: [
      {
        title: 'Fecha y curso',
        body: 'Usá el curso/materia de arriba. Acá solo elegís la fecha del día.',
        action: 'Confirmá la fecha y mirá la lista.',
        connects: 'La lista muestra alumnos del curso que cursan esa materia.',
        target: '[data-spa-view="asistencia"] [data-attendance-date]',
      },
      {
        title: 'Marcar y guardar',
        body: 'Tocá presente/ausente en cada alumno y guardá al final.',
        action: 'Hacé clic en “Guardar asistencia” cuando termines.',
        target: '[data-spa-view="asistencia"] [data-attendance-save]',
      },
    ],
  },
  notas: {
    title: 'Notas',
    tips: [
      {
        title: 'Cargar calificaciones',
        body: 'La planilla usa el curso y materia activos de arriba.',
        action: 'Ingresá la nota en la celda del alumno.',
        connects: 'Solo aparecen alumnos con esa materia asignada.',
        target: '[data-spa-view="notas"] [data-grades-take-view]',
      },
      {
        title: 'Cómo se relaciona',
        body: 'Si cambiás el curso de arriba, cambia la planilla. El Panel usa estas mismas notas.',
        connects: 'Quedan ligadas al año, curso y materia.',
        target: '[data-spa-view="notas"] [data-grades-save]',
      },
    ],
  },
  actividades: {
    title: 'Actividades',
    tips: [
      {
        title: 'Material del curso',
        body: 'Creá actividades o subí entregas. Todo se filtra por el curso/materia de arriba.',
        action: 'Completá el título y guardá la actividad.',
        target: '[data-spa-view="actividades"] [data-activity-form] input[name="titulo"]',
      },
      {
        title: 'Enviar a otro curso',
        body: 'Podés copiar el mismo material a otro curso o materia sin rehacerlo.',
        connects: 'El destino usa cursos y materias ya cargados.',
        target: '[data-spa-view="actividades"] [data-activity-list]',
      },
    ],
  },
  herramientas: {
    title: 'Excel — alumnos',
    tips: [
      {
        title: 'Lo más rápido',
        body: 'Con una planilla cargás escuela, curso, materias y alumnos de una sola vez.',
        action: 'Quedate en la pestaña Alumnos.',
        connects: 'Es el camino recomendado para armar el aula.',
        target: '[data-spa-view="herramientas"] [data-tools-tab="alumnos"]',
      },
      {
        title: 'Descargá un ejemplo',
        body: 'Si no tenés planilla, bajá el ejemplo y completalo con tus datos reales.',
        action: 'Hacé clic en “Descargar ejemplo”.',
        target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-download-example]',
      },
      {
        title: 'Columnas clave',
        body: 'Obligatorios: Escuela, Curso, Turno y Nombre. Materias opcionales, separadas por coma.',
        action: 'Abrí “Estructura” si querés ver un ejemplo.',
        example: 'Escuela Técnica 1 | 6to 1ra | Mañana | Martina Ruiz | Matemática, Programación',
        target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] .excel-reference',
      },
      {
        title: 'Subí el archivo',
        body: 'Arrastrá el .xlsx/.xls o elegilo desde tu dispositivo.',
        action: 'Usá esta zona de carga.',
        target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-dropzone]',
      },
      {
        title: 'Confirmá columnas',
        body: 'Revisá que cada columna coincida (Nombre, Curso, etc.). Si tu Excel es distinto, mapeá a mano o usá “Reconocer con IA”.',
        action: 'Cuando esté listo, importá abajo.',
        target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-mapping-panel]',
      },
      {
        title: 'Importar',
        body: 'Al importar se crean escuela, curso, materias y alumnos juntos.',
        action: 'Hacé clic en “Importar alumnos”.',
        target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-submit]',
      },
    ],
  },
};

/** Intro común: bienvenida + elección de camino. */
/** @type {TutorialStep[]} */
export const SETUP_TUTORIAL_INTRO = [
  {
    id: 'welcome',
    view: 'panel',
    target: null,
    title: 'Armá tu aula en minutos',
    body: 'La forma más rápida es importar alumnos con Excel: en un solo archivo entran escuela, curso, materias y listado.',
    action: 'Tocá “Empezar” para elegir cómo cargar.',
    connects: 'También podés cargar a mano, pero Excel suele ahorrarte mucho tiempo.',
    advance: 'next',
  },
  {
    id: 'path-choice',
    view: 'panel',
    target: null,
    title: '¿Cómo querés cargar?',
    body: 'Recomendamos Excel si ya tenés (o podés armar) una planilla. Es el camino más veloz.',
    action: 'Elegí una opción.',
    advance: 'choice',
    choices: [
      {
        id: 'path-excel',
        path: 'excel',
        label: 'Excel (recomendado)',
        hint: 'Más rápido · escuela, curso, materias y alumnos juntos',
        recommended: true,
      },
      {
        id: 'path-manual',
        path: 'manual',
        label: 'A mano',
        hint: 'Curso y alumnos uno por uno',
      },
    ],
  },
];

/** Guía interactiva Excel → alumnos. */
/** @type {TutorialStep[]} */
export const SETUP_TUTORIAL_EXCEL = [
  {
    id: 'open-excel',
    view: null,
    target: '[data-spa-nav="herramientas"]',
    title: 'Ir a Excel',
    body: 'Acá importás planillas. Es el atajo para armar el aula completa.',
    action: 'Hacé clic en “Excel” o “Importar alumnos”.',
    advance: 'click',
  },
  {
    id: 'excel-alumnos-tab',
    view: 'herramientas',
    prepare: 'excel-alumnos',
    target: '[data-spa-view="herramientas"] [data-tools-tab="alumnos"]',
    title: 'Pestaña Alumnos',
    body: 'Vas a cargar el listado de alumnos (no asistencias ni notas todavía).',
    action: 'Confirmá “Alumnos” o hacé clic si no está activa.',
    advance: 'click',
    optionalTarget: true,
  },
  {
    id: 'excel-download',
    view: 'herramientas',
    prepare: 'excel-alumnos',
    target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-download-example]',
    title: 'Descargá un ejemplo',
    body: 'Si no tenés planilla, bajá el ejemplo, abrilo y reemplazá con tus datos reales.',
    action: 'Hacé clic en “Descargar ejemplo”.',
    advance: 'click',
    optionalTarget: true,
  },
  {
    id: 'excel-columns',
    view: 'herramientas',
    prepare: 'excel-alumnos',
    target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] .excel-reference',
    title: 'Qué columnas usar',
    body: 'Obligatorios: Escuela, Curso, Turno y Nombre. Materias van separadas por coma (ej. Matemática, Programación).',
    action: 'Podés abrir “Estructura” para ver la tabla de ejemplo.',
    example: 'Escuela Técnica 1 · 6to 1ra · Mañana · Martina Ruiz · Matemática, Programación',
    connects: 'Si tu Excel tiene otros nombres de columna, después los mapeás.',
    advance: 'next',
  },
  {
    id: 'excel-upload',
    view: 'herramientas',
    prepare: 'excel-alumnos',
    target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-dropzone]',
    title: 'Subí el archivo',
    body: 'Arrastrá el .xlsx / .xls o elegilo desde el dispositivo.',
    action: 'Hacé clic en la zona de carga y seleccioná el archivo.',
    advance: 'change',
  },
  {
    id: 'excel-mapping',
    view: 'herramientas',
    prepare: 'excel-alumnos',
    target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-mapping-panel]',
    title: 'Confirmá las columnas',
    body: 'La app detecta encabezados. Revisá que Nombre, Curso, Escuela, etc. coincidan. Si hace falta, usá “Reconocer con IA”.',
    action: 'Revisá el mapeo. Si el panel aún no apareció, subí el archivo o tocá “Siguiente”.',
    optionalTarget: true,
    advance: 'next',
  },
  {
    id: 'excel-import',
    view: 'herramientas',
    prepare: 'excel-alumnos',
    target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-submit]',
    title: 'Importar alumnos',
    body: 'Al importar se crean escuela, curso, materias y alumnos juntos.',
    action: 'Hacé clic en “Importar alumnos”, o “Siguiente” si ya lo hiciste.',
    advance: 'click',
  },
];

/** Camino manual (más lento). */
/** @type {TutorialStep[]} */
export const SETUP_TUTORIAL_MANUAL = [
  {
    id: 'open-cursos',
    view: null,
    target: '[data-spa-nav="cursos"]',
    title: 'Ir a Cursos',
    body: 'Sin Excel, primero armamos la escuela y el curso.',
    action: 'Hacé clic en “Cursos”.',
    connects: 'Tip: si después conseguís una planilla, Excel sigue siendo más rápido.',
    advance: 'click',
  },
  {
    id: 'year',
    view: 'cursos',
    target: '[data-spa-view="cursos"] [data-cycle-active]',
    title: 'Año lectivo',
    body: 'Este selector es el año de trabajo. Solo vas a ver datos de ese año.',
    action: 'Dejá el año actual (o el que uses) y seguí.',
    example: '2026',
    advance: 'next',
  },
  {
    id: 'school-name',
    view: 'cursos',
    target: '[data-spa-view="cursos"] [data-new-school]',
    title: 'Nombre de la escuela',
    body: 'Escribí el nombre de tu escuela en este campo.',
    action: 'Hacé clic en el campo y escribí el nombre.',
    example: 'Escuela Demo',
    advance: 'input',
  },
  {
    id: 'add-school',
    view: 'cursos',
    target: '[data-spa-view="cursos"] [data-add-school]',
    title: 'Guardar la escuela',
    body: 'Con el nombre escrito, agregala a la lista.',
    action: 'Hacé clic en “Añadir escuela”.',
    advance: 'click',
  },
  {
    id: 'pick-school',
    view: 'cursos',
    target: '[data-spa-view="cursos"] [data-course-school]',
    title: 'Elegir la escuela',
    body: 'Seleccioná la escuela en este desplegable.',
    action: 'Hacé clic y elegí una escuela.',
    advance: 'change',
  },
  {
    id: 'course-name',
    view: 'cursos',
    target: '[data-spa-view="cursos"] [data-course-form] input[name="nombre"]',
    title: 'Nombre del curso',
    body: 'Ahora el curso o división.',
    action: 'Escribí el curso en este campo.',
    example: '6to 1ra',
    advance: 'input',
  },
  {
    id: 'course-turno',
    view: 'cursos',
    target: '[data-spa-view="cursos"] [data-course-form] select[name="turno"]',
    title: 'Turno',
    body: 'Elegí mañana, tarde o noche.',
    action: 'Hacé clic y elegí un turno.',
    example: 'Mañana',
    advance: 'change',
  },
  {
    id: 'create-course',
    view: 'cursos',
    target: '[data-spa-view="cursos"] [data-course-form] button[type="submit"]',
    title: 'Crear el curso',
    body: 'Si ya elegiste escuela arriba, guardá el curso.',
    action: 'Hacé clic en “Crear curso”. Si ya tenés cursos, tocá “Siguiente”.',
    advance: 'click',
  },
  {
    id: 'open-alumnos',
    view: null,
    target: '[data-spa-nav="registro"]',
    title: 'Ir a Alumnos',
    body: 'Con el curso listo, cargamos alumnos. Recordá: con Excel podrías haber cargado el listado entero de una vez.',
    action: 'Hacé clic en “Alumnos”.',
    advance: 'click',
  },
  {
    id: 'student-name',
    view: 'registro',
    target: '[data-spa-view="registro"] [data-student-form] input[name="nombre"]',
    title: 'Nombre del alumno',
    body: 'Empezá por el nombre completo.',
    action: 'Escribí el nombre acá.',
    example: 'Ana Pérez',
    advance: 'input',
  },
  {
    id: 'student-subject',
    view: 'registro',
    target: '[data-spa-view="registro"] [data-student-new-subject]',
    title: 'Materia del alumno',
    body: 'Agregá al menos una materia. Eso habilita lista y notas (en Excel va en la columna Materias).',
    action: 'Escribí la materia.',
    example: 'Matemática',
    advance: 'input',
  },
  {
    id: 'add-subject',
    view: 'registro',
    target: '[data-spa-view="registro"] [data-student-add-subject]',
    title: 'Agregar materia',
    body: 'Sumala a la lista del alumno.',
    action: 'Hacé clic en “Agregar materia”.',
    advance: 'click',
  },
  {
    id: 'save-student',
    view: 'registro',
    target: '[data-spa-view="registro"] [data-student-form] button[type="submit"]',
    title: 'Guardar alumno',
    body: 'Completá escuela y curso del formulario si faltan, y guardá.',
    action: 'Hacé clic en “Guardar alumno”, o “Siguiente” si ya sabés cómo.',
    advance: 'click',
  },
];

/** Después de cargar el aula: contexto, asistencia, notas, actividades. */
/** @type {TutorialStep[]} */
export const SETUP_TUTORIAL_AFTER = [
  {
    id: 'pick-context',
    view: null,
    target: '[data-gtc-toggle], [data-gtc-open]',
    title: 'Elegir curso actual',
    body: 'Arriba elegís qué curso y materia estás usando. Eso filtra Asistencia, Notas y Actividades.',
    action: 'Hacé clic en “Cambiar” o “Elegir ahora”.',
    connects: 'Sin esto, esas pantallas no saben qué lista mostrar.',
    advance: 'click',
  },
  {
    id: 'open-asistencia',
    view: null,
    target: '[data-spa-nav="asistencia"]',
    title: 'Ir a Asistencia',
    body: 'Ya podés pasar lista del curso elegido.',
    action: 'Hacé clic en “Asistencia”.',
    advance: 'click',
  },
  {
    id: 'asistencia-save',
    view: 'asistencia',
    target: '[data-spa-view="asistencia"] [data-attendance-save]',
    title: 'Pasar lista',
    body: 'Marcá presentes/ausentes y guardá al final.',
    action: 'Mirálos y, cuando quieras, tocá “Siguiente”.',
    optionalTarget: true,
    advance: 'next',
  },
  {
    id: 'open-notas',
    view: null,
    target: '[data-spa-nav="notas"]',
    title: 'Ir a Notas',
    body: 'Acá cargás calificaciones del mismo curso y materia de arriba.',
    action: 'Hacé clic en “Notas”.',
    advance: 'click',
  },
  {
    id: 'notas-intro',
    view: 'notas',
    target: '[data-spa-view="notas"] [data-grades-take-view]',
    title: 'Cargar notas',
    body: 'La planilla usa el curso activo. Ingresá calificaciones y guardá.',
    action: 'Explorá la pantalla y seguí cuando quieras.',
    optionalTarget: true,
    advance: 'next',
  },
  {
    id: 'open-actividades',
    view: null,
    target: '[data-spa-nav="actividades"]',
    title: 'Ir a Actividades',
    body: 'Creá un TP o evaluación para el curso. Cierra el circuito del aula.',
    action: 'Hacé clic en “Actividades”.',
    advance: 'click',
  },
  {
    id: 'activity-title',
    view: 'actividades',
    target: '[data-spa-view="actividades"] [data-activity-form] input[name="titulo"]',
    title: 'Crear una actividad',
    body: 'Poné un título (ej. Evaluación integradora) y guardá cuando esté lista.',
    action: 'Escribí un título o usá el ejemplo.',
    example: 'Evaluación integradora',
    advance: 'input',
  },
  {
    id: 'done',
    view: 'actividades',
    target: '[data-spa-view="actividades"] [data-activity-form] [data-activity-save-label]',
    title: 'Listo',
    body: 'Ya conocés el flujo: Excel para cargar rápido, curso actual arriba, y después Asistencia, Notas y Actividades. El menú “?” vuelve a abrir guías.',
    action: 'Tocá “Terminar” para cerrar el tutorial.',
    connects: 'La guía de Excel y de cada panel sigue disponible cuando quieras.',
    advance: 'next',
  },
];

/**
 * @param {TutorialPath | null | undefined} path
 * @returns {TutorialStep[]}
 */
export function buildSetupTutorial(path) {
  const branch = path === 'manual' ? SETUP_TUTORIAL_MANUAL : SETUP_TUTORIAL_EXCEL;
  if (!path) return [...SETUP_TUTORIAL_INTRO];
  return [...SETUP_TUTORIAL_INTRO, ...branch, ...SETUP_TUTORIAL_AFTER];
}

/** @deprecated Usar buildSetupTutorial(path). Mantiene compatibilidad de imports. */
export const SETUP_TUTORIAL = buildSetupTutorial('excel');

/**
 * @param {string} view
 * @returns {PanelGuide | null}
 */
export function getPanelGuide(view) {
  return PANEL_GUIDES[view] || null;
}
