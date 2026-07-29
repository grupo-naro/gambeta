# Hoja sincronizada idéntica al Excel (fijos + bloqueos + color por tipo) — Design

**Fecha:** 2026-06-28
**Estado:** Aprobado
**Componente:** backend — sincronización con Google Sheets (`src/services/sheets/`).

## Problema

La hoja espejo de Google Sheets ya replica la **estructura** del Excel del complejo (una pestaña por día LUNES–DOMINGO, columnas `Cancha + $$` por cancha, filas por hora, totales por cancha + total general). Pero difiere en dos cosas del Excel que ellos usan:

1. **Sólo muestra reservas.** El Excel además tiene **turnos fijos**, **escuela/Sarmiento**, **torneos** y **entrenamientos**.
2. **El color significa otra cosa.** Hoy el color del nombre = estado de pago (verde/naranja/rojo). En su Excel el color = **tipo de turno** (negro=fijo, rojo=suelto, naranja=escuela).

Objetivo: que la hoja se vea lo más parecida posible a su Excel → sumar fijos + bloqueos y colorear por **tipo**.

## Qué se muestra (cada celda = un turno en una cancha/hora)

A las **reservas** (ya existentes) se suman, expandidos a las ocurrencias de la semana actual:
- **Turnos fijos** (`TurnoFijo` activo) en su día de semana, **salvo** las fechas con excepción (liberadas).
- **Bloqueos** (`Bloqueo` activo): recurrentes (por `diaSemana`) y puntuales (por `fecha`).

Un turno de varias horas (ej. fijo 20:00–22:00) ocupa **una fila por hora** (20 y 21).

### Color del texto del nombre (por tipo)
| Tipo | Color RGB | Texto de la celda |
|---|---|---|
| Turno fijo | Negro `(0,0,0)` | nombre del cliente |
| Turno suelto (reserva sin `turnoFijoId`) | Rojo `(0.8,0,0)` | nombre del cliente |
| Escuela / Entrenamiento (`ENTRENAMIENTO`) | Naranja `(0.9,0.45,0)` | "Entrenamiento" + nota si hay |
| Torneo (`TORNEO`) | Violeta `(0.5,0.2,0.7)` | "Torneo" + nota si hay |
| Mantenimiento / Otro (`MANTENIMIENTO`/`OTRO`) | Gris `(0.4,0.4,0.4)` | "Mantenimiento"/"Bloqueo" + nota |

La columna `$$` muestra el **precio** del turno (reservas: su monto; fijos: su `precio`; bloqueos: vacío/0). Totales por cancha y total general como hoy (suman reservas + fijos; los bloqueos suman 0).

## Diseño técnico

### Dedupe (clave)
Un **fijo materializado** ya es una `Reserva` con `turnoFijoId`. Para no mostrarlo dos veces:
1. Primero se arman las celdas de **reservas**, ocupando un set de claves `canchaId|fecha|hora`. Tipo de la reserva: `'fijo'` si tiene `turnoFijoId`, si no `'suelto'`.
2. Al expandir **fijos** y **bloqueos**, se **omite** toda ocurrencia cuya clave `canchaId|fecha|hora` ya esté ocupada por una reserva. (El anti-overlap garantiza que no hay choques reales; esto sólo evita duplicar la visualización.)

### Función pura de expansión (testeable sin DB)
Nueva función en `src/services/sheets/expandir.ts`:
```
expandirSemana(
  input: { reservas: CeldaTurno[]; fijos: FijoInput[]; bloqueos: BloqueoInput[] },
  dias: { dia: string; fecha: string }[],
  horas: string[],
  tz: string,
): CeldaTurno[]
```
- Para cada `dia`, calcula `dow = dayOfWeekInTz(fecha, tz)` (0=domingo … 6=sábado, helper ya existente en `utils/tz`).
- **Fijos:** si `f.diaSemana === dow` y `f` no tiene excepción en esa `fecha` → expandir horas `[horaInicio..horaFin)` (en pasos de 1h, formato `"HH:00"`) → celda `{ canchaId, fecha, hora, cliente: f.clienteNombre, monto: Number(f.precio ?? 0), pagado: 0, tipo: 'fijo' }`, si la clave no está ocupada.
- **Bloqueos:** aplica si `(recurrente && diaSemana === dow)` o `(!recurrente && fecha === diaFecha)` → expandir horas → celda con `cliente = etiquetaMotivo(motivo, nota)`, `monto: 0`, `tipo` según motivo, si la clave no está ocupada.
- Devuelve la lista combinada (reservas + fijos + bloqueos).
- Sólo expande dentro de `horas` (las de la config); horas fuera de rango se descartan.

### `grilla.ts`
- `ReservaCelda` (renombrable a `CeldaTurno`) gana el campo `tipo: 'fijo' | 'suelto' | 'escuela' | 'torneo' | 'otro'`.
- Reemplazar `colorTextoDe(monto, pagado)` por `colorPorTipo(tipo)` con la tabla de colores de arriba. El resto de `construirGrillaDia` queda igual (sigue armando header `Cancha+$$`, filas, totales por monto).

### `sheetsData.ts`
- `dataSemana()` además de las reservas trae:
  - `prisma.turnoFijo.findMany({ where: { activo: true }, include: { excepciones: true } })`.
  - `prisma.bloqueo.findMany({ where: { activo: true } })`.
- Mapea reservas a `CeldaTurno` (con `tipo` = `turnoFijoId ? 'fijo' : 'suelto'`), arma `FijoInput`/`BloqueoInput`, y llama `expandirSemana(...)` para devolver `celdas` ya combinadas. El resto (`dias`, `horas`, `canchas`) igual.

### Frescura (que la hoja quede al día)
Hoy `marcarSucio(fecha)` se llama al crear/editar reservas y cobros. Como fijos/bloqueos afectan **toda la semana**, se agrega a `sheetsSync`:
```
marcarSemanaSucia(): void  // marca sucios los 7 días de la semana actual (reusa diasSemanaActual)
```
y se invoca en `turnoFijo.service` (`crear`, `eliminar`, `agregarExcepcion`, `quitarExcepcion`) y `bloqueo.service` (`crear`, `eliminar`). Best-effort y no bloqueante, igual que `marcarSucio`.

### `escribirDia` / `sincronizarTodo` / `reconstruirDia`
**Sin cambios.** `escribirDia` ya pinta `c.colorTexto` por celda; `reconstruirDia`/`sincronizarTodo` ya filtran `celdas` por fecha y llaman `construirGrillaDia`.

## Testing
- **Unit** de `expandirSemana` (Vitest, sin Docker): 
  - un fijo de lunes 20–22 aparece el lunes en las filas 20 y 21, color/tipo `fijo`;
  - una excepción en esa fecha lo excluye;
  - un bloqueo recurrente (TORNEO) aparece por `diaSemana` con tipo `torneo`; uno puntual sólo en su `fecha`;
  - dedupe: si hay una reserva en `cancha|fecha|hora`, el fijo de esa misma clave NO se duplica;
  - horas fuera del rango de config se descartan.
- **Unit** de `colorPorTipo` (mapea cada tipo a su color).
- Verificación: `tsc --noEmit` + suite. La escritura real a Google no se testea (API externa).

## Fuera de alcance
- Replicar la notación libre del Excel ("Santy g 10000 mp"): se muestra nombre + precio prolijo.
- Columna "SEÑA $" separada (futuro).
- Configuración de la Cancha 4 divisible (es carga de datos; las columnas reflejan las canchas activas).

## Integración
Backend → merge a `main` + push; deploy por la Action. No es bloqueante para el go-live del martes.
