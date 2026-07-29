# Confianza de cliente: solo manual (sin auto a las 2 reservas) — Design

**Fecha:** 2026-07-03
**Estado:** Aprobado
**Componentes:** backend (lógica + tests) + frontend (copy). Dos repos.

## Problema

Hoy un cliente se vuelve "de confianza" (reserva sin seña) automáticamente al llegar a **2 reservas cumplidas**. Se quiere que la confianza se active **solo manualmente** desde el panel (el toggle "de confianza" que ya existe).

## Estado actual (dónde vive la regla)
- `backend/src/services/reserva.service.ts:58`: `confianza = opts.porStaff || input.esContacto || (!!clientePrevio && (clientePrevio.confiable || (await reservaRepo.contarCumplidasPorCliente(clientePrevio.id)) >= 2))`. Decide CONFIRMADA vs ESPERANDO_SENA.
- `backend/src/services/cliente.service.ts:10`: `confianza: c.confiable || cumplidas >= 2`. Campo que muestra `GET /clientes`.
- El frontend usa el campo `confianza` del backend (no lo recalcula), pero hay dos textos que mencionan el automático.

## Backend

### `reserva.service.ts` (~línea 58)
Reemplazar la línea del cálculo de `confianza` por:
```ts
    const confianza = opts.porStaff || input.esContacto || (!!clientePrevio && clientePrevio.confiable);
```
Es decir, se quita `|| (await reservaRepo.contarCumplidasPorCliente(clientePrevio.id)) >= 2` (y con eso la llamada async al conteo en este flujo). Se mantienen:
- `opts.porStaff` — reservas del panel siguen CONFIRMADA (las carga el staff; no es "confianza").
- `input.esContacto` — ya viene siempre `false` desde el bot (neutralizado); se deja igual.
- `clientePrevio.confiable` — la marca manual.

Resultado: una reserva del **bot** queda CONFIRMADA (sin seña) **solo si el cliente está marcado `confiable`**; si no, ESPERANDO_SENA.

### `cliente.service.ts` (~línea 10)
Cambiar el campo `confianza` a que refleje solo la marca manual:
```ts
      return { ...c, cumplidas, confianza: c.confiable };
```
Se sigue devolviendo `cumplidas` (conteo de reservas cumplidas) como dato informativo; solo deja de auto-activar la confianza.

### Tests
- `backend/tests/integration/clientes-confianza.test.ts`: actualizar el/los test(s) que verifican el auto-activado a las 2 cumplidas. El nuevo comportamiento:
  - Cliente NO `confiable` con 2+ reservas cumplidas → `confianza: false` (y una nueva reserva del bot para ese cliente → **ESPERANDO_SENA**, no CONFIRMADA).
  - Cliente marcado `confiable` → `confianza: true` y reserva del bot → CONFIRMADA.
- Correr la suite completa (`npx vitest run`) y ajustar cualquier otro test que asumiera "2ª reserva del mismo cliente → CONFIRMADA" (si aparece). Los fallos pre-existentes de `sena.test.ts` por fecha vencida quedan fuera de alcance.

## Frontend (`src/components/clientes/clientes-table.tsx`)
- Línea ~37: cambiar el texto `Los de confianza reservan sin seña (también automático a las 3 reservas).` por `Los de confianza reservan sin seña.`
- Líneas ~108-109: eliminar el bloque `{!seleccion.confiable && seleccion.confianza && (<p ...>Ya es de confianza por tener 2+ reservas cumplidas.</p>)}` — queda muerto (ahora `confianza === confiable`, así que `!confiable && confianza` nunca es true).
- El badge "De confianza" (`c.confianza`) y el toggle "Marcar/Quitar de confianza" (`confiable`) quedan igual; ahora son coherentes.

## Fuera de alcance
- Quitar `esContacto` del cálculo (ya es siempre `false`; se deja).
- Cambiar `porStaff` (las reservas del panel siguen confirmadas).
- Migrar clientes ya marcados: los que hoy figuran "de confianza" solo por tener 2+ cumplidas dejarán de estarlo (correcto — es lo pedido); si el complejo quiere que alguno siga siendo de confianza, lo marca a mano.

## Integración
Backend → `main`; Frontend → `master`. Definir en el plan si se pushea/deploya (afecta cómo el bot pide seña el lunes) o se deja commiteado sin push. Dos repos.
