# Confirmaciones de acciones destructivas — Design

**Fecha:** 2026-06-15
**Estado:** Aprobado
**Programa:** Mejora integral de UX del panel. Sub-proyecto **B** (claridad y feedback), pieza **B1**. (B2 = carga/errores; B3 = microcopy/ayudas; B4 = onboarding — specs aparte.)

## Objetivo

Que ninguna acción destructiva del panel (cancelar reserva, anular cobro, eliminar cancha/usuario/bloqueo/turno fijo) se ejecute de un solo clic. Cada una pide una confirmación clara, en español llano, nombrando lo que se va a afectar. Es la principal red de seguridad para que un empleado nuevo no "la cague" sin querer (sobre todo en mobile, donde un toque accidental es fácil).

## Contexto (estado actual)

Hoy la confirmación es **inconsistente**: algunas acciones usan `window.confirm()` **nativo** (feo, fuera del diseño, pobre en mobile) y otras **no confirman nada**. Detalle:
- Usan `window.confirm()` nativo (a reemplazar por el diálogo de marca): `eliminarCancha` (`canchas-table.tsx`, con un mensaje especial: borrar una divisible borra el grupo entero), `eliminarUsuario` (`usuarios-table.tsx`), `eliminarBloqueo` (`bloqueos-table.tsx`), `eliminarTurnoFijo` (`fijos/turnos-fijos-table.tsx`).
- **Sin confirmación** (a agregar): `cancelarReserva` y `anularCobro` (ver abajo).

Las acciones destructivas viven en menús desplegables / botones que llaman directo a la server action:
- `cancelarReserva` (en `reservas-table.tsx`, `hoy/accion-turno-sheet.tsx`, y `calendario/calendario-semana.tsx:172`).
- `anularCobro` (en `reservas/cobros-dialog.tsx`, `hoy/accion-turno-sheet.tsx`).
- `eliminarCancha` (`canchas/canchas-table.tsx`), `eliminarUsuario` (`usuarios/usuarios-table.tsx`), `eliminarBloqueo` (`bloqueos/bloqueos-table.tsx`), `eliminarTurnoFijo` (`fijos/turnos-fijos-table.tsx`).

Todas son funciones `async function` que devuelven `{ ok: true } | { ok: false; error: string }` y ya muestran toast de éxito/error vía un helper `act(...)`/`start(...)` en cada componente.

## Decisiones (confirmadas)

- **Mecanismo:** un hook imperativo `useConfirm()` con promesa, alimentado por un `ConfirmProvider` montado **una sola vez** en el `AppShell`. Renderiza **un único** diálogo compartido. Cada call site hace `if (await confirm(opts)) act(...)`.
- **Diálogo:** reusa el `Dialog` de Base UI existente (`@/components/ui/dialog`). Botón de confirmar en **rojo** cuando `destructive`; botón "Volver" para cancelar. Toques grandes (mobile).
- **Microcopy:** mensajes en criollo que nombran la cosa afectada.
- **Alcance:** solo agregar la confirmación. NO se toca la lógica de las acciones ni el backend.

## Alcance

### Componente nuevo — `src/components/ui/confirm.tsx`

- `ConfirmOptions`: `{ title: string; description?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }`.
- `ConfirmProvider({ children })`: tiene en estado la `ConfirmOptions` actual + una referencia al `resolve` de la promesa pendiente; renderiza `children` + un `Dialog` controlado.
- `useConfirm(): (opts: ConfirmOptions) => Promise<boolean>`: lee el provider por contexto; al llamarse, abre el diálogo y devuelve una promesa que resuelve `true` (confirmar) o `false` (cancelar / cerrar / Escape / click afuera).
- El diálogo:
  - `title` en el header; `description` (si hay) como texto.
  - Footer: botón "Volver" (cancela → resuelve `false`); botón de confirmar con `confirmLabel` (default `'Confirmar'`) — variante roja/`destructive` si `opts.destructive`.
  - Cerrar por cualquier vía (Escape, click afuera, botón X) resuelve `false`.
  - Default `cancelLabel = 'Volver'`.
- Si `useConfirm` se usa fuera del provider → lanza error claro en dev (no silencioso).

### Montaje — `src/components/app-shell.tsx`

Envolver el contenido del shell con `<ConfirmProvider>` para que todas las pantallas del panel puedan usar `useConfirm()`. (El `AppShell` ya envuelve todo el panel y es client.)

### Cableado de los call sites

En cada componente con acción destructiva, importar `useConfirm`, obtener `const confirm = useConfirm();`, y envolver el disparador. Patrón:

```tsx
onClick={async () => {
  if (await confirm({ title: '…', description: '…', confirmLabel: '…', destructive: true })) {
    act(() => accionDestructiva(id), 'Hecho');
  }
}}
```

(Los `MenuItem` de Base UI aceptan `onClick`; mantener su uso actual, solo envolver el cuerpo.)

Mensajes por acción (microcopy):
- **Cancelar reserva:** title `'¿Cancelar la reserva?'`, description `'Vas a cancelar la reserva de {cliente} del {fecha} {hora}. El cliente pierde el turno.'`, confirmLabel `'Cancelar turno'`. (`{cliente}`/`{fecha}`/`{hora}` desde la reserva en contexto; usar `fmtFechaHora`/`fmtHora` según disponible.)
- **Anular cobro:** title `'¿Anular el cobro?'`, description `'Vas a anular este cobro de ${monto}. Se vuelve a sumar al saldo.'`, confirmLabel `'Anular cobro'`.
- **Eliminar cancha:** title `'¿Eliminar la cancha?'`, description `'Vas a eliminar la cancha "{nombre}". No se puede deshacer.'`, confirmLabel `'Eliminar'`.
- **Eliminar usuario:** title `'¿Eliminar el usuario?'`, description `'Vas a eliminar a {nombre}. No se puede deshacer.'`, confirmLabel `'Eliminar'`.
- **Eliminar bloqueo:** title `'¿Eliminar el bloqueo?'`, description `'Vas a eliminar este bloqueo. No se puede deshacer.'`, confirmLabel `'Eliminar'`.
- **Eliminar turno fijo:** title `'¿Eliminar el turno fijo?'`, description `'Vas a eliminar el turno fijo de {cliente}. No se puede deshacer.'`, confirmLabel `'Eliminar'`.

Todos con `destructive: true`.

Call sites a tocar: `reservas/reservas-table.tsx`, `hoy/accion-turno-sheet.tsx` (cancelar + anular), `reservas/cobros-dialog.tsx` (anular), `canchas/canchas-table.tsx`, `usuarios/usuarios-table.tsx`, `bloqueos/bloqueos-table.tsx`, `fijos/turnos-fijos-table.tsx`, y `calendario/calendario-semana.tsx:172` (cancelar de reserva).

## Componentes y responsabilidades

- `ui/confirm.tsx` — provider + hook + diálogo único. Una sola responsabilidad: pedir confirmación.
- `app-shell.tsx` — monta el provider (cambio mínimo).
- Cada tabla/sheet — solo envuelve su disparador destructivo; sin estado de diálogo propio.

## Manejo de errores / bordes

- Si hay una confirmación pendiente y se dispara otra, la nueva reemplaza a la anterior (resolviendo la previa como `false`). Caso raro (un solo diálogo a la vez en la UI), pero se contempla para no dejar promesas colgadas.
- Cerrar sin confirmar siempre resuelve `false` (nunca ejecuta la acción).
- La acción en sí sigue manejando su propio toast de éxito/error como hoy (no cambia).

## Pruebas

- El grueso es UI/contexto → **`pnpm build` y `pnpm lint` obligatorios** antes de merge (atrapan errores RSC y de tipos).
- Si se extrae algún armado de texto puro reutilizable, un unit chico con Vitest. (No es obligatorio; los mensajes son simples y van inline.)
- QA manual: cada acción destructiva abre el diálogo; "Volver"/Escape/click afuera no ejecutan; confirmar ejecuta y muestra el toast de siempre.

## Despliegue / compat

- Solo frontend. Rama `feat/confirmaciones-panel` → merge a `master` local (sin push, salvo que se indique).
- Aditivo: si algo del provider fallara, las acciones siguen existiendo; pero el provider es simple y se testea con build.

## Fuera de alcance (YAGNI)

- B2 (estados de carga/error), B3 (microcopy general/ayudas), B4 (onboarding).
- Confirmaciones en acciones **no** destructivas (aprobar/rechazar seña, crear, reprogramar).
- "Deshacer" (undo) tras la acción — solo confirmación previa.
- Cambios de backend.
