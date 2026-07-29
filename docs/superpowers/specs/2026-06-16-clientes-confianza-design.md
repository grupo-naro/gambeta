# Clientes de confianza (seña desde la DB) — Design

**Fecha:** 2026-06-16
**Estado:** Aprobado

## Objetivo

Decidir la **seña** desde la base de datos en vez del flag de contacto (que resultó poco confiable y dejó pasar reservas sin seña → stopgap actual "todos pagan"). Reglas:
- **Auto:** un cliente entra a "de confianza" cuando tiene **2 reservas cumplidas** (estado CONFIRMADA/COMPLETADA); o sea, de la **3ra reserva en adelante no paga seña**.
- **Manual:** el dueño puede marcar a un cliente como **de confianza** desde el panel (y dar de alta uno nuevo a mano).
- `confianza = cliente.confiable || reservasCumplidas ≥ 2`. Confianza → reserva **CONFIRMADA** (sin seña); si no → **ESPERANDO_SENA**.

Reemplaza el stopgap (bot v38 manda `esContacto:false` siempre): el **backend** pasa a decidir la seña.

## Contexto (estado actual)

- `Cliente`: `id, nombre, whatsapp @unique, esContacto, primeraReserva, totalReservas, nombreConfirmado, creadoEn, reservas[]`.
- `cliente.routes.ts`: `GET /clientes` (authJwt, `clienteService.list`), `GET /clientes/:id` (authJwt), `GET /clientes/buscar?whatsapp` (authAny), `POST /clientes` (authAny, upsert). `clienteRepo`: `list`, `findById`, `findByWhatsapp`, `upsert(whatsapp,nombre,esContacto)`.
- `reserva.service.crear`: hoy `estado = input.esContacto ? 'CONFIRMADA' : 'ESPERANDO_SENA'`; luego (si ESPERANDO_SENA) calcula `montoSena`; en una tx hace upsert del cliente (con la lógica de `nombreConfirmado`) e incrementa `totalReservas`, crea la reserva, y si ESPERANDO_SENA crea el `pago` PENDIENTE. `montoSena` solo se setea en ESPERANDO_SENA.
- El bot ya maneja ambos estados en su rama `confirmar` (CONFIRMADA → "te reservé"; ESPERANDO_SENA → manda datos de seña).
- No hay pantalla `/clientes` en el panel.

## Decisiones (confirmadas)
- Umbral por **reservas cumplidas** (CONFIRMADA/COMPLETADA) ≥ 2.
- **El backend decide** la seña (no el bot).
- Pantalla `/clientes` **completa** (listar + toggle confianza + alta manual + editar nombre).
- Flag `confiable` **booleano** (sin "forzar que siempre pague"; ver Fuera de alcance).

## Alcance

### Backend

**1. Migración — `Cliente.confiable`**
- `confiable Boolean @default(false)` en `model Cliente`. Migración Prisma (existentes en `false`).

**2. Decisión de seña en `reserva.crear`**
- Antes de la tx: leer el cliente por whatsapp; calcular `confianza`:
  - si no existe → `false` (cliente nuevo → seña).
  - si existe: `cliente.confiable ? true : (cumplidas ≥ 2)`, donde `cumplidas = reservaRepo.contarCumplidasPorCliente(cliente.id)` = `count(reserva where clienteId, estado in [CONFIRMADA, COMPLETADA])`.
- `const estado = confianza ? 'CONFIRMADA' : 'ESPERANDO_SENA';` (reemplaza el uso de `input.esContacto` para el estado). El `montoSena`/`pago PENDIENTE` siguen calculándose solo en ESPERANDO_SENA. El upsert del cliente y el resto quedan igual (sigue guardando `esContacto` como metadato y `nombreConfirmado`).
- `reservaRepo.contarCumplidasPorCliente(clienteId)`: `prisma.reserva.count({ where: { clienteId, estado: { in: ['CONFIRMADA','COMPLETADA'] } } })`.

**3. Endpoints del panel**
- `GET /clientes` (authJwt): además de los campos del cliente, devolver por cliente `cumplidas` (conteo de CONFIRMADA/COMPLETADA) y `confianza` (`confiable || cumplidas>=2`). Implementar con un `groupBy` de reservas por `clienteId` (estado in [CONFIRMADA,COMPLETADA]) y mapear; ordenado por `creadoEn desc` (como hoy).
- `PATCH /clientes/:id` (authJwt, validado): body `{ nombre?: string(min1), confiable?: boolean }` → actualiza solo los campos provistos; si se edita `nombre` por panel, marcar `nombreConfirmado: true`. → `clienteService.editar(id, {nombre?, confiable?})` + `clienteRepo.update(id, data)`. 404 si no existe.
- `POST /clientes` (authAny, ya existe): extender `upsertClienteSchema.body` con `confiable: z.boolean().default(false)` y `nombreConfirmado` opcional; el alta manual del panel manda `{ nombre, whatsapp, confiable, nombreConfirmado:true }`. `clienteService.upsert`/`clienteRepo.upsert` aceptan `confiable` y `nombreConfirmado`.

### Frontend — pantalla `/clientes`

- `app/(panel)/clientes/page.tsx` (Server Component): `apiFetch<Cliente[]>('/clientes')` (con `confiable`, `totalReservas`, `cumplidas`, `confianza`). Render `ClientesTable`.
- `components/clientes/clientes-table.tsx` (client): tabla desktop / cards mobile (patrón existente). Columnas: Nombre, WhatsApp, Reservas (cumplidas), Confianza (badge "De confianza" si `confianza`, gris si no). Fila/card **tocable** → abre hoja (`ui/sheet`, como el resto del panel) con: datos + toggle **"De confianza"** (PATCH `confiable`) + **Editar nombre** (input + guardar → PATCH `nombre`). Botón header **"Nuevo cliente"** → `ClienteDialog` (nombre + whatsapp + checkbox "De confianza") → POST.
- `lib/clientes-actions.ts` (`'use server'`, todos `async function`): `editarConfianza(id, confiable)`, `editarNombreCliente(id, nombre)`, `crearCliente({nombre, whatsapp, confiable})`. Cada uno `apiFetch` + `revalidatePath('/clientes')`; patrón `Result = {ok}|{ok:false,error}` como las otras actions.
- `lib/types.ts`: `Cliente` suma `confiable: boolean; totalReservas: number; cumplidas: number; confianza: boolean` (hoy `Cliente` es `{id,nombre,whatsapp}` — extender).
- `components/nav-items.ts`: agregar `{ href:'/clientes', label:'Clientes', icon:<Users-like>, roles: AMBOS }` en el grupo de administración (recepción también gestiona clientes). Elegir un ícono distinto al de Usuarios (ej. `Contact`/`UserRound`).

### Bot
- **Sin cambios.** El backend ya decide el estado; el bot responde según `r.estado` (lo hace hoy). El stopgap `esContacto:false` queda inocuo (el backend lo ignora para el estado). (Opcional futuro: que el bot avise "como ya reservaste varias veces, esta no lleva seña" — fuera de alcance.)

## Datos / flujo
1. Cliente confirma una reserva (bot o panel) → `POST /reservas`.
2. `reserva.crear` lee el cliente, cuenta cumplidas, calcula `confianza` → estado CONFIRMADA o ESPERANDO_SENA.
3. Cliente nuevo: 1ra y 2da → seña; al tener 2 cumplidas, 3ra → sin seña. Marcado `confiable` → sin seña desde ya.
4. Panel `/clientes`: ver/abrir cliente → toggle confianza / editar nombre / alta manual.

## Manejo de errores / bordes
- Cliente nuevo (no existe) → `confianza=false` → seña. Correcto.
- `PATCH /clientes/:id` inexistente → 404. `confiable` ausente en el body → no lo toca.
- `cumplidas` cuenta CONFIRMADA + COMPLETADA (no cuenta ESPERANDO_SENA ni CANCELADA) → evita el abuso de reservar y abandonar.
- El panel crea reservas con `esContacto:false`; ahora el estado lo define la confianza del cliente igual (no regresión: cliente no confiable desde panel → ESPERANDO_SENA como hoy).

## Pruebas
**Backend (TDD, Testcontainers):**
- `contarCumplidasPorCliente` cuenta solo CONFIRMADA/COMPLETADA.
- `POST /reservas`: cliente nuevo → ESPERANDO_SENA; cliente con `confiable=true` → CONFIRMADA (sin seña, sin montoSena); cliente con 2 reservas cumplidas → la siguiente CONFIRMADA; con 1 cumplida → ESPERANDO_SENA.
- `PATCH /clientes/:id` actualiza `confiable`/`nombre` (y marca nombreConfirmado al editar nombre); 404 si no existe.
- `GET /clientes` devuelve `cumplidas` y `confianza` correctos.

**Frontend:** `pnpm lint` + `pnpm build` obligatorios; sin tests de componente nuevos (lógica del badge es trivial). QA manual: listar, togglear confianza, editar nombre, alta manual; verificar que un cliente de confianza reserva sin seña.

## Despliegue / compat
- Backend: rama `feat/clientes-confianza` → main + **deploy VM** (`migrate deploy`). Frontend: rama `feat/clientes-panel` → master local.
- Aditivo. El stopgap del bot se mantiene (inocuo). La seña pasa a decidirse en el backend al deployar.

## Fuera de alcance (YAGNI)
- "Forzar que siempre pague" un cliente con 3+ cumplidas (estado tri-estado). Por ahora `confiable` solo sube la confianza; el abuso se maneja a mano. Posible mejora futura.
- Que el bot avise proactivamente que no lleva seña.
- Historial/CRM del cliente más allá de la lista + confianza + nombre.
- Borrar clientes.
