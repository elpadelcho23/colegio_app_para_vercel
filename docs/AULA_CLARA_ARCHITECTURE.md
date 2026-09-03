# AULA CLARA — ARCHITECTURE & DEVELOPMENT CONTEXT

## 1. PRODUCTO

Aula Clara es una plataforma web progresiva (PWA) para la gestión operativa y pedagógica de instituciones educativas.

El producto ya se encuentra en un estado avanzado de desarrollo.

NO estamos construyendo el producto desde cero.

Existe actualmente una aplicación funcional orientada principalmente al trabajo docente.

El objetivo de esta etapa es incorporar una capa institucional y administrativa sin romper ni rehacer las funcionalidades existentes.

---

## 2. ESTADO ACTUAL DEL PRODUCTO

Actualmente existen funcionalidades relacionadas con:

- autenticación;
- registro;
- inicio de sesión;
- gestión de ciclo lectivo;
- escuelas;
- cursos/divisiones;
- materias;
- alumnos;
- importación desde Excel;
- asistencia;
- historial de asistencia;
- calificaciones;
- promedios;
- actividades;
- generación de actividades mediante IA;
- herramientas;
- informes/comunicados;
- PWA;
- funcionamiento offline-first;
- IndexedDB;
- sincronización con servidor;
- backend SSR;
- base de datos SQLite/LibSQL/Turso;
- despliegue en Vercel.

La interfaz docente ya existe y está funcional.

NO reconstruir estas funcionalidades salvo que sea estrictamente necesario para integrar el nuevo modelo institucional.

---

## 3. OBJETIVO DE ESTA ETAPA

Construir:

### INSTITUTIONAL FOUNDATION V1

El objetivo es convertir Aula Clara en una plataforma donde:

> La institución posee y administra su espacio de datos y los usuarios acceden a él mediante membresías, roles y permisos.

El docente no debe ser considerado propietario de la institución.

El instituto es el propietario lógico de sus datos.

---

## 4. MODELO CONCEPTUAL

Modelo:

```
USER
 ↓
MEMBERSHIP
 ↓
INSTITUTION
```

Una cuenta de usuario representa una identidad.

Una membership representa la pertenencia de ese usuario a una institución.

Una institución representa el tenant.

NO asumir que:

```
user.role = admin
```

es suficiente para modelar autorización institucional.

---

## 5. MULTI-TENANCY

Cada institución constituye un tenant.

Los datos institucionales deben estar aislados.

Conceptualmente:

```
Institution A
 ├── Users
 ├── Schools
 ├── Courses
 ├── Subjects
 ├── Students
 ├── Attendance
 ├── Grades
 └── Activities

Institution B
 └── datos completamente separados
```

Un usuario autenticado no debe poder acceder a datos de otro tenant.

El backend debe determinar el tenant mediante la identidad autenticada y su membership.

NO confiar en un tenant_id arbitrario enviado desde el frontend.

---

## 6. AUTORIZACIÓN

La autorización debe seguir:

```
Request
 ↓
Authentication
 ↓
User
 ↓
Membership
 ↓
Institution
 ↓
Role
 ↓
Permission
 ↓
Resource ownership
 ↓
Database
```

Nunca basar seguridad únicamente en:

- botones ocultos;
- rutas frontend;
- IDs enviados por el cliente;
- estado visual de la interfaz.

La seguridad real debe existir en backend.

---

## 7. MEMBERSHIP

Conceptualmente debe existir una entidad equivalente a:

`institution_memberships`

Campos mínimos esperados:

- id
- institution_id
- user_id
- role
- status
- created_at
- updated_at
- revoked_at

No crear estos campos literalmente si la arquitectura existente utiliza otros nombres equivalentes.

Primero inspeccionar el código existente.

---

## 8. ESTADOS DE MEMBERSHIP

Utilizar conceptualmente:

- **PENDING** — Invitación creada pero todavía no aceptada.
- **ACTIVE** — Acceso permitido.
- **SUSPENDED** — Acceso temporalmente bloqueado.
- **REVOKED** — La institución retiró definitivamente el acceso.

Revocar una membership NO significa eliminar automáticamente el usuario.

NO eliminar datos históricos por revocar una membership.

---

## 9. ROLES

En esta etapa no implementar un sistema enorme de roles.

Mantener como mínimo conceptual:

- **INSTITUTION_ADMIN** — Administrador de la institución.
- **TEACHER** — Usuario docente existente.

No implementar todavía:

- FAMILY
- STUDENT
- PRECEPTOR
- DIRECTOR

salvo que sean necesarios por compatibilidad con código existente.

La arquitectura debe permitir agregarlos posteriormente.

---

## 10. ADMINISTRADOR INSTITUCIONAL

El administrador institucional puede:

- visualizar su institución;
- editar información institucional permitida;
- visualizar miembros;
- invitar usuarios;
- gestionar memberships;
- suspender usuarios;
- revocar acceso;
- reactivar usuarios;
- consultar actividad administrativa.

No puede:

- acceder a otros tenants;
- modificar datos de otra institución;
- convertirse arbitrariamente en superadmin;
- modificar configuración global de Aula Clara.

---

## 11. SUPERADMIN

Diferenciar estrictamente:

- **PLATFORM SUPERADMIN**
- **INSTITUTION ADMIN**

El superadmin administra la plataforma Aula Clara.

El institution admin administra una institución concreta.

No mezclar ambas responsabilidades.

---

## 12. INSTITUTION

La institución debe representar el espacio institucional.

Conceptualmente:

`institutions`

- id
- name
- slug
- email
- phone
- address
- logo_url
- status
- created_at
- updated_at

Pero:

**ANTES DE CREAR UNA TABLA NUEVA:**

1. buscar entidades existentes;
2. determinar si ya existe school/tenant/institution;
3. reutilizar cuando sea correcto;
4. evitar duplicar conceptos.

---

## 13. MIGRACIÓN DEL SISTEMA EXISTENTE

Este es un punto crítico.

El producto actual ya posee datos y funcionalidades.

NO hacer una reescritura.

Primero descubrir:

- cómo se relacionan users con schools;
- cómo se relacionan schools con courses;
- cómo se relacionan courses con subjects;
- cómo se relacionan courses con students;
- cómo se relacionan attendance con students/courses;
- cómo se relacionan grades con students/courses/subjects;
- cómo se relacionan activities con courses;
- cómo funciona actualmente tenant_id;
- cómo funciona actualmente la autenticación;
- cómo funciona actualmente la autorización.

Luego diseñar una estrategia de migración.

Toda migración debe preservar los datos existentes.

---

## 14. AUTENTICACIÓN

Actualmente el sistema permite registro e inicio de sesión.

Existe una deuda técnica:

El campo email puede aceptar texto que no necesariamente corresponde a un email válido/verificado.

Además actualmente no existe recuperación de contraseña mediante email.

Esto debe solucionarse.

Implementar conceptualmente:

### EMAIL VERIFICATION

```
Registro
 ↓
Crear cuenta
 ↓
Enviar email de verificación
 ↓
Usuario confirma
 ↓
email_verified = true
```

### PASSWORD RESET

```
Usuario solicita recuperación
 ↓
Introduce email
 ↓
Backend genera token seguro con expiración
 ↓
Enviar enlace
 ↓
Usuario establece nueva contraseña
```

Nunca enviar la contraseña existente por email.

Los tokens deben ser:

- aleatorios criptográficamente;
- de un solo uso;
- con expiración;
- almacenados de forma segura.

No implementar un proveedor de email ficticio.

Primero inspeccionar la infraestructura existente y elegir una implementación compatible con el stack actual.

---

## 15. INVITACIONES

El modelo futuro será:

```
Institution Admin
 ↓
Invite user
 ↓
Email invitation
 ↓
Accept invitation
 ↓
Create/login account
 ↓
Membership ACTIVE
```

No crear contraseñas para usuarios desde el panel administrativo.

---

## 16. REVOCACIÓN

La institución debe poder retirar el acceso de un usuario.

Ejemplo:

- **User:** Juan Pérez
- **Institution:** Instituto Técnico N.º 1
- **Membership:** REVOKED

Después de la revocación el backend debe impedir acceso a los recursos institucionales protegidos.

No borrar automáticamente:

- usuario;
- historial;
- registros;
- calificaciones;
- asistencia;
- auditoría.

---

## 17. AUDITORÍA

Crear o adaptar un sistema de audit logs.

Registrar acciones administrativas importantes:

- creación de institución;
- modificación de institución;
- invitación;
- aceptación;
- cambio de rol;
- suspensión;
- revocación;
- reactivación.

Conceptualmente:

`audit_logs`

- id
- institution_id
- actor_user_id
- action
- target_type
- target_id
- metadata
- created_at

No guardar información sensible innecesaria.

---

## 18. DOCENTE EXISTENTE

El docente actual NO debe perder funcionalidades.

Debe seguir pudiendo:

- seleccionar ciclo;
- seleccionar escuela;
- seleccionar curso;
- seleccionar materia;
- pasar asistencia;
- consultar historial;
- cargar calificaciones;
- utilizar actividades;
- utilizar herramientas;
- importar datos cuando corresponda.

La diferencia arquitectónica futura es que esos recursos pertenecerán a una institución y el docente accederá a ellos mediante membership/permisos.

No modificar UX docente innecesariamente durante esta etapa.

---

## 19. ASISTENCIA

Actualmente la asistencia permite:

- listado;
- modo individual;
- presente/ausente;
- guardado;
- historial;
- porcentajes.

Existe una regla futura importante:

Un alumno con asistencia inferior al 75% debe quedar académicamente comprometido/suspendido según las reglas institucionales.

Además se pretende incorporar el calendario de clases dictadas para calcular el porcentaje sobre:

- clases dictadas
- vs
- clases esperadas

NO implementar esta lógica en la fase institucional salvo que sea estrictamente necesaria.

Mantenerla como deuda funcional futura.

---

## 20. IMPORTACIÓN EXCEL

Actualmente existe importación de:

- alumnos;
- asistencias;
- notas;
- cursos.

También existen plantillas y mapeo de columnas.

NO eliminar esta funcionalidad.

La futura administración institucional deberá poder aprovecharla.

La importación debe quedar vinculada correctamente al tenant institucional.

---

## 21. DOCENTE VS PRECEPTOR

No resolver todavía esta cuestión mediante una nueva implementación de roles.

Actualmente el docente puede tomar asistencia y debe conservar esa capacidad.

En una fase posterior se podrá implementar:

- TEACHER
- PRECEPTOR

con permisos diferentes.

No limitar artificialmente la asistencia durante esta etapa.

---

## 22. UX ADMIN

El panel administrativo debe sentirse como parte de Aula Clara.

No crear un segundo producto visual.

Debe existir una navegación institucional clara.

Ejemplo conceptual:

- Panel
- Institución
- Usuarios
- Configuración

No llenar el dashboard de métricas ficticias.

Todas las estadísticas deben provenir de datos reales.

---

## 23. PRINCIPIOS DE DESARROLLO

Antes de modificar código:

1. inspeccionar;
2. comprender;
3. localizar implementaciones existentes;
4. identificar dependencias;
5. identificar migraciones;
6. proponer solución;
7. implementar;
8. ejecutar pruebas.

No asumir nombres de tablas o funciones.

No crear sistemas duplicados.

No crear una segunda autenticación.

No crear una segunda capa de sesiones.

No crear una segunda base de datos.

No reemplazar infraestructura existente sin justificarlo.

---

## 24. REGLA PRINCIPAL PARA CURSOR

El proyecto está avanzado.

Por lo tanto:

> **PRESERVAR antes que REESCRIBIR.**

Si existe una implementación funcional:

- reutilizarla;
- extenderla;
- adaptarla.

Solo reemplazarla cuando exista una razón técnica clara.

Antes de realizar un cambio arquitectónico importante, explicar:

1. problema;
2. arquitectura actual;
3. solución propuesta;
4. archivos afectados;
5. migraciones;
6. riesgo de regresión;
7. estrategia de rollback.

---

## 25. ORDEN DE IMPLEMENTACIÓN

| Fase | Alcance |
|------|---------|
| **FASE 0** | Auditoría |
| **FASE 1** | Email verification + password reset |
| **FASE 2** | Institution model |
| **FASE 3** | Membership model |
| **FASE 4** | Institution Admin |
| **FASE 5** | Institution dashboard |
| **FASE 6** | User/member management |
| **FASE 7** | Invitations |
| **FASE 8** | Suspension/revocation |
| **FASE 9** | Audit logs |
| **FASE 10** | Multi-tenant authorization tests |
| **FASE 11** | Integración con funcionalidades docentes existentes |
| **FASE 12** | Regression testing |

No avanzar automáticamente a la siguiente fase.

Cada fase debe ser verificable antes de comenzar la siguiente.

---

## 26. DEFINITION OF DONE

La fase institucional inicial estará terminada cuando:

- una institución puede existir;
- existe un administrador institucional;
- el administrador solo puede acceder a su institución;
- las memberships funcionan;
- los estados de membership funcionan;
- se puede revocar acceso;
- un usuario revocado no puede acceder;
- las invitaciones funcionan;
- los emails pueden verificarse;
- existe recuperación de contraseña;
- las acciones administrativas relevantes quedan auditadas;
- los datos están aislados por tenant;
- no se puede acceder a otro tenant manipulando requests;
- las funcionalidades docentes existentes continúan funcionando;
- las migraciones preservan datos;
- el build funciona;
- typecheck funciona;
- lint funciona si está configurado;
- los tests críticos pasan.

---

## 27. REGLA FINAL

No optimizar para cantidad de código.

Optimizar para:

- **SEGURIDAD**
- **MANTENIBILIDAD**
- **COMPATIBILIDAD**
- **AISLAMIENTO DE TENANTS**
- **EXPERIENCIA DE USUARIO**

Aula Clara debe poder evolucionar desde una aplicación docente hacia una plataforma institucional SaaS sin tener que reconstruir su núcleo.
