# Buffet con dos mostradores — BORRADOR (brainstorming sin terminar)

**Fecha:** 2026-08-06
**Estado:** ⚠️ INCOMPLETO — hay una decisión tomada y varias abiertas. No implementar todavía.

## Qué se quiere

Dos mostradores de buffet: uno **principal** y uno **secundario**. Ambos venden contra el stock
general que ya se carga hoy.

El principal (ej: Christian) **le entrega stock por día** al secundario (ej: Rodrigo), para tener
control. Al cerrar la caja, el principal **concilia**: cuánto le entregó contra cuánto vendió.

## Lo que ya se exploró del código

- **`ProductoBuffet` tiene un solo campo `stock`** (`Int`). No hay noción de stock por mostrador.
- **Ya existe `CajaBuffet`**: `TicketBuffet` pertenece a una caja, así que el sistema ya modela
  sesiones de mostrador. Es el gancho natural para separar los dos.
- **El mostrador es anónimo hoy**: `authBuffet` valida una única `x-buffet-key` compartida
  (`src/middlewares/authBuffet.ts`), y el PIN es uno solo, guardado como `buffetPinHash` en la
  fila singleton de `Configuracion`. **Tal como está, el sistema no puede distinguir quién vendió**,
  y sin eso la conciliación es imposible.
- `VentaBuffet` guarda las líneas del ticket contra `ProductoBuffet`.

## Decisión tomada

**Identidad del mostrador: un PIN distinto por mostrador.**

Elegido sobre las alternativas (elegir el mostrador al abrir la caja; una `BUFFET_API_KEY` por
dispositivo). Implica cambiar el modelo de PIN único que hoy vive en `Configuracion.buffetPinHash`.

## Preguntas abiertas (arrancar por acá en la próxima sesión)

1. **¿La entrega descuenta del stock general en el momento de entregar?** ¿O el stock general sigue
   siendo uno solo y la entrega es solo un registro de control? De esto depende todo el modelo de
   datos.
2. **¿Qué pasa con lo que sobra al cerrar?** ¿Vuelve al stock general, queda para el día siguiente,
   o se cuenta como faltante?
3. **¿El secundario puede vender un producto que no le entregaron?** Si sí, ¿qué stock descuenta.
4. **¿Cómo se ve la conciliación?** ¿Una pantalla de cierre que lista entregado / vendido /
   diferencia por producto? ¿Quién la ve, solo el principal?
5. ¿El principal también consume del stock general al vender, o su venta es contra el general
   directamente?

## Contexto de la sesión anterior

Se venía de terminar el **abono en turnos fijos** (6 commits, revisado). Quedaron pausados dos
temas: la vinculación de **Mercado Pago por OAuth** (con cuatro decisiones ya tomadas, ver el
historial) y los **precios de pádel por duración** (romper la proporcionalidad para que 1½ hora
tenga precio propio).
