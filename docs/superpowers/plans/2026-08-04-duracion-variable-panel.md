# Duración variable — Plan B2 (panel de administración)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el panel muestre correctamente los turnos de :30 y de más de una hora, y que el mostrador pueda cargar reservas de 1, 1½ o 2 horas.

**Architecture:** El calendario semanal es una grilla de celdas por hora entera (`Map` con clave `${fecha}|${horaNum}`). En vez de reescribirlo a bloques de alto proporcional, **las reservas se expanden a una celda por cada hora que tocan** — que es exactamente lo que `materializar` ya hace con los turnos fijos. Cada chip pasa a mostrar su hora real y su duración.

**Tech Stack:** Next.js 16, React client components, Tailwind CSS v4, TypeScript, **vitest** (a diferencia de `reservas/`, este subproyecto sí tiene tests). Gestor: **pnpm**.

**Spec:** `docs/superpowers/specs/2026-08-04-duracion-variable-precio-design.md`

## Global Constraints

- **Todo en español**: copy, comentarios, nombres de variables. No traducir `cancha`, `seña`, `turno`, `bloqueo`, `fijo`.
- **`frontend/` SÍ tiene tests.** `pnpm test` corre vitest sobre `src/**/*.test.{ts,tsx}`, y `src/lib/calendario.test.ts` ya tiene ~20 casos. La lógica pura de la Task 1 va **test-first**. No es opcional: es la lógica que decide qué ve el mostrador.
- **Restricción del entorno:** la máquina del usuario se congeló dos veces por carga de procesos. **No levantar servidores de desarrollo, ni Docker, ni navegadores.** `pnpm test`, `pnpm lint` y `pnpm build` una vez cada uno, al final de cada tarea. Sin loops de espera ni procesos en background.
- **Baseline de lint en `frontend/`, medido: `✖ 4 problems (3 errors, 1 warning)`.** Son preexistentes y ajenos (`react-hooks/set-state-in-effect` en `use-cliente-autocomplete.ts`, `nueva-reserva-dialog.tsx` y `usuarios-table.tsx`). El criterio es que **no suba de 4 problemas / 3 errores**. `pnpm lint` sale con código 1 aun en el baseline: eso es normal acá, no significa que rompiste algo.
- **No tocar `reservas/` ni `backend/`.** Ya están terminados y revisados.
- **Ningún cálculo de precio en el browser.** Los precios salen del backend.
- **Next.js 16 no es el Next que conocés.** Si dudás de una API de Next, leé la guía en `frontend/node_modules/next/dist/docs/`. Ver `frontend/AGENTS.md`.
- **Comandos desde `frontend/`**: `pnpm test`, `pnpm lint`, `pnpm build`.

## El problema concreto que esto arregla

Con el backend ya mergeado, existen reservas que arrancan a las 18:30 y que duran 90 o 120 minutos. Hoy el panel:

1. **Miente la hora.** `ubicarEnTz` (`calendario.ts:48-56`) devuelve solo `horaNum` entero, y el detalle imprime literalmente `${horaNum}:00` (`calendario-semana.tsx:168`). Una reserva de 18:30 se le muestra al mostrador como **"18:00"**.
2. **Parecen duplicados.** Dos turnos, 18:00 y 18:30, caen en la misma celda sin nada que los distinga.
3. **Oculta la duración.** Una reserva de 2 horas ocupa una sola celda, igual que una de 1 hora, así que la celda de las 19:00 se ve libre cuando no lo está.

## Estructura de archivos

| Archivo | Qué cambia |
|---|---|
| `src/lib/calendario.ts` | `ubicarEnTz` suma `minuto`; `EventoCal` suma `horaTexto`, `duracionMin` y `esContinuacion`; `materializar` los completa. |
| `src/lib/calendario.test.ts` | Tests nuevos para lo anterior. |
| `src/components/calendario/calendario-semana.tsx` | Expande las reservas por hora tocada; el chip y el detalle muestran hora real y duración. |
| `src/lib/types.ts` | `Slot` suma `duraciones`. |
| `src/lib/reservas-actions.ts` | `crearReserva` acepta `duracionMin`. |
| `src/components/reservas/nueva-reserva-dialog.tsx` | Selector de duración. |

---

### Task 1: La lógica del calendario entiende minutos y duración

Lógica pura, con tests. Nadie la consume todavía: eso es la Task 2.

**Files:**
- Modify: `frontend/src/lib/calendario.ts`
- Test: `frontend/src/lib/calendario.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `ubicarEnTz(iso: string): { fecha: string; horaNum: number; minuto: number }` — **campo `minuto` nuevo**; `fecha` y `horaNum` no cambian de significado.
  - `EventoCal` suma `horaTexto: string` (la hora real, `"18:30"`), `duracionMin: number` y `esContinuacion: boolean`.
  - `hhmmDeMinutos(min: number): string` — helper exportado, `1110` → `"18:30"`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `frontend/src/lib/calendario.test.ts`:

```ts
describe('ubicarEnTz con minutos', () => {
  it('devuelve el minuto real, no solo la hora', () => {
    // 2026-06-10T21:30:00Z = 18:30 en Argentina (UTC-3)
    const r = ubicarEnTz('2026-06-10T21:30:00.000Z');
    expect(r.fecha).toBe('2026-06-10');
    expect(r.horaNum).toBe(18);
    expect(r.minuto).toBe(30);
  });
  it('una hora en punto tiene minuto 0', () => {
    expect(ubicarEnTz('2026-06-10T21:00:00.000Z').minuto).toBe(0);
  });
});

describe('hhmmDeMinutos', () => {
  it('formatea minutos desde medianoche', () => {
    expect(hhmmDeMinutos(0)).toBe('00:00');
    expect(hhmmDeMinutos(1110)).toBe('18:30');
    expect(hhmmDeMinutos(1200)).toBe('20:00');
  });
});

describe('materializar con duración', () => {
  const cancha = { id: 'c1', nombre: '1' };
  const fijo2h = {
    id: 'f1', canchaId: 'c1', cancha, clienteNombre: 'Ana', activo: true,
    diaSemana: 3, horaInicio: '18:00', horaFin: '20:00', excepciones: [],
  } as any;

  it('un fijo de 2 horas expande a dos celdas, la segunda marcada como continuación', () => {
    const evs = materializar(['2026-06-10'], [fijo2h], []);
    expect(evs.map((e) => e.horaNum)).toEqual([18, 19]);
    expect(evs.map((e) => e.esContinuacion)).toEqual([false, true]);
    // Las dos celdas informan el mismo turno: arranca 18:00, termina 20:00, dura 120 minutos.
    expect(evs.every((e) => e.horaTexto === '18:00' && e.finTexto === '20:00' && e.duracionMin === 120)).toBe(true);
  });

  it('un fijo que arranca a las 18:30 conserva el minuto y cae en la celda de las 18', () => {
    const fijoMedia = { ...fijo2h, horaInicio: '18:30', horaFin: '20:00' };
    const evs = materializar(['2026-06-10'], [fijoMedia], []);
    expect(evs.map((e) => e.horaNum)).toEqual([18, 19]);
    expect(evs[0].horaTexto).toBe('18:30');
    expect(evs[0].finTexto).toBe('20:00');
    expect(evs[0].duracionMin).toBe(90);
  });
});
```

Agregar `hhmmDeMinutos` al `import` que ya trae `ubicarEnTz` y `materializar` desde `./calendario`.

- [ ] **Step 2: Correr los tests y confirmar que fallan**

```bash
pnpm test
```

Esperado: FAIL — `hhmmDeMinutos` no existe, y `minuto`/`horaTexto`/`duracionMin`/`esContinuacion` son `undefined`.

- [ ] **Step 3: Implementar en `calendario.ts`**

Reemplazar `ubicarEnTz` (línea 48) para que también devuelva el minuto:

```ts
export function ubicarEnTz(iso: string): { fecha: string; horaNum: number; minuto: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  let horaNum = Number(get('hour'));
  if (horaNum === 24) horaNum = 0;
  return { fecha: `${get('year')}-${get('month')}-${get('day')}`, horaNum, minuto: Number(get('minute')) };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 1110 -> "18:30". Minutos desde la medianoche. */
export function hhmmDeMinutos(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}
```

Ampliar `EventoCal` (línea 68):

```ts
export interface EventoCal {
  key: string;
  tipo: 'reserva' | 'fijo' | 'bloqueo';
  fecha: string;
  /** Celda de la grilla donde se dibuja: la hora entera. */
  horaNum: number;
  /** Hora real de inicio del turno, "18:30". Es lo que se le muestra al mostrador. */
  horaTexto: string;
  /** Hora real de fin, "20:00". Se calcula al crear el evento, donde ya están los minutos:
      así la vista no tiene que re-parsear `horaTexto` para mostrar el rango. */
  finTexto: string;
  duracionMin: number;
  /** true en las celdas posteriores a la primera, para turnos que cruzan de hora. */
  esContinuacion: boolean;
  canchaId: string;
  titulo: string;
  subtitulo: string;
  estado?: EstadoReserva;
  motivo?: MotivoBloqueo;
  refId: string;
}
```

En `materializar`, reemplazar el helper `hNum` (línea 91) y los dos bucles de expansión por una versión basada en minutos. Reemplazar:

```ts
const hNum = (hhmm: string) => Number(hhmm.slice(0, 2));
```

por:

```ts
const aMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Las horas enteras que toca el rango [ini, fin) en minutos. 18:30-20:00 -> [18, 19]. */
const horasQueToca = (ini: number, fin: number) => {
  const out: number[] = [];
  for (let h = Math.floor(ini / 60); h < Math.ceil(fin / 60); h++) out.push(h);
  return out;
};
```

Y los dos `for (let h = hNum(...); h < hNum(...); h++)` pasan a iterar `horasQueToca`. Para los fijos:

```ts
      const ini = aMin(f.horaInicio); const fin = aMin(f.horaFin);
      const horas = horasQueToca(ini, fin);
      horas.forEach((h, i) => {
        out.push({ key: `f${f.id}@${dia}-${h}`, tipo: 'fijo', fecha: dia, horaNum: h, horaTexto: hhmmDeMinutos(ini), finTexto: hhmmDeMinutos(fin), duracionMin: fin - ini, esContinuacion: i > 0, canchaId: f.canchaId, titulo: f.cancha?.nombre ?? '', subtitulo: f.clienteNombre, refId: f.id });
      });
```

Para los bloqueos, lo mismo con `b.horaInicio`/`b.horaFin`, `tipo: 'bloqueo'`, `subtitulo: sub`, `motivo: b.motivo` y `key: \`b${b.id}@${dia}-${h}\``.

- [ ] **Step 4: Correr los tests y confirmar que pasan**

```bash
pnpm test
```

Esperado: PASS. **Los ~20 tests que ya existían tienen que seguir pasando sin tocarlos** — en particular el que dice "un fijo aparece en su weekday y se expande a las horas cubiertas (18-20 → 18 y 19)", que verifica que la expansión por minutos da el mismo resultado que la vieja para horas enteras. Si ese test falla, la implementación está mal: no lo actualices, arreglá el código.

- [ ] **Step 5: Dejar el árbol compilando**

`EventoCal` ahora exige cuatro campos nuevos, y `calendario-semana.tsx:71` construye un literal de
`EventoCal` para las reservas que no los tiene: sin esto el commit no compilaría. **La expansión por
hora es la Task 2**; acá solo completás los campos preservando el comportamiento actual de una
celda por reserva.

En `calendario-semana.tsx`, dentro del bucle de reservas, antes del `eventos.push`:

```tsx
    const iniMin = horaNum * 60 + minuto;
    const duracionMin = Math.round((new Date(r.fechaFin).getTime() - new Date(r.fechaInicio).getTime()) / 60000);
```

Y el `push` suma los cuatro campos:

```tsx
    eventos.push({ key: `r${r.id}`, tipo: 'reserva', fecha, horaNum, horaTexto: hhmmDeMinutos(iniMin), finTexto: hhmmDeMinutos(iniMin + duracionMin), duracionMin, esContinuacion: false, canchaId: r.cancha?.id ?? '', titulo: r.cancha?.nombre ?? '', subtitulo: r.cliente?.nombre ?? '', estado: r.estado, refId: r.id });
```

Cambiar el destructuring de la línea 65 a `const { fecha, horaNum, minuto } = ubicarEnTz(r.fechaInicio);` y agregar `hhmmDeMinutos` al import de `@/lib/calendario`.

- [ ] **Step 6: Tests, build y lint**

```bash
pnpm test
pnpm build
pnpm lint
```

Esperado: todos los tests pasan, build exitoso, lint en el baseline (**4 problemas / 3 errores**).
Cada commit tiene que quedar verde: si el build falla, no commitees.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/calendario.ts frontend/src/lib/calendario.test.ts frontend/src/components/calendario/calendario-semana.tsx
git commit -m "feat(calendario): la logica entiende minutos y duracion de turno"
```

---

### Task 2: El calendario dibuja las reservas por hora tocada

**Files:**
- Modify: `frontend/src/components/calendario/calendario-semana.tsx`

**Interfaces:**
- Consumes: `ubicarEnTz` con `minuto`, `hhmmDeMinutos`, `EventoCal` con `horaTexto`/`duracionMin`/`esContinuacion`, `materializar` (Task 1).
- Produces: nada para tareas posteriores.

- [ ] **Step 1: Expandir las reservas por hora**

Reemplazar el bucle de reservas (líneas 63-72) por una versión que expanda igual que los fijos:

```tsx
  for (const r of reservas) {
    if (r.estado === 'CANCELADA') continue;
    const { fecha, horaNum, minuto } = ubicarEnTz(r.fechaInicio);
    if (r.turnoFijoId) {
      const ids = matPorDia.get(fecha) ?? new Set<string>();
      ids.add(r.turnoFijoId);
      matPorDia.set(fecha, ids);
    }
    const iniMin = horaNum * 60 + minuto;
    const duracionMin = Math.round((new Date(r.fechaFin).getTime() - new Date(r.fechaInicio).getTime()) / 60000);
    const finMin = iniMin + duracionMin;
    // Una reserva de 18:30 a 20:00 se dibuja en las celdas de 18 y de 19: si solo apareciera
    // en la primera, la de las 19 se vería libre cuando no lo está.
    for (let h = Math.floor(iniMin / 60); h < Math.ceil(finMin / 60); h++) {
      eventos.push({
        key: `r${r.id}-${h}`, tipo: 'reserva', fecha, horaNum: h,
        horaTexto: hhmmDeMinutos(iniMin), finTexto: hhmmDeMinutos(finMin), duracionMin,
        esContinuacion: h > Math.floor(iniMin / 60),
        canchaId: r.cancha?.id ?? '', titulo: r.cancha?.nombre ?? '',
        subtitulo: r.cliente?.nombre ?? '', estado: r.estado, refId: r.id,
      });
    }
  }
```

Agregar `hhmmDeMinutos` al import de `@/lib/calendario` de la línea 7.

**Ojo con `key`**: pasa de `r${r.id}` a `r${r.id}-${h}`, porque ahora una misma reserva genera varios eventos y React necesita claves únicas.

- [ ] **Step 2: Que el chip muestre la hora y la duración**

En `EventoBtn`, el cuerpo del chip hoy es `${ev.titulo}${ev.subtitulo ? ' · ' + ev.subtitulo : ''}`. Pasa a incluir la hora real y, cuando el turno dura más de una hora, la duración. Las celdas de continuación se marcan con `↳` y quedan atenuadas, para que se lean como parte del mismo turno y no como otro turno.

Reemplazar las líneas de `cuerpo` y del `return` de `EventoBtn`:

```tsx
  const dur = ev.duracionMin === 60 ? '' : ev.duracionMin === 90 ? ' · 1½ h' : ` · ${ev.duracionMin / 60} h`;
  const cuerpo = `${ev.horaTexto}${dur} · ${ev.titulo}${ev.subtitulo ? ' · ' + ev.subtitulo : ''}`;
  return (
    <button
      onClick={() => onEvento(ev)}
      className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[12px] leading-tight ${clasesColor} ${esReserva ? '' : 'border-dashed'} ${esperando ? 'opacity-60' : ''} ${ev.esContinuacion ? 'opacity-50' : ''}`}
      title={`${cuerpo}${tag ? ' · ' + tag : ''}${esperando ? ' (seña)' : ''}`}
    >
      {ev.esContinuacion && <span className="opacity-60">↳ </span>}
      {tag && <span className="font-semibold uppercase tracking-wide opacity-70">{tag}: </span>}
      {cuerpo}{esperando ? ' (seña)' : ''}
    </button>
  );
```

- [ ] **Step 3: Arreglar el detalle, que es donde está el bug más visible**

La línea 168 imprime `${String(selInfo.horaNum).padStart(2, '0')}:00` — o sea, un turno de 18:30 se muestra como "18:00". Reemplazarla por la hora real y el rango:

```tsx
              <p className="text-sm text-neutral-600">
                {selInfo.titulo} · {selInfo.horaTexto} a {selInfo.finTexto}
              </p>
```

- [ ] **Step 4: Confirmar que no quedó ningún otro lugar mostrando la hora mal**

El controlador ya verificó el alcance, así que esto es una confirmación, no una búsqueda a ciegas:

- En `calendario-semana.tsx` hay **exactamente 4 usos de `horaNum`**: líneas 65 (destructuring), 71 (creación del evento), 77 (clave de celda `${ev.fecha}|${ev.horaNum}`) y 168 (el detalle). Las tres primeras usan `horaNum` como **celda de la grilla**, que es correcto y **no se toca**; la 168 es la única que formatea para mostrar, y la arreglaste en el Step 3.
- **`agenda-hoy.tsx` no está afectado**: no usa `horaNum`, ni `ubicarEnTz`, ni formatea horas desde `fechaInicio`. Verificado por búsqueda, cero coincidencias. No lo toques.

Corré igual esta confirmación y pegá el resultado en el informe:

```bash
grep -rn "horaNum" frontend/src/components/
```

Esperado: solo las líneas de `calendario-semana.tsx` mencionadas arriba, ninguna de ellas formateando una hora para el usuario.

- [ ] **Step 5: Tests, build y lint**

```bash
pnpm test
pnpm build
pnpm lint
```

Esperado: los tests siguen pasando, build exitoso, lint en el baseline: **4 problemas / 3 errores**, ni uno más.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/calendario/ frontend/src/components/hoy/
git commit -m "fix(calendario): mostrar la hora real y la duracion de cada turno"
```

---

### Task 3: Selector de duración al cargar una reserva

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/reservas-actions.ts`
- Modify: `frontend/src/components/reservas/nueva-reserva-dialog.tsx`

**Interfaces:**
- Consumes del backend: `GET /disponibilidad` devuelve slots con `duraciones: { min: number; horaFin: string; precio: number }[]`, y `POST /reservas` acepta `duracionMin` opcional.
- Produces: nada.

- [ ] **Step 1: Ampliar el tipo `Slot`**

En `frontend/src/lib/types.ts`, la línea 16:

```ts
export interface DuracionSlot { min: number; horaFin: string; precio: number }
export interface Slot { horaInicio: string; inicioUtc: string; duraciones?: DuracionSlot[] }
```

`duraciones` va **opcional** a propósito: el panel y el backend se deployan juntos, pero si alguna vez quedan desfasados, el diálogo tiene que seguir funcionando con turnos de una hora en lugar de romperse.

- [ ] **Step 2: Reenviar `duracionMin` en la acción**

En `frontend/src/lib/reservas-actions.ts`, `crearReserva` hace `body: JSON.stringify({ ...input, ... })`, así que alcanza con sumar el campo al tipo del parámetro para que viaje:

```ts
export async function crearReserva(input: { canchaId: string; whatsapp: string; nombreCliente: string; fecha: string; horaInicio: string; duracionMin?: number; cobroInicial: 'ninguno' | 'sena' | 'total'; medioCobro: 'EFECTIVO' | 'TRANSFERENCIA'; montoCobro?: number }): Promise<{ ok: true; cobroOmitido?: boolean } | { ok: false; error: string }> {
```

El resto del cuerpo de la función no cambia.

- [ ] **Step 3: Selector en el diálogo**

En `nueva-reserva-dialog.tsx`, agregar el estado junto a los demás (después de `const [horaInicio, setHora] = useState('');`):

```tsx
  const [duracionMin, setDuracionMin] = useState(60);
```

Resetearlo en `resetForm()` (`setDuracionMin(60);`) y también al elegir hora, porque las duraciones viables cambian según el horario. Reemplazar el `onChange` del select de hora (línea 116):

```tsx
            <select id="nueva-hora" value={horaInicio} onChange={(e) => { setHora(e.target.value); setDuracionMin(60); }} className="w-full rounded-md border px-2 py-1.5" disabled={slotsLoading || !slots.length}>
```

Agregar el selector **después** del bloque de la hora y antes del grid de WhatsApp/Cliente:

```tsx
          {(() => {
            const slotSel = slots.find((s) => s.horaInicio === horaInicio);
            const opciones = slotSel?.duraciones ?? [];
            if (opciones.length < 2) return null;
            return (
              <div className="space-y-1">
                <Label htmlFor="nueva-duracion">Duración</Label>
                <select id="nueva-duracion" value={duracionMin} onChange={(e) => setDuracionMin(Number(e.target.value))} className="w-full rounded-md border px-2 py-1.5">
                  {opciones.map((d) => (
                    <option key={d.min} value={d.min}>
                      {d.min === 60 ? '1 hora' : d.min === 90 ? '1½ horas' : `${d.min / 60} horas`} — hasta {d.horaFin} — ${d.precio.toLocaleString('es-AR')}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}
```

Y en `submit()`, agregar el campo a la llamada:

```tsx
      const r = await crearReserva({ canchaId, whatsapp, nombreCliente, fecha, horaInicio, duracionMin, cobroInicial: cobro, medioCobro, montoCobro: cobro === 'sena' ? Number(montoSena) : undefined });
```

- [ ] **Step 4: Tests, build y lint**

```bash
pnpm test
pnpm build
pnpm lint
```

Esperado: todo pasa; lint en el baseline: **4 problemas / 3 errores**. Ojo que uno de los tres está justamente en `nueva-reserva-dialog.tsx`: sigue siendo el mismo `react-hooks/set-state-in-effect` del `useEffect` de la seña, que no tocás.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/reservas-actions.ts frontend/src/components/reservas/nueva-reserva-dialog.tsx
git commit -m "feat(reservas): selector de duracion al cargar una reserva desde el panel"
```

---

## Cierre del Plan B2

Al terminar, el panel muestra la hora real y la duración de cada turno, las reservas largas ocupan todas las celdas que tocan, y el mostrador puede cargar reservas de 1, 1½ o 2 horas.

**Con esto se destraba el deploy.** Backend (Plan A), web pública (Plan B1) y panel (Plan B2) quedan coherentes entre sí.

**Antes de deployar, avisarle al dueño del complejo dos cosas** que cambian plata y que ya están aprobadas y documentadas en el spec:

1. Los turnos fijos de más de una hora pasan a cobrarse por su duración real (antes se cobraban como si fueran de una).
2. La franja pico que termina a medianoche empieza a aplicarse (antes se anulaba sola por un bug de comparación de strings).

Y una tercera, que es exposición nueva: **un socio puede reservar dos horas bonificadas.** Está decidido dejarlo así, pero conviene que el complejo lo sepa antes y no después.
