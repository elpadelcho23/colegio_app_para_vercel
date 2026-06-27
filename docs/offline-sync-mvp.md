# MVP offline + sync

## Archivos

- `src/scripts/offline-db.ts`: abre IndexedDB, guarda asistencias locales y crea `pending_operations`.
- `src/scripts/sync-client.ts`: lee operaciones pendientes y las envia a `/api/sync`.
- `src/pages/api/sync.ts`: endpoint SSR que aplica operaciones y evita duplicados con `clientMutationId`.
- `.data/sync-store.json`: almacenamiento temporal del servidor para probar el MVP.

## Flujo probado

1. El docente marca asistencia en `/asistencia`.
2. La UI actualiza `localStorage` para mantener compatibilidad con la pantalla existente.
3. La asistencia se guarda en IndexedDB en `attendance_records`.
4. Se crea una operacion en `pending_operations`.
5. Si hay conexion, `sync-client.ts` envia la operacion a `/api/sync`.
6. El servidor guarda la asistencia y registra el `clientMutationId`.
7. Si la misma operacion llega otra vez, responde `duplicate` y no duplica datos.

## Estructura de pending_operations

```ts
{
  id: string;
  clientMutationId: string;
  entity: 'attendance';
  action: 'upsert';
  payload: {
    id: string;
    studentId: string;
    subjectId: string;
    fecha: string;
    estado: 'presente' | 'ausente';
    updatedAt: string;
  };
  status: 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';
  attempts: number;
  createdAt: string;
  updatedAt: string;
}
```

## Prueba manual

1. Abrir `http://127.0.0.1:4321/asistencia`.
2. En DevTools, simular offline.
3. Marcar presente o ausente.
4. Volver online.
5. Presionar `Sincronizar` o esperar el evento `online`.
6. Revisar `.data/sync-store.json`.

Este MVP usa un archivo JSON como almacenamiento backend temporal. El siguiente paso natural es reemplazar esa escritura por SQLite usando el mismo contrato de `/api/sync`.
