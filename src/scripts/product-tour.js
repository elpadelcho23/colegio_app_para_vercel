import { productGuidesKey, productTourKey } from '../lib/client-storage-keys.ts';
import { showAppToast } from './app-feedback.js';
import { showSpaView } from './spa-router.ts';
import { navigateToToolsSection } from './tools-ui.js';
import { closeMenu, openMenu } from './ui-nav.js';

/**
 * Tutoriales guiados (patrón SaaS: checklist corta + guías bajo demanda).
 * - Tutorial inicial: 5 pasos del camino crítico (mapa → curso → alumnos → lista → ayuda).
 * - Guías temáticas: se desbloquean al terminar/omitir el inicial; 2–4 pasos cada una.
 * - Acciones reales cuando se puede; softRequire si el aula aún no tiene datos.
 */

const HELP_STEP = {
  id: 'mas-guias',
  view: 'panel',
  title: 'Más ayuda en “?”',
  body: 'Abrimos el menú de ayuda. Ahí quedan guías cortas (Excel, lista, notas, cursos) para cuando las necesites.',
  bodyShort: 'En “?” hay más guías cortas.',
  why: 'El resto se aprende cuando hace falta, no todo de golpe.',
  actionHint: 'Tocá Listo',
  target: '[data-help-menu]',
  preferTarget: '[data-tour-guides], [data-help-menu]',
  openHelp: true,
  previewGuides: true,
  require: 'next',
  nextLabel: 'Listo',
  card: 'top',
};

const CURSO_STEP = {
  id: 'curso-actual',
  view: 'panel',
  title: 'Elegí el curso de hoy',
  body: 'En Curso actual elegí escuela, curso y materia. Después tocá “Usar este curso”.',
  bodyShort: 'Curso + materia → Usar este curso.',
  why: 'Asistencia y notas usan siempre esta elección.',
  actionHint: 'Confirmá con “Usar este curso”',
  target: '[data-global-teaching-context]',
  openGtc: true,
  softChrome: true,
  require: 'teaching-context',
  allowSkipIf: 'teaching-context',
  skipLabel: 'Ya está elegido',
  autoAdvance: true,
};

const LISTA_STEP = {
  id: 'asistencia',
  view: 'asistencia',
  title: 'Pasá lista',
  body: 'Marcá Presente o Ausente en un alumno. Si todavía no hay lista, usá “Todavía no hay alumnos”.',
  bodyShort: 'Tocá Presente o Ausente.',
  why: 'Es el uso diario más común.',
  actionHint: 'Tocá Presente o Ausente',
  target: '[data-spa-view="asistencia"] [data-attendance-list]',
  require: 'click',
  requireClick: '[data-spa-view="asistencia"] [data-attendance-list] button',
  allowSkipIf: 'no-students',
  skipLabel: 'Todavía no hay alumnos',
  autoAdvance: true,
  card: 'top',
};

const EXCEL_STEPS = [
  {
    id: 'excel-subir',
    view: 'herramientas',
    title: 'Subí el listado',
    body: 'En Importar → Alumnos, tocá la zona blanca y elegí el Excel (.xlsx). Si ya tenés alumnos, usá “Ya tengo alumnos”.',
    bodyShort: 'Subí el Excel o “Ya tengo alumnos”.',
    why: 'Un archivo arma escuela, curso y alumnos juntos.',
    actionHint: 'Elegí un archivo Excel',
    target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-dropzone]',
    openToolsHub: 'importar',
    require: 'excel-file',
    allowSkipIf: 'students',
    skipLabel: 'Ya tengo alumnos',
    autoAdvance: true,
    card: 'top',
  },
  {
    id: 'excel-columnas',
    view: 'herramientas',
    title: 'Confirmá las columnas',
    body: 'Revisá que Nombre, Curso, Escuela y Turno coincidan. Si tu planilla es distinta, mapeá a mano.',
    bodyShort: 'Revisá el mapeo de columnas.',
    why: 'Si una columna está mal, los alumnos no entran.',
    actionHint: 'Cuando el mapeo aparezca, tocá Siguiente',
    target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-mapping-panel]',
    preferTarget: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-dropzone]',
    openToolsHub: 'importar',
    require: 'excel-mapping',
    allowSkipIf: 'students',
    skipLabel: 'Ya tengo alumnos',
    autoAdvance: true,
    card: 'top',
  },
  {
    id: 'excel-importar',
    view: 'herramientas',
    title: 'Importá los alumnos',
    body: 'Tocá “Importar alumnos”. Eso crea escuela, curso, materias y el listado.',
    bodyShort: 'Tocá Importar alumnos.',
    why: 'Sin este paso el archivo no entra al aula.',
    actionHint: 'Tocá Importar alumnos',
    target: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-submit]',
    openToolsHub: 'importar',
    require: 'excel-imported',
    requireClick: '[data-spa-view="herramientas"] [data-tools-panel="alumnos"] [data-excel-submit]',
    allowSkipIf: 'students',
    skipLabel: 'Ya tengo alumnos',
    autoAdvance: true,
    card: 'top',
  },
  CURSO_STEP,
  LISTA_STEP,
  HELP_STEP,
];

const MANUAL_STEPS = [
  {
    id: 'manual-escuela',
    view: 'cursos',
    title: 'Añadí tu escuela',
    body: 'Escribí el nombre y tocá “Añadir escuela”. Si ya existe, usá “Ya tengo escuela”.',
    bodyShort: 'Añadí la escuela.',
    why: 'Los cursos cuelgan de una escuela.',
    actionHint: 'Tocá Añadir escuela',
    target: '[data-spa-view="cursos"] [data-add-school]',
    preferTarget: '[data-spa-view="cursos"] [data-new-school]',
    require: 'click',
    requireClick: '[data-spa-view="cursos"] [data-add-school]',
    allowSkipIf: 'courses',
    skipLabel: 'Ya tengo escuela',
    autoAdvance: true,
  },
  {
    id: 'manual-curso',
    view: 'cursos',
    title: 'Creá un curso',
    body: 'Completá escuela, nombre (ej. 6to 1ra) y turno. Tocá “Crear curso”.',
    bodyShort: 'Creá el curso.',
    why: 'Sin curso no hay lista ni notas.',
    actionHint: 'Tocá Crear curso',
    target: '[data-spa-view="cursos"] [data-course-form] button[type="submit"]',
    preferTarget: '[data-spa-view="cursos"] [data-course-form]',
    require: 'click',
    requireClick: '[data-spa-view="cursos"] [data-course-form] button[type="submit"]',
    allowSkipIf: 'courses',
    skipLabel: 'Ya tengo curso',
    autoAdvance: true,
  },
  {
    id: 'manual-alumno',
    view: 'registro',
    title: 'Guardá un alumno',
    body: 'Completá nombre, escuela, curso y una materia. Tocá “Guardar alumno”.',
    bodyShort: 'Guardá un alumno.',
    why: 'Con un alumno ya podés probar la lista.',
    actionHint: 'Tocá Guardar alumno',
    target: '[data-spa-view="registro"] [data-student-form] button[type="submit"]',
    preferTarget: '[data-spa-view="registro"] [data-student-form]',
    require: 'click',
    requireClick: '[data-spa-view="registro"] [data-student-form] button[type="submit"]',
    allowSkipIf: 'students',
    skipLabel: 'Ya tengo alumnos',
    autoAdvance: true,
  },
  CURSO_STEP,
  LISTA_STEP,
  HELP_STEP,
];

const PATH_CHOICE_STEP = {
  id: 'camino',
  view: 'panel',
  title: '¿Cómo armás el aula?',
  body: 'Excel carga escuela, curso y alumnos de una vez. A mano es de a uno: escuela → curso → alumno.',
  bodyShort: 'Elegí Excel o a mano.',
  why: 'El primer paso concreto es elegir el camino. Si salís, podés retomar acá.',
  actionHint: 'Elegí Excel o A mano',
  target: '[data-onboarding], [data-panel-hero]',
  require: 'choice',
  choices: [
    { id: 'excel', label: 'Excel (recomendado)', hint: 'Más rápido' },
    { id: 'manual', label: 'A mano', hint: 'Uno por uno' },
  ],
};

function buildBasicTour(path) {
  const steps = path === 'manual' ? [PATH_CHOICE_STEP, ...MANUAL_STEPS] : path === 'excel'
    ? [PATH_CHOICE_STEP, ...EXCEL_STEPS]
    : [PATH_CHOICE_STEP];
  return { id: 'basico', title: 'Tutorial inicial', path: path || '', steps };
}

const BASIC_TOUR = buildBasicTour('excel');

const TOPIC_GUIDES = {
  curso: {
    id: 'curso',
    title: 'Guía: Curso actual',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'curso-abrir',
        view: 'panel',
        title: 'Abrí el selector',
        body: 'Tocá “Cambiar” abajo a la izquierda para abrir escuela, curso y materia.',
        bodyShort: 'Tocá “Cambiar”.',
        why: 'Todo el trabajo del día depende de esta elección.',
        actionHint: 'Tocá Cambiar',
        target: '[data-gtc-toggle], [data-global-teaching-context]',
        softChrome: true,
        require: 'click',
        requireClick: '[data-gtc-toggle], [data-gtc-open]',
        autoAdvance: true,
      },
      {
        id: 'curso-guardar',
        view: 'panel',
        title: 'Confirmá la selección',
        body: 'Elegí curso y materia y tocá “Usar este curso”.',
        bodyShort: 'Confirmá curso y materia.',
        why: 'Así Asistencia y Notas ya saben en qué aula estás.',
        actionHint: 'Tocá “Usar este curso”',
        target: '[data-global-teaching-context]',
        openGtc: true,
        softChrome: true,
        require: 'teaching-context',
        autoAdvance: true,
      },
    ],
  },
  excel: {
    id: 'excel',
    title: 'Guía: Importar Excel',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'excel-ir',
        view: 'herramientas',
        title: 'Importar Datos',
        body: 'En Herramientas → Importar Datos cargás alumnos, asistencias y notas en lote.',
        bodyShort: 'Importá alumnos, asistencias y notas acá.',
        why: 'Es el camino más rápido para armar el aula.',
        actionHint: 'Tocá Seguir',
        target: '[data-spa-view="herramientas"] [data-tools-hub-tabs], [data-spa-view="herramientas"] [data-tools-section="excel"]',
        openToolsHub: 'importar',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'excel-subir',
        view: 'herramientas',
        title: 'Subí el archivo',
        body: 'Tocá la zona de carga o elegí un archivo Excel.',
        bodyShort: 'Tocá para subir el Excel.',
        why: 'Con un archivo cargás muchos alumnos de una vez.',
        actionHint: 'Tocá la zona de carga',
        target: '[data-spa-view="herramientas"] [data-excel-dropzone], [data-spa-view="herramientas"] [data-excel-file]',
        openToolsHub: 'importar',
        require: 'click',
        requireClick:
          '[data-spa-view="herramientas"] [data-excel-dropzone], [data-spa-view="herramientas"] [data-excel-file], [data-spa-view="herramientas"] [data-excel-workspace-form] input[type="file"]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'excel-referencia',
        view: 'herramientas',
        title: 'Si falla el mapeo',
        body: 'Abrí “Ver estructura de referencia” para ver las columnas esperadas.',
        bodyShort: 'Abrí la estructura de referencia.',
        why: 'Te evita errores de columnas mal detectadas.',
        actionHint: 'Abrí la referencia',
        target: '[data-spa-view="herramientas"] .excel-reference, [data-spa-view="herramientas"] .excel-workspace',
        openToolsHub: 'importar',
        require: 'click',
        requireClick: '[data-spa-view="herramientas"] .excel-reference summary, [data-spa-view="herramientas"] .excel-reference',
        softRequire: true,
        autoAdvance: true,
      },
    ],
  },
  asistencia: {
    id: 'asistencia',
    title: 'Guía: Pasar lista',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'asis-contexto',
        view: 'asistencia',
        title: 'Mirá el Curso actual',
        body: 'La lista usa el Curso actual del encabezado. Si no es el correcto, cambialo.',
        bodyShort: 'Revisá el Curso actual.',
        why: 'Evita pasar lista del curso equivocado.',
        actionHint: 'Tocá Seguir cuando el curso esté bien',
        target: '[data-global-teaching-context], [data-attendance-take-view]',
        softChrome: true,
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'asis-marcar',
        view: 'asistencia',
        title: 'Marcá alumnos',
        body: 'Tocá Presente o Ausente. Si no hay alumnos, importá con Excel y volvé.',
        bodyShort: 'Tocá Presente o Ausente.',
        why: 'Un toque por alumno alcanza.',
        actionHint: 'Tocá Presente o Ausente',
        target: '[data-spa-view="asistencia"] [data-attendance-list], [data-spa-view="asistencia"] [data-attendance-take-view]',
        require: 'click',
        requireClick:
          '[data-spa-view="asistencia"] [data-attendance-list] button, [data-spa-view="asistencia"] [data-attendance-take-view] button, [data-spa-view="asistencia"] [data-attendance-take-view]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'asis-guardar',
        view: 'asistencia',
        title: 'Guardá los cambios',
        body: 'Cuando marques asistencia, aparece Guardar abajo. Tocá esa barra si la ves; si no, Seguí.',
        bodyShort: 'Tocá Guardar abajo si aparece.',
        why: 'Sin guardar, la lista no queda registrada.',
        actionHint: 'Tocá Guardar (o Seguí)',
        target: '[data-spa-view="asistencia"] [data-attendance-save-bar], [data-spa-view="asistencia"] [data-attendance-take-view]',
        require: 'click',
        requireClick: '[data-spa-view="asistencia"] [data-attendance-save-bar]',
        softRequire: true,
        autoAdvance: true,
      },
    ],
  },
  notas: {
    id: 'notas',
    title: 'Guía: Cargar notas',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'notas-contexto',
        view: 'notas',
        title: 'Mismo curso',
        body: 'Las notas siguen el Curso actual del encabezado.',
        bodyShort: 'Usan el Curso actual.',
        why: 'Así el promedio del Panel se actualiza solo.',
        actionHint: 'Tocá Seguir',
        target: '[data-global-teaching-context], [data-grades-take-view]',
        softChrome: true,
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'notas-cargar',
        view: 'notas',
        title: 'Cargá una nota',
        body: 'Tocá un campo de calificación o el listado. Si no hay alumnos, Seguí.',
        bodyShort: 'Tocá un campo o el listado.',
        why: 'La carga es alumno por alumno, en el mismo curso.',
        actionHint: 'Tocá un campo de nota',
        target: '[data-spa-view="notas"] [data-grade-bulk-list], [data-spa-view="notas"] [data-grades-take-view]',
        require: 'click',
        requireClick:
          '[data-spa-view="notas"] [data-grade-bulk-list] input, [data-spa-view="notas"] [data-grade-bulk-list], [data-spa-view="notas"] [data-grades-take-view]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'notas-guardar',
        view: 'notas',
        title: 'Guardá calificaciones',
        body: 'Si hay cambios, Guardar aparece abajo. Tocá esa barra; si no está, Seguí.',
        bodyShort: 'Tocá Guardar abajo si aparece.',
        why: 'Las notas se sincronizan cuando guardás.',
        actionHint: 'Tocá Guardar (o Seguí)',
        target: '[data-spa-view="notas"] [data-grades-save-bar], [data-spa-view="notas"] [data-grades-take-view]',
        require: 'click',
        requireClick: '[data-spa-view="notas"] [data-grades-save-bar]',
        softRequire: true,
        autoAdvance: true,
      },
    ],
  },
  ciclo: {
    id: 'ciclo',
    title: 'Guía: Ciclo escolar',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'ciclo-cursos',
        view: 'cursos',
        title: 'Cursos arriba',
        body: 'Arriba están “Nuevo curso” y “Cursos activos”. Más abajo está el ciclo anual, que filtra qué divisiones ves.',
        bodyShort: 'Los cursos van arriba; el ciclo, abajo.',
        why: 'Primero las divisiones, y más abajo el año lectivo.',
        actionHint: 'Tocá el panel o Seguí',
        target: '[data-spa-view="cursos"] [data-course-workspace], [data-spa-view="cursos"] [data-course-form]',
        require: 'click',
        requireClick:
          '[data-spa-view="cursos"] [data-course-workspace], [data-spa-view="cursos"] [data-course-form], [data-spa-view="cursos"] [data-course-list]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'ciclo-activo',
        view: 'cursos',
        title: 'Elegí el ciclo activo',
        body: 'El ciclo es el año lectivo. Solo ves cursos, alumnos y horarios de ese año. Cambialo acá cuando pases de 2026 a 2027, por ejemplo.',
        bodyShort: 'Elegí el año lectivo activo.',
        why: 'Si el ciclo está mal, parece que “faltan” cursos o alumnos.',
        actionHint: 'Tocá el selector o Seguí',
        target: '[data-spa-view="cursos"] [data-cycle-active], [data-spa-view="cursos"] [data-school-cycle]',
        require: 'click',
        requireClick: '[data-spa-view="cursos"] [data-cycle-active]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'ciclo-clonar',
        view: 'cursos',
        title: 'Reutilizar un ciclo anterior',
        body: 'Abrí este bloque para copiar escuelas, cursos y horarios a un año nuevo. Los alumnos del ciclo viejo no se mezclan.',
        bodyShort: 'Copiá la estructura a un año nuevo.',
        why: 'Así no volvés a cargar 6to 1ra a mano cada marzo.',
        actionHint: 'Tocá el bloque o Seguí',
        target: '[data-spa-view="cursos"] [data-cycle-clone]',
        openCycleClone: true,
        require: 'click',
        requireClick: '[data-spa-view="cursos"] [data-cycle-clone]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'ciclo-campos',
        view: 'cursos',
        title: 'Origen y destino',
        body: 'Elegí de qué ciclo copiar, a qué año crear (ej. 2027) y si también querés los bloques de horario. Después tocá “Clonar estructura al nuevo ciclo”.',
        bodyShort: 'Copiar desde → crear ciclo → clonar.',
        why: 'El destino tiene que ser un año distinto al origen.',
        actionHint: 'Tocá el botón o Seguí',
        target: '[data-spa-view="cursos"] [data-cycle-clone-submit], [data-spa-view="cursos"] [data-cycle-clone]',
        openCycleClone: true,
        require: 'click',
        requireClick: '[data-spa-view="cursos"] [data-cycle-clone-submit]',
        softRequire: true,
        nextLabel: 'Listo',
      },
    ],
  },
  cursos: {
    id: 'cursos',
    title: 'Guía: Crear cursos',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'cursos-ir',
        view: 'cursos',
        title: 'Sección Cursos',
        body: 'Acá creás escuelas, divisiones y cursos (también desde Excel). El ciclo escolar queda más abajo.',
        bodyShort: 'Acá creás cursos y escuelas.',
        why: 'Sin curso no hay alumnos ni lista.',
        actionHint: 'Tocá Seguir',
        target: '[data-spa-view="cursos"] [data-course-workspace], [data-spa-view="cursos"] [data-course-form]',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'cursos-escuela',
        view: 'cursos',
        title: 'Añadí una escuela',
        body: 'Escribí el nombre y tocá “Añadir escuela”, o tocá el campo para practicar.',
        bodyShort: 'Tocá el campo o “Añadir escuela”.',
        why: 'La escuela agrupa tus cursos.',
        actionHint: 'Tocá el campo de escuela',
        target: '[data-spa-view="cursos"] [data-new-school], [data-spa-view="cursos"] [data-add-school]',
        require: 'click',
        requireClick:
          '[data-spa-view="cursos"] [data-new-school], [data-spa-view="cursos"] [data-add-school]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'cursos-form',
        view: 'cursos',
        title: 'Creá un curso',
        body: 'Completá escuela, nombre y turno. Tocá el formulario o “Crear curso”.',
        bodyShort: 'Tocá el formulario de nuevo curso.',
        why: 'Después vas a elegir ese curso como “Curso actual”.',
        actionHint: 'Tocá el formulario',
        target: '[data-spa-view="cursos"] [data-course-form]',
        require: 'click',
        requireClick: '[data-spa-view="cursos"] [data-course-form]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'cursos-lista',
        view: 'cursos',
        title: 'Revisá cursos activos',
        body: 'Los cursos creados aparecen acá. Tocá el panel para ubicarlo.',
        bodyShort: 'Tocá el panel de cursos activos.',
        why: 'Confirmás que el curso quedó listo para usar.',
        actionHint: 'Tocá el listado de cursos',
        target: '[data-spa-view="cursos"] [data-course-list]',
        preferTarget: '[data-spa-view="cursos"] .responsive-grid > .panel',
        require: 'click',
        requireClick:
          '[data-spa-view="cursos"] [data-course-list], [data-spa-view="cursos"] .responsive-grid > .panel',
        softRequire: true,
        autoAdvance: true,
      },
    ],
  },
  actividades: {
    id: 'actividades',
    title: 'Guía: Actividades',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'act-ir',
        view: 'actividades',
        title: 'El flujo de actividades',
        body: 'Orden típico: Crear → Clase virtual → Entregas → Corregir.',
        bodyShort: 'Crear, clase, entregas y corregir.',
        why: 'Cada pestaña es una etapa del trabajo.',
        actionHint: 'Tocá Seguir',
        target: '[data-spa-view="actividades"] [data-activity-flow-tabs], [data-spa-view="actividades"] .page-header',
        openActivityTab: 'contenido',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'act-crear',
        view: 'actividades',
        title: 'Creá una actividad',
        body: 'Tocá el formulario o el título para practicar la carga.',
        bodyShort: 'Tocá el formulario de crear.',
        why: 'Desde acá nacen las actividades del curso.',
        actionHint: 'Tocá el formulario',
        target: '[data-spa-view="actividades"] [data-activity-form], [data-spa-view="actividades"] [data-activity-workspace]',
        openActivityTab: 'contenido',
        require: 'click',
        requireClick:
          '[data-spa-view="actividades"] [data-activity-form], [data-spa-view="actividades"] [data-activity-workspace]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'act-clase',
        view: 'actividades',
        title: 'Clase virtual',
        body: 'Tocá la pestaña “Clase virtual” para armar un link de clase.',
        bodyShort: 'Tocá “Clase virtual”.',
        why: 'Los alumnos entran con un link, sin instalar nada.',
        actionHint: 'Tocá “Clase virtual”',
        target: '[data-spa-view="actividades"] [data-activity-flow-tab="clase"]',
        openActivityTab: 'contenido',
        require: 'click',
        requireClick: '[data-spa-view="actividades"] [data-activity-flow-tab="clase"]',
        autoAdvance: true,
      },
      {
        id: 'act-entregas',
        view: 'actividades',
        title: 'Entregas y corregir',
        body: 'Tocá “Recibir entregas” o “Corregir” para ver esas etapas.',
        bodyShort: 'Tocá Entregas o Corregir.',
        why: 'Ahí cerrás el ciclo de la actividad.',
        actionHint: 'Tocá Entregas o Corregir',
        target: '[data-spa-view="actividades"] [data-activity-flow-tabs]',
        openActivityTab: 'clase',
        require: 'click',
        requireClick:
          '[data-spa-view="actividades"] [data-activity-flow-tab="entregas"], [data-spa-view="actividades"] [data-activity-flow-tab="corregir"]',
        softRequire: true,
        autoAdvance: true,
      },
    ],
  },
  herramientas: {
    id: 'herramientas',
    title: 'Guía: Cuenta e instalar',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'herr-ir',
        view: 'herramientas',
        title: 'Herramientas',
        body: 'Acá están Importar Datos, Cuenta / Instalar e Informes / Comunicados.',
        bodyShort: 'Importar, cuenta e informes.',
        why: 'Es el lugar de operaciones, no del día a día.',
        actionHint: 'Tocá Seguir',
        target: '[data-spa-view="herramientas"] .page-header, [data-spa-view="herramientas"] [data-tools-hub-tabs]',
        openToolsHub: 'importar',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'herr-cuenta',
        view: 'herramientas',
        title: 'Cuenta / Instalar',
        body: 'Tocá la pestaña “Cuenta / Instalar”.',
        bodyShort: 'Tocá “Cuenta / Instalar”.',
        why: 'Ahí sincronizás e instalás la app.',
        actionHint: 'Tocá la pestaña Cuenta',
        target: '[data-spa-view="herramientas"] [data-tools-hub-tab="cuenta"]',
        openToolsHub: 'importar',
        require: 'click',
        requireClick: '[data-spa-view="herramientas"] [data-tools-hub-tab="cuenta"]',
        autoAdvance: true,
      },
      {
        id: 'herr-sync',
        view: 'herramientas',
        title: 'Sincronizar',
        body: 'Tocá “Sincronizar ahora” si ves cambios pendientes. Si no hace falta, Seguí.',
        bodyShort: 'Tocá “Sincronizar ahora” (o Seguí).',
        why: 'Mantiene los datos alineados entre dispositivos.',
        actionHint: 'Tocá Sincronizar (o Seguí)',
        target: '[data-spa-view="herramientas"] [data-sync-button], [data-spa-view="herramientas"] [data-sync-tools]',
        openToolsHub: 'cuenta',
        require: 'click',
        requireClick: '[data-spa-view="herramientas"] [data-sync-button]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'herr-install',
        view: 'herramientas',
        title: 'Instalá la app',
        body: 'Tocá Instalar o abrí “Cómo instalar según el dispositivo”.',
        bodyShort: 'Tocá Instalar o la ayuda.',
        why: 'En el celular se siente como app nativa.',
        actionHint: 'Tocá Instalar o la ayuda',
        target: '[data-spa-view="herramientas"] [data-pwa-install], [data-spa-view="herramientas"] [data-tools-section="install"]',
        openToolsHub: 'cuenta',
        require: 'click',
        requireClick:
          '[data-spa-view="herramientas"] [data-tools-section="install"] [data-pwa-install-btn], [data-spa-view="herramientas"] [data-pwa-install-help]',
        softRequire: true,
        autoAdvance: true,
      },
    ],
  },
  panel: {
    id: 'panel',
    title: 'Guía: Panel y resumen',
    unlockAfterBasic: true,
    steps: [
      {
        id: 'panel-hoy',
        view: 'panel',
        title: 'Hoy en el Panel',
        body: 'El Panel resume el día. Desde acá saltás a Asistencia, Actividades o Importar.',
        bodyShort: 'Atajos del día en el Panel.',
        why: 'Es tu punto de partida cada mañana.',
        actionHint: 'Tocá Seguir',
        target: '[data-spa-view="panel"] [data-panel-hero]',
        require: 'next',
        nextLabel: 'Seguir',
      },
      {
        id: 'panel-resumen',
        view: 'panel',
        title: 'Tarjetas del Resumen',
        body: 'Tocá una tarjeta (Alumnos, Cursos, Promedio o Asistencia) para abrir esa sección.',
        bodyShort: 'Tocá una tarjeta del Resumen.',
        why: 'Son atajos, no solo números.',
        actionHint: 'Tocá una tarjeta',
        target: '[data-spa-view="panel"] [data-dashboard], [data-spa-view="panel"] [data-panel-summary]',
        require: 'click',
        requireClick:
          '[data-spa-view="panel"] [data-dashboard] .metric--link, [data-spa-view="panel"] [data-dashboard] [data-spa-nav], [data-spa-view="panel"] [data-dashboard]',
        softRequire: true,
        autoAdvance: true,
      },
      {
        id: 'panel-seguimiento',
        view: 'panel',
        title: 'Seguimiento',
        body: 'Abajo está el seguimiento del curso. Tocá ese panel para ubicarlo.',
        bodyShort: 'Tocá Seguimiento.',
        why: 'Te muestra cómo viene el curso en el tiempo.',
        actionHint: 'Tocá Seguimiento',
        target: '[data-spa-view="panel"] [data-seguimiento]',
        require: 'click',
        requireClick: '[data-spa-view="panel"] [data-seguimiento]',
        softRequire: true,
        autoAdvance: true,
      },
    ],
  },
};

function getTourRaw(userId) {
  if (!userId) return '';
  return localStorage.getItem(productTourKey(userId)) || '';
}

function parseTourRecord(userId) {
  const raw = getTourRaw(userId);
  if (!raw) return { status: '' };
  if (raw === 'done' || raw === 'skipped') return { status: raw };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* ignore */
  }
  return { status: raw };
}

function getTourStatus(userId) {
  return parseTourRecord(userId).status || '';
}

function isBasicUnlocked(userId) {
  const status = getTourStatus(userId);
  return status === 'done' || status === 'skipped';
}

function setTourStatus(userId, value) {
  if (!userId) return;
  if (value && typeof value === 'object') {
    localStorage.setItem(productTourKey(userId), JSON.stringify(value));
    return;
  }
  localStorage.setItem(productTourKey(userId), String(value || ''));
}

function readStorageList(key) {
  try {
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function classroomFlag(flag) {
  if (flag === 'students') return readStorageList('aula_clara_students').length > 0;
  if (flag === 'no-students') return readStorageList('aula_clara_students').length === 0;
  if (flag === 'courses') return readStorageList('aula_clara_courses').length > 0;
  if (flag === 'teaching-context') return teachingContextReady();
  return false;
}

function readGuides(userId) {
  if (!userId) return {};
  try {
    return JSON.parse(localStorage.getItem(productGuidesKey(userId)) || '{}') || {};
  } catch {
    return {};
  }
}

function markGuideDone(userId, guideId) {
  if (!userId || !guideId) return;
  const current = readGuides(userId);
  current[guideId] = 'done';
  localStorage.setItem(productGuidesKey(userId), JSON.stringify(current));
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 1023px)').matches;
}

function stepBody(step) {
  if (isMobileViewport() && step.bodyShort) return step.bodyShort;
  return step.body;
}

function waitForPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isVisible(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.closest('.spa-view--hidden')) return false;
  if (node.hasAttribute('hidden') || node.classList.contains('is-hidden')) return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function pickTarget(selector) {
  if (!selector) return null;
  return [...document.querySelectorAll(selector)].find((node) => isVisible(node)) || null;
}

function gtcFormIsOpen() {
  return isVisible(document.querySelector('[data-gtc-form]'));
}

/**
 * Elige el ancla del spotlight.
 * Si el form de Curso actual ya está abierto (o el paso lo abre), priorizar el form
 * para no dejar el recuadro en la posición vieja del botón “Cambiar”.
 */
function resolveStepTarget(step) {
  if (!step) return null;
  const preferForm = Boolean(step.openGtc) || gtcFormIsOpen();
  if (preferForm) {
    return pickTarget(step.target) || pickTarget(step.preferTarget);
  }
  return pickTarget(step.preferTarget) || pickTarget(step.target);
}

function openGtcForTour() {
  const root = document.querySelector('[data-global-teaching-context]');
  const form = root?.querySelector('[data-gtc-form]');
  if (!(form instanceof HTMLElement) || !(root instanceof HTMLElement)) return;

  // Marcar antes de abrir: refreshGlobalTeachingContextUi respeta gtc--tour-open
  // y no vuelve a ocultar el form (si no, el spotlight queda flotando sobre el menú).
  root.classList.add('gtc--tour-open');

  // Abrir por el mismo camino que “Elegir ahora” (no togglear Cambiar: cerraría el form).
  const openTrigger = document.querySelector('[data-gtc-open]');
  if (openTrigger instanceof HTMLElement) {
    openTrigger.click();
  } else {
    form.classList.remove('is-hidden');
    form.hidden = false;
  }

  root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeGtcTourState() {
  const root = document.querySelector('[data-global-teaching-context]');
  if (!(root instanceof HTMLElement)) return;
  root.classList.remove('gtc--tour-open');
}

function teachingContextReady(detail) {
  if (detail?.cursoId && detail?.materiaId) return true;
  const summary = document.querySelector('[data-gtc-summary]')?.textContent || '';
  return Boolean(summary && !/elegí curso/i.test(summary));
}

/**
 * @param {{ getUserId: () => string | null }} options
 */
export function initProductTour({ getUserId }) {
  const overlay = ensureTourOverlay();
  const progress = ensureTourProgress();
  let activeTour = null;
  let stepIndex = 0;
  let running = false;
  let stepCompleted = false;
  let actionCleanup = null;
  let layoutCleanup = null;
  let spotlightSyncTimer = 0;
  let autoAdvanceTimer = 0;

  const refreshHelpMenu = () => {
    const basicDone = isBasicUnlocked(getUserId());
    document.querySelectorAll('[data-tour-guides]').forEach((block) => {
      block.hidden = !basicDone;
      block.classList.toggle('is-hidden', !basicDone);
    });
    const guides = readGuides(getUserId());
    document.querySelectorAll('[data-tour-start]').forEach((btn) => {
      const id = btn.getAttribute('data-tour-start');
      if (!id || id === 'basico') return;
      btn.classList.toggle('is-guide-done', guides[id] === 'done');
    });
  };

  const stopActionWatch = () => {
    actionCleanup?.();
    actionCleanup = null;
  };

  const stopLayoutWatch = () => {
    window.clearTimeout(spotlightSyncTimer);
    window.clearTimeout(autoAdvanceTimer);
    layoutCleanup?.();
    layoutCleanup = null;
  };

  const cheer = () => {
    progress.showCheer('¡Bien!');
  };

  const isMenuStep = (step) => Boolean(step?.openMenuOnMobile && isMobileViewport());

  const persistBasicProgress = (index) => {
    if (activeTour?.id !== 'basico') return;
    setTourStatus(getUserId(), {
      status: 'in_progress',
      path: activeTour.path || '',
      stepIndex: index,
    });
  };

  const finishTour = (status) => {
    running = false;
    stopActionWatch();
    stopLayoutWatch();
    const tourId = activeTour?.id || 'basico';
    if (tourId === 'basico') {
      if (status === 'paused') {
        persistBasicProgress(stepIndex);
      } else {
        setTourStatus(getUserId(), status);
      }
    } else if (status === 'done') {
      markGuideDone(getUserId(), tourId);
    }

    overlay.clearSpotlight();
    overlay.close();
    progress.hide();
    closeMenu();
    closeGtcTourState();
    document.querySelector('[data-help-menu]')?.removeAttribute('open');
    document.body.classList.remove(
      'product-tour-active',
      'product-tour-menu-step',
      'product-tour-soft-chrome',
    );
    activeTour = null;
    refreshHelpMenu();
    window.dispatchEvent(new CustomEvent('aula-clara:local-data-changed'));
    window.dispatchEvent(new CustomEvent('aula-clara:onboarding-visibility'));
  };

  const applySpotlight = (step, { scroll = false } = {}) => {
    if (!step) return;
    // Si el paso necesita el form y se cerró, reabrirlo antes de medir.
    if (step.openGtc && !gtcFormIsOpen()) {
      openGtcForTour();
    }
    const menuStep = isMenuStep(step);
    const target = resolveStepTarget(step);
    if (target && !menuStep) {
      if (scroll) {
        const inStickyChrome = Boolean(target.closest('.app-shell'));
        target.scrollIntoView({
          behavior: 'smooth',
          block: inStickyChrome ? 'nearest' : 'center',
          inline: 'nearest',
        });
      }
      overlay.setSpotlight(target);
      return;
    }
    if (target && menuStep) {
      overlay.clearSpotlight();
      overlay.rememberTarget(target);
      return;
    }
    overlay.clearSpotlight();
  };

  /** Reposiciona el spotlight tras abrir “Cambiar” / cambios de layout del sidebar. */
  const syncSpotlight = ({ scroll = false } = {}) => {
    if (!running || !activeTour) return;
    const step = activeTour.steps[stepIndex];
    if (!step) return;
    applySpotlight(step, { scroll });
  };

  const scheduleSpotlightSync = ({ scroll = false, delay = 0 } = {}) => {
    window.clearTimeout(spotlightSyncTimer);
    spotlightSyncTimer = window.setTimeout(() => {
      void (async () => {
        await waitForPaint();
        await wait(40);
        syncSpotlight({ scroll });
        // Segunda pasada: el flex del sidebar a veces termina de acomodarse después.
        await wait(160);
        await waitForPaint();
        syncSpotlight({ scroll: false });
      })();
    }, delay);
  };

  const watchLayoutForSpotlight = (step) => {
    stopLayoutWatch();
    if (!step || isMenuStep(step)) return;

    const cleanups = [];
    const onLayout = () => scheduleSpotlightSync({ delay: 16 });

    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    cleanups.push(() => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    });

    const shell = document.querySelector('.app-shell');
    const gtc = document.querySelector('[data-global-teaching-context]');
    const form = gtc?.querySelector('[data-gtc-form]');
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(onLayout);
      if (shell) ro.observe(shell);
      if (gtc) ro.observe(gtc);
      if (form) ro.observe(form);
      cleanups.push(() => ro.disconnect());
    }

    if (typeof MutationObserver !== 'undefined' && form) {
      const mo = new MutationObserver(onLayout);
      mo.observe(form, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
      cleanups.push(() => mo.disconnect());
    }

    // Al tocar Cambiar/Elegir, el form abre y el sidebar reflowea: el spotlight fijo
    // quedaba “congelado” a media altura (sobre Avanzado / Excel).
    const onGtcInteract = (event) => {
      const hit = event.target?.closest?.('[data-gtc-toggle], [data-gtc-open], [data-gtc-form]');
      if (!hit) return;
      scheduleSpotlightSync({ delay: 30 });
    };
    document.addEventListener('click', onGtcInteract, true);
    cleanups.push(() => document.removeEventListener('click', onGtcInteract, true));

    layoutCleanup = () => {
      cleanups.forEach((fn) => fn());
    };
  };

  const completeStepAction = () => {
    if (!running || stepCompleted) return;
    stepCompleted = true;
    cheer();
    progress.setProgress(stepIndex + 1, activeTour.steps.length);
    overlay.setNextEnabled(true);
    const step = activeTour.steps[stepIndex];
    const nextBtn = document.querySelector('[data-tour-next]');
    if (nextBtn instanceof HTMLButtonElement) {
      const isLast = stepIndex >= activeTour.steps.length - 1;
      nextBtn.textContent = isLast
        ? (step?.nextLabel || 'Listo')
        : (step?.autoAdvance ? 'Siguiente…' : (step?.nextLabel || 'Siguiente'));
    }
    // Tras completar (ej. Cambiar), el layout puede haber movido el ancla.
    scheduleSpotlightSync({ delay: 30 });

    if (step?.autoAdvance) {
      window.clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = window.setTimeout(() => {
        if (!running || !stepCompleted) return;
        void showStep(stepIndex + 1);
      }, 900);
    }
  };

  const watchStepAction = (step) => {
    stopActionWatch();
    stepCompleted = false;
    window.clearTimeout(autoAdvanceTimer);

    if (!step.require || step.require === 'next') {
      stepCompleted = true;
      overlay.setNextEnabled(true);
      return;
    }

    const skipAllowed = Boolean(step.allowSkipIf && classroomFlag(step.allowSkipIf));
    overlay.setNextEnabled(skipAllowed);
    if (skipAllowed) {
      const nextBtn = document.querySelector('[data-tour-next]');
      if (nextBtn instanceof HTMLButtonElement) {
        nextBtn.textContent = step.skipLabel || 'Ya está';
      }
    }

    const cleanups = [];

    if (step.require === 'choice') {
      overlay.setChoices(step.choices || []);
      overlay.setNextEnabled(false);
      actionCleanup = () => overlay.setChoices([]);
      return;
    }

    if (step.require === 'teaching-context') {
      const onContext = (event) => {
        if (teachingContextReady(event.detail)) completeStepAction();
      };
      window.addEventListener('aula-clara:teaching-context-changed', onContext);
      cleanups.push(() => window.removeEventListener('aula-clara:teaching-context-changed', onContext));
    }

    if (step.require === 'excel-file') {
      const onFile = () => completeStepAction();
      window.addEventListener('aula-clara:excel-file-selected', onFile);
      cleanups.push(() => window.removeEventListener('aula-clara:excel-file-selected', onFile));
    }

    if (step.require === 'excel-mapping') {
      const onMap = () => completeStepAction();
      window.addEventListener('aula-clara:excel-mapping-ready', onMap);
      if (isVisible(document.querySelector('[data-spa-view="herramientas"] [data-excel-mapping-panel]'))) {
        completeStepAction();
      }
      cleanups.push(() => window.removeEventListener('aula-clara:excel-mapping-ready', onMap));
    }

    if (step.require === 'excel-imported') {
      const onImported = () => completeStepAction();
      window.addEventListener('aula-clara:excel-imported', onImported);
      cleanups.push(() => window.removeEventListener('aula-clara:excel-imported', onImported));
    }

    if (step.require === 'click') {
      const selector = step.requireClick || step.target;
      const onClick = (event) => {
        const hit = event.target?.closest?.(selector);
        if (!hit) return;
        completeStepAction();
      };
      const onChange = (event) => {
        const hit = event.target?.closest?.(selector);
        if (!hit) return;
        completeStepAction();
      };
      document.addEventListener('click', onClick, true);
      document.addEventListener('change', onChange, true);
      cleanups.push(() => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('change', onChange, true);
      });
    }

    actionCleanup = () => {
      cleanups.forEach((fn) => fn());
    };
  };

  const showStep = async (index) => {
    if (!activeTour) return;
    stepIndex = index;
    const step = activeTour.steps[index];
    if (!step) {
      finishTour('done');
      return;
    }

    running = true;
    stopLayoutWatch();
    document.body.classList.add('product-tour-active');
    closeMenu();
    closeGtcTourState();
    showSpaView(step.view);
    await waitForPaint();

    const menuStep = isMenuStep(step);
    const softChrome = Boolean(step.softChrome);
    document.body.classList.toggle('product-tour-menu-step', menuStep);
    document.body.classList.toggle('product-tour-soft-chrome', softChrome && !menuStep);
    overlay.setMenuMode(menuStep);
    overlay.setSoftChrome(softChrome && !menuStep);

    progress.show({
      label: activeTour.title,
      current: index,
      total: activeTour.steps.length,
    });

    persistBasicProgress(index);
    overlay.setCardPlacement(step.card === 'top' ? 'top' : 'bottom');

    if (step.openGtc) {
      openGtcForTour();
      await waitForPaint();
      await wait(40);
    }

    if (step.openCycleClone) {
      document.querySelectorAll('[data-cycle-clone]').forEach((el) => {
        if (el instanceof HTMLDetailsElement) el.open = true;
      });
      await waitForPaint();
    }

    if (step.openToolsHub) {
      const hub = String(step.openToolsHub || '').toLowerCase();
      if (hub === 'cuenta' || hub === 'sync' || hub === 'install') navigateToToolsSection('cuenta');
      else if (hub === 'informes' || hub === 'comunicados') navigateToToolsSection('informes');
      else navigateToToolsSection('importar');
      await waitForPaint();
      await wait(40);
    }

    if (step.openActivityTab) {
      window.dispatchEvent(
        new CustomEvent('aula-clara:open-activity-flow', {
          detail: { tab: step.openActivityTab },
        }),
      );
      await waitForPaint();
      await wait(40);
    }

    if (step.previewGuides) {
      document.querySelectorAll('[data-tour-guides]').forEach((block) => {
        block.hidden = false;
        block.classList.remove('is-hidden');
      });
    }

    if (menuStep) {
      openMenu();
      await waitForPaint();
    }

    if (step.openHelp || step.openHelpOnMobile) {
      document.querySelector('[data-help-menu]')?.setAttribute('open', '');
      await waitForPaint();
    } else if (!menuStep) {
      document.querySelector('[data-help-menu]')?.removeAttribute('open');
    }

    const target = resolveStepTarget(step);
    if (target && !menuStep) {
      const inStickyChrome = Boolean(target.closest('.app-shell'));
      target.scrollIntoView({
        behavior: 'smooth',
        block: inStickyChrome ? 'nearest' : 'center',
        inline: 'nearest',
      });
      await wait(120);
      await waitForPaint();
      overlay.setSpotlight(target);
    } else if (target && menuStep) {
      target.classList.add('tour-target-active');
      overlay.clearSpotlight();
      overlay.rememberTarget(target);
    } else {
      overlay.clearSpotlight();
    }

    watchLayoutForSpotlight(step);
    watchStepAction(step);
    scheduleSpotlightSync({ delay: 180 });

    const needsAction = step.require && step.require !== 'next' && step.require !== 'choice';
    const skipAllowed = Boolean(step.allowSkipIf && classroomFlag(step.allowSkipIf));
    let nextLabel = step.nextLabel;
    if (!nextLabel) {
      if (skipAllowed && !stepCompleted) nextLabel = step.skipLabel || 'Ya está';
      else nextLabel = 'Siguiente';
    }

    overlay.open({
      title: step.title,
      body: stepBody(step),
      why: step.why || '',
      actionHint: step.actionHint || (needsAction ? 'Completá la acción marcada' : ''),
      stepLabel: `Paso ${index + 1} de ${activeTour.steps.length}`,
      choices: step.require === 'choice' ? step.choices : [],
      onChoice: (choiceId) => {
        if (choiceId !== 'excel' && choiceId !== 'manual') return;
        activeTour = buildBasicTour(choiceId);
        persistBasicProgress(1);
        void showStep(1);
      },
      onNext: () => {
        window.clearTimeout(autoAdvanceTimer);
        if (!stepCompleted && needsAction && !skipAllowed) {
          overlay.nudge(step.actionHint || 'Completá el paso marcado para seguir.');
          return;
        }
        void showStep(index + 1);
      },
      onSkip: () => finishTour('paused'),
      isLast: index === activeTour.steps.length - 1,
      nextLabel,
      nextEnabled: stepCompleted || skipAllowed || !needsAction,
    });
  };

  const startTourById = (tourId = 'basico') => {
    if (running) return;
    if (tourId !== 'basico') {
      const tour = TOPIC_GUIDES[tourId];
      if (!tour) return;
      if (tour.unlockAfterBasic && !isBasicUnlocked(getUserId())) {
        showAppToast('Primero terminá o omití el tutorial inicial. Después se desbloquean las guías.', 'warning');
        return;
      }
      activeTour = tour;
      document.querySelector('[data-help-menu]')?.removeAttribute('open');
      closeMenu();
      void showStep(0);
      return;
    }

    const record = parseTourRecord(getUserId());
    const path = record.path === 'manual' || record.path === 'excel' ? record.path : '';
    activeTour = buildBasicTour(path || '');
    document.querySelector('[data-help-menu]')?.removeAttribute('open');
    closeMenu();
    const resumeAt = record.status === 'in_progress' && Number.isInteger(record.stepIndex)
      ? Math.max(0, record.stepIndex)
      : 0;
    void showStep(Math.min(resumeAt, activeTour.steps.length - 1));
  };

  document.querySelectorAll('[data-product-tour-start], [data-setup-tutorial-start], [data-tour-start]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      if (btn.hasAttribute('data-setup-tutorial-start')) return;
      event.preventDefault();
      const id = btn.getAttribute('data-tour-start') || 'basico';
      startTourById(id);
    });
  });

  window.addEventListener('aula-clara:local-data-changed', refreshHelpMenu);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && running) {
      event.preventDefault();
      finishTour('paused');
    }
  });
  refreshHelpMenu();

  return {
    startTour: () => startTourById('basico'),
    startTourById,
    refreshHelpMenu,
  };
}

function ensureTourProgress() {
  let root = document.querySelector('[data-tour-progress]');
  if (!root) {
    root = document.createElement('div');
    root.className = 'tour-progress is-hidden';
    root.setAttribute('data-tour-progress', '');
    root.setAttribute('hidden', '');
    root.innerHTML = `
      <div class="tour-progress-inner">
        <div class="tour-progress-meta">
          <span class="tour-progress-label" data-tour-progress-label>Tutorial</span>
          <span class="tour-progress-count" data-tour-progress-count>0/0</span>
          <span class="tour-progress-cheer is-hidden" data-tour-progress-cheer hidden>¡Bien!</span>
        </div>
        <div class="tour-progress-track" aria-hidden="true">
          <div class="tour-progress-fill" data-tour-progress-fill></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
  }

  const labelEl = root.querySelector('[data-tour-progress-label]');
  const countEl = root.querySelector('[data-tour-progress-count]');
  const fillEl = root.querySelector('[data-tour-progress-fill]');
  const cheerEl = root.querySelector('[data-tour-progress-cheer]');
  let cheerTimer = null;

  return {
    show({ label, current, total }) {
      if (labelEl) labelEl.textContent = label || 'Tutorial';
      if (countEl) countEl.textContent = `${Math.min(current + 1, total)}/${total}`;
      if (fillEl) fillEl.style.width = `${Math.round((current / Math.max(total, 1)) * 100)}%`;
      root.classList.remove('is-hidden');
      root.removeAttribute('hidden');
    },
    setProgress(completedSteps, total) {
      const safeTotal = Math.max(total, 1);
      const pct = Math.round((completedSteps / safeTotal) * 100);
      if (countEl) countEl.textContent = `${Math.min(completedSteps, total)}/${total}`;
      if (fillEl) fillEl.style.width = `${pct}%`;
    },
    showCheer(text = '¡Bien!') {
      if (!(cheerEl instanceof HTMLElement)) return;
      cheerEl.textContent = text;
      cheerEl.classList.remove('is-hidden');
      cheerEl.removeAttribute('hidden');
      cheerEl.classList.remove('is-pop');
      // reflow for animation restart
      void cheerEl.offsetWidth;
      cheerEl.classList.add('is-pop');
      window.clearTimeout(cheerTimer);
      cheerTimer = window.setTimeout(() => {
        cheerEl.classList.add('is-hidden');
        cheerEl.setAttribute('hidden', '');
        cheerEl.classList.remove('is-pop');
      }, 1600);
    },
    hide() {
      window.clearTimeout(cheerTimer);
      root.classList.add('is-hidden');
      root.setAttribute('hidden', '');
      if (cheerEl) {
        cheerEl.classList.add('is-hidden');
        cheerEl.setAttribute('hidden', '');
      }
      if (fillEl) fillEl.style.width = '0%';
    },
  };
}

function ensureTourOverlay() {
  let root = document.querySelector('[data-product-tour-overlay]');
  if (!root) {
    root = document.createElement('div');
    root.className = 'product-tour-overlay is-hidden';
    root.setAttribute('data-product-tour-overlay', '');
    root.setAttribute('hidden', '');
    root.innerHTML = `
      <div class="product-tour-backdrop" data-tour-backdrop></div>
      <div class="product-tour-spotlight is-hidden" data-tour-spotlight hidden></div>
      <div class="product-tour-card" role="dialog" aria-modal="true" aria-labelledby="product-tour-title">
        <p class="product-tour-step" data-tour-step></p>
        <h2 id="product-tour-title" data-tour-title></h2>
        <p class="product-tour-action is-hidden" data-tour-action hidden></p>
        <p data-tour-body></p>
        <p class="product-tour-why is-hidden" data-tour-why hidden></p>
        <p class="product-tour-nudge is-hidden" data-tour-nudge hidden></p>
        <div class="product-tour-choices is-hidden" data-tour-choices hidden></div>
        <div class="product-tour-actions">
          <button type="button" class="btn btn-ghost" data-tour-skip>Salir</button>
          <button type="button" class="btn btn-primary" data-tour-next>Siguiente</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
  }

  const card = root.querySelector('.product-tour-card');
  if (card && !card.querySelector('[data-tour-action]')) {
    const title = card.querySelector('#product-tour-title, [data-tour-title]');
    const action = document.createElement('p');
    action.className = 'product-tour-action is-hidden';
    action.setAttribute('data-tour-action', '');
    action.hidden = true;
    title?.after(action);
  }
  if (card && !card.querySelector('[data-tour-why]')) {
    const body = card.querySelector('[data-tour-body]');
    const why = document.createElement('p');
    why.className = 'product-tour-why is-hidden';
    why.setAttribute('data-tour-why', '');
    why.hidden = true;
    body?.after(why);
  }

  if (card && !card.querySelector('[data-tour-choices]')) {
    const actions = card.querySelector('.product-tour-actions');
    const choices = document.createElement('div');
    choices.className = 'product-tour-choices is-hidden';
    choices.setAttribute('data-tour-choices', '');
    choices.hidden = true;
    actions?.before(choices);
  }

  const titleEl = root.querySelector('[data-tour-title]');
  const bodyEl = root.querySelector('[data-tour-body]');
  const stepEl = root.querySelector('[data-tour-step]');
  const actionEl = root.querySelector('[data-tour-action]');
  const whyEl = root.querySelector('[data-tour-why]');
  const nudgeEl = root.querySelector('[data-tour-nudge]');
  const choicesEl = root.querySelector('[data-tour-choices]');
  const nextBtn = root.querySelector('[data-tour-next]');
  const skipBtn = root.querySelector('[data-tour-skip]');
  const spotlight = root.querySelector('[data-tour-spotlight]');
  const backdrop = root.querySelector('[data-tour-backdrop]');
  let onNext = null;
  let onSkip = null;
  let onChoice = null;
  let spotlightTarget = null;
  let nudgeTimer = null;

  const setChoices = (choices = []) => {
    if (!(choicesEl instanceof HTMLElement)) return;
    choicesEl.innerHTML = '';
    if (!choices.length) {
      choicesEl.classList.add('is-hidden');
      choicesEl.setAttribute('hidden', '');
      if (nextBtn) nextBtn.hidden = false;
      return;
    }
    choices.forEach((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${choice.id === 'excel' ? 'btn-primary' : 'btn-secondary'}`;
      btn.setAttribute('data-tour-choice', choice.id);
      btn.innerHTML = choice.hint
        ? `<strong>${choice.label}</strong><span>${choice.hint}</span>`
        : choice.label;
      btn.addEventListener('click', () => onChoice?.(choice.id));
      choicesEl.appendChild(btn);
    });
    choicesEl.classList.remove('is-hidden');
    choicesEl.removeAttribute('hidden');
    if (nextBtn) nextBtn.hidden = true;
  };

  const setCardPlacement = (placement) => {
    root.classList.toggle('product-tour-overlay--top', placement === 'top');
  };

  const setMetaLine = (node, text) => {
    if (!(node instanceof HTMLElement)) return;
    const value = String(text || '').trim();
    if (!value) {
      node.textContent = '';
      node.classList.add('is-hidden');
      node.setAttribute('hidden', '');
      return;
    }
    node.textContent = value;
    node.classList.remove('is-hidden');
    node.removeAttribute('hidden');
  };

  const clearSpotlight = () => {
    spotlightTarget?.classList.remove('tour-target-active');
    spotlightTarget = null;
    if (spotlight instanceof HTMLElement) {
      spotlight.classList.add('is-hidden');
      spotlight.setAttribute('hidden', '');
      spotlight.style.cssText = '';
    }
  };

  const rememberTarget = (target) => {
    spotlightTarget?.classList.remove('tour-target-active');
    spotlightTarget = target instanceof HTMLElement ? target : null;
    spotlightTarget?.classList.add('tour-target-active');
  };

  const setSpotlight = (target) => {
    if (!(target instanceof HTMLElement) || !(spotlight instanceof HTMLElement)) {
      clearSpotlight();
      return;
    }

    // Reusar el mismo target evita parpadeo al reposicionar tras abrir “Cambiar”.
    if (spotlightTarget !== target) {
      spotlightTarget?.classList.remove('tour-target-active');
      spotlightTarget = target;
      spotlightTarget.classList.add('tour-target-active');
    }

    const pad = 10;
    const rect = target.getBoundingClientRect();
    // Si el ancla quedó sin tamaño real (p. ej. mid-reflow), ocultar en vez de
    // dejar un cuadrado mínimo “flotando” a media altura del menú.
    if (rect.width < 2 || rect.height < 2) {
      spotlight.classList.add('is-hidden');
      spotlight.setAttribute('hidden', '');
      return;
    }

    const top = Math.max(6, rect.top - pad);
    const left = Math.max(6, rect.left - pad);
    const width = Math.min(window.innerWidth - left - 6, rect.width + pad * 2);
    const height = Math.min(window.innerHeight - top - 6, rect.height + pad * 2);

    spotlight.style.top = `${top}px`;
    spotlight.style.left = `${left}px`;
    spotlight.style.width = `${width}px`;
    spotlight.style.height = `${height}px`;
    spotlight.classList.remove('is-hidden');
    spotlight.removeAttribute('hidden');
  };

  const setMenuMode = (enabled) => {
    root.classList.toggle('product-tour-overlay--menu', enabled);
  };

  const setSoftChrome = (enabled) => {
    root.classList.toggle('product-tour-overlay--soft-chrome', enabled);
  };

  const setNextEnabled = (enabled) => {
    if (!(nextBtn instanceof HTMLButtonElement)) return;
    nextBtn.disabled = !enabled;
    nextBtn.classList.toggle('is-waiting', !enabled);
  };

  const nudge = (message) => {
    if (!(nudgeEl instanceof HTMLElement)) return;
    nudgeEl.textContent = message;
    nudgeEl.classList.remove('is-hidden');
    nudgeEl.removeAttribute('hidden');
    window.clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(() => {
      nudgeEl.classList.add('is-hidden');
      nudgeEl.setAttribute('hidden', '');
    }, 2200);
  };

  nextBtn?.addEventListener('click', () => onNext?.());
  skipBtn?.addEventListener('click', () => onSkip?.());
  backdrop?.addEventListener('click', (event) => {
    if (root.classList.contains('product-tour-overlay--menu')) return;
    event.preventDefault();
  });

  return {
    open({
      title,
      body,
      why = '',
      actionHint = '',
      stepLabel,
      choices = [],
      onNext: next,
      onSkip: skip,
      onChoice: choose,
      isLast,
      nextLabel,
      nextEnabled = true,
    }) {
      onNext = next;
      onSkip = skip;
      onChoice = choose;
      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.textContent = body;
      if (stepEl) stepEl.textContent = stepLabel;
      setMetaLine(actionEl, actionHint ? `Acción: ${actionHint}` : '');
      setMetaLine(whyEl, why ? `Por qué: ${why}` : '');
      setChoices(choices);
      if (nextBtn) {
        nextBtn.hidden = Boolean(choices?.length);
        nextBtn.textContent = isLast ? (nextLabel || 'Listo') : (nextLabel || 'Siguiente');
      }
      setNextEnabled(nextEnabled);
      if (nudgeEl) {
        nudgeEl.classList.add('is-hidden');
        nudgeEl.setAttribute('hidden', '');
      }
      root.classList.remove('is-hidden');
      root.removeAttribute('hidden');
    },
    close() {
      onNext = null;
      onSkip = null;
      onChoice = null;
      clearSpotlight();
      setChoices([]);
      setMenuMode(false);
      setSoftChrome(false);
      setCardPlacement('bottom');
      root.classList.add('is-hidden');
      root.setAttribute('hidden', '');
    },
    setSpotlight,
    clearSpotlight,
    rememberTarget,
    setMenuMode,
    setSoftChrome,
    setCardPlacement,
    setChoices,
    setNextEnabled,
    nudge,
  };
}

export { BASIC_TOUR, TOPIC_GUIDES };
