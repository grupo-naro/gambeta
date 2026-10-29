# Cuentas por cancha en el buffet — diseño

## Por qué

Hoy un grupo que juega pide bebida y productos del buffet durante su turno y paga todo junto al terminar.
El mostrador lo anota en un papel y después lo carga al sistema. El papel se olvida, se carga tarde y se suma mal.
Se quiere lo mismo que la cuenta de una mesa en un bar, pero por **cancha**: se abre una cuenta, se van sumando
consumos mientras dura el turno y al final se **rinde la cuenta** (se ve el detalle, se cobra una vez).

## Metas

- Abrir, ver, editar y rendir una cuenta por cancha desde el mostrador del buffet, con el mismo flujo táctil de siempre.
- Reemplazar el papel: cada consumo se carga en el momento en que se pide.
- Que la caja, el stock y el cierre de caja del buffet sigan siendo correctos sin cambiar lo que ya existe.

## No metas

- No es una cuenta corriente de clientes ni deuda que se arrastra entre días.
- No cambia cómo se hace una venta suelta en el mostrador (el cobro actual sigue igual).
- No cobra el alquiler de la cancha (eso sigue en Reservas/Caja). La cuenta es solo consumos del buffet.
- No imprime tickets (queda para otro trabajo).

## Anti-meta (sería un fracaso aunque "ande")

- Que el stock quede mal: un consumo cargado que nunca descuenta, o que descuenta dos veces al rendir.
- Que se pueda cerrar la caja del mostrador con consumos sin cobrar y la plata se pierda en silencio.

## Cómo funciona (decidido con el cliente)

1. **Abrir:** en el mostrador, se elige una cancha y se abre una cuenta a su nombre. **Una cancha, una cuenta abierta** a la vez.
2. **Sumar:** con la botonera y el buscador de siempre se suman productos a la cuenta de esa cancha, las veces que haga falta.
3. **Quitar / corregir:** mientras esté abierta, se puede bajar la cantidad o sacar un ítem.
4. **Stock (decidido por el cliente):** el stock se **descuenta al sumar** el consumo y **se devuelve al quitarlo**. Al rendir la cuenta no se vuelve a descontar.
5. **Rendir:** se muestra el detalle y el total, se elige efectivo (con vuelto, como hoy) o transferencia, y se cobra una sola vez. Ahí se crea el ticket de venta normal en la caja abierta.

## Decisiones mías (a validar)

- **Qué stock se mueve:** el del mostrador desde el que se suma, con la misma regla de hoy: el principal descuenta del stock general y el secundario del stock que se le asignó (y no puede sumar más de lo que tiene asignado).
- **Cancelar una cuenta (error / se anula):** devuelve todo el stock y no genera ticket. Solo si la cuenta sigue abierta.
- **Grupo que se va sin pagar:** la cuenta se cierra como **impaga**: el stock queda descontado (ya se consumió), no se crea ticket, y queda registrada con su total y la cancha para que el admin la vea. No se arrastra como deuda a futuro.
- **Caja:** un mostrador **no puede cerrar su caja** mientras tenga cuentas abiertas. Sin esto, el conteo y la conciliación del cierre se descuadran.
- **Visibilidad:** cada mostrador ve y maneja las cuentas que abrió; el panel de admin puede ver todas (lectura), con su estado y total.
- **Enlace con la reserva:** si la cancha tiene una reserva en curso al abrir, se guarda el vínculo para mostrar cliente y horario en la cuenta. Es opcional: se puede abrir una cuenta sin reserva.
- **Idempotencia:** igual que el cobro de hoy, cada operación lleva un identificador único para que un doble toque no sume dos veces ni cobre dos veces.

## Restricciones técnicas

- Se apoya en lo que ya existe: `ProductoBuffet`, `StockMostrador`, `TicketBuffet`/`VentaBuffet`, `CajaBuffet` y la auth de mostrador (`authMostrador`, PIN y token).
- Capas del backend como siempre: rutas finas → servicios → repositorios. Errores con las fábricas de `errors.ts`.
- Modelos nuevos en Prisma (una cuenta y sus líneas) con una migración aditiva que no toca tablas existentes.
- El descuento de stock al sumar y la devolución al quitar corren en transacción y respetan el CHECK de stock asignado no negativo que ya existe.
- Frontend: pantallas bajo `/mostrador`, con las acciones del servidor en `buffet-actions.ts`. El panel admin solo lee.
- Todo en español (cancha, cuenta, consumo, rendir).

## Lo que queda para quien lo construya

- Forma exacta de las pantallas dentro del mostrador (lista de cuentas abiertas, vista de una cuenta, botón de rendir).
- Nombres de modelos, rutas y campos.
- Cómo mostrar las cuentas impagas en el panel admin.
- Tests: unitarios de las reglas de stock y de cierre de caja; los de integración necesitan Docker.
