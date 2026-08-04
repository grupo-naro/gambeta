# Duración variable — Plan B1 (web pública)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cliente pueda elegir 1, 1½ o 2 horas al reservar desde la web pública, viendo el precio de cada opción.

**Architecture:** El backend (Plan A, ya mergeado) publica en `grilla()` un campo `duraciones` por cancha y hora, con el precio ya calculado. La web solo tiene que **mostrarlo y reenviar la elección**: no calcula precios. El selector vive en el modal de reserva que ya existe y es compartido por desktop y mobile.

**Tech Stack:** Next.js 16.2.12 (App Router), React client component, Tailwind CSS v4.3.3, TypeScript. Gestor: **pnpm**.

**Spec:** `docs/superpowers/specs/2026-08-04-duracion-variable-precio-design.md`

## Global Constraints

- **Todo en español**: copy, comentarios, nombres de variables. No traducir `cancha`, `seña`, `turno`.
- **Ningún cálculo de precio en el browser.** Los precios vienen del backend en `duraciones[canchaId][hora][i].precio`. Si te encontrás multiplicando o prorrateando en el cliente, algo está mal: es la única fuente de verdad y prorratear por franja pico en dos lados es cómo se desincronizan.
- **Duraciones: exactamente `{60, 90, 120}` minutos**, y solo las que el backend publique para ese slot. **No inventes opciones**: si el backend manda solo `[60]` porque las demás no entran antes del cierre, se muestra solo esa.
- **`duracionMin` es opcional en el backend con default 60.** Si el usuario no toca nada, mandar 60 explícito o no mandarlo son equivalentes; elegí una y sé consistente.
- **`reservas/` no tiene runner de tests** y el spec decidió no crear uno. La verificación es `pnpm build`, `pnpm lint` y chequeo visual.
- **Baseline de lint en `reservas/`: 1 error preexistente** (`react-hooks/set-state-in-effect` en `src/components/pantalla-reserva.tsx:36`), ajeno a este trabajo. El criterio es que **no suba de 1**, no que dé cero.
- **Next.js 16 no es el Next que conocés.** Si dudás de una API de Next, leé la guía en `reservas/node_modules/next/dist/docs/`. Ver `reservas/AGENTS.md`.
- **Comandos desde `reservas/`**: `pnpm build`, `pnpm lint`, `pnpm dev`.

## Estructura de archivos

| Archivo | Qué cambia |
|---|---|
| `src/lib/types.ts` | `Grilla` suma `duraciones`; se agrega el tipo `DuracionSlot`. |
| `src/lib/actions.ts` | `crearReserva` acepta y reenvía `duracionMin`. |
| `src/components/pantalla-reserva.tsx` | Selector de duración en el modal; el resumen y la confirmación reflejan lo elegido. |

Tres archivos, ninguno nuevo. El componente ya tiene el modal compartido entre desktop y mobile, así que el selector se escribe una sola vez.

---

### Task 1: Contrato y selector de duración

**Files:**
- Modify: `reservas/src/lib/types.ts`
- Modify: `reservas/src/lib/actions.ts`
- Modify: `reservas/src/components/pantalla-reserva.tsx`

**Interfaces:**
- Consumes del backend: `grilla()` devuelve `duraciones: Record<canchaId, Record<hora, { min: number; horaFin: string; precio: number }[]>>`, y `POST /reservas` acepta `duracionMin?: 60 | 90 | 120`.
- Produces: nada que consuman tareas posteriores dentro de este plan.

- [ ] **Step 1: Ampliar los tipos**

En `reservas/src/lib/types.ts`, agregar el tipo nuevo y el campo en `Grilla`. **No toques los campos existentes**: el backend los sigue mandando igual y `precios` sigue siendo el precio de 60 minutos.

```ts
export interface DuracionSlot {
  min: number;
  horaFin: string;
  precio: number;
}

export interface Grilla {
  deporte: Deporte;
  fecha: string;
  canchas: { id: string; nombre: string; precioHora: number }[];
  horas: string[];
  libres: Record<string, Record<string, boolean>>;
  precios: Record<string, Record<string, number>>;
  /** Duraciones reservables por cancha y hora, con el precio ya calculado por el backend. */
  duraciones: Record<string, Record<string, DuracionSlot[]>>;
}
```

- [ ] **Step 2: Reenviar `duracionMin` en la acción**

En `reservas/src/lib/actions.ts`, `crearReserva` suma el campo al input y al body. Es opcional para no romper ninguna llamada existente:

```ts
export async function crearReserva(input: { canchaId: string; fecha: string; horaInicio: string; nombre: string; telefono: string; duracionMin?: number }): Promise<Resultado<ReservaCreada>> {
  try {
    const data = await apiReservas<ReservaCreada>('/reservas', {
      method: 'POST',
      body: JSON.stringify({
        canchaId: input.canchaId,
        whatsapp: input.telefono,
        nombreCliente: input.nombre,
        fecha: input.fecha,
        horaInicio: input.horaInicio,
        esContacto: false,
        ...(input.duracionMin != null ? { duracionMin: input.duracionMin } : {}),
      }),
    });
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}
```

- [ ] **Step 3: Guardar la duración elegida en el estado**

En `pantalla-reserva.tsx`, el estado `sel` pasa a llevar las duraciones disponibles de ese slot, y se agrega el estado de la elección.

Cambiar la declaración de `sel` (línea ~27) y agregar `duracionSel`:

```tsx
  const [sel, setSel] = useState<{ canchaId: string; canchaNombre: string; hora: string; duraciones: DuracionSlot[] } | null>(null);
  const [duracionSel, setDuracionSel] = useState(60);
```

Agregar `DuracionSlot` al import de tipos de la línea 4.

`abrirForm` recibe las duraciones del slot y preselecciona la primera (que siempre es la de 60 minutos, porque el backend las publica en orden ascendente y solo publica un slot si al menos la de 60 entra):

```tsx
  function abrirForm(canchaId: string, canchaNombre: string, hora: string, duraciones: DuracionSlot[]) {
    setSel({ canchaId, canchaNombre, hora, duraciones });
    setDuracionSel(duraciones[0]?.min ?? 60);
    setNombre(''); setTelefono(''); setErrorForm(''); setOk(null);
  }
```

- [ ] **Step 4: Pasar las duraciones desde las dos vistas**

Las dos llamadas a `abrirForm` suman el cuarto argumento. **Ojo: son dos lugares distintos**, la tabla de desktop y la lista de mobile.

En la tabla de desktop (línea ~126):

```tsx
                              <button type="button" disabled={!libre} onClick={() => abrirForm(c.id, c.nombre, h, grilla!.duraciones?.[c.id]?.[h] ?? [])}
```

En la lista de mobile (línea ~166):

```tsx
                            <button type="button" onClick={() => abrirForm(canchaSel.id, canchaSel.nombre, h, grilla!.duraciones?.[canchaSel.id]?.[h] ?? [])}
```

El `?? []` es defensivo a propósito: si el backend todavía no publicara el campo, el modal cae al comportamiento de una hora en vez de romperse.

- [ ] **Step 5: Dibujar el selector en el modal**

Dentro del modal, en la rama del formulario (después del `<p>` con el resumen de la línea ~204 y antes del bloque de inputs), agregar el selector. Solo se dibuja si hay más de una opción — con una sola, elegir no aporta nada:

```tsx
                {sel.duraciones.length > 1 && (
                  <div className="mt-4">
                    <p className="mb-2 text-sm font-semibold text-neutral-300">¿Cuánto tiempo?</p>
                    <div className="grid grid-cols-3 gap-2">
                      {sel.duraciones.map((d) => (
                        <button
                          key={d.min}
                          type="button"
                          onClick={() => setDuracionSel(d.min)}
                          className={`rounded-xl border-2 p-2 text-center ${duracionSel === d.min ? 'border-lime-500 bg-neutral-800' : 'border-neutral-700 bg-neutral-900'}`}
                        >
                          <span className="block text-sm font-bold text-neutral-100">{etiquetaDuracion(d.min)}</span>
                          <span className="block text-xs text-lime-400">{money(d.precio)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
```

Y agregar el helper cerca de `money` (línea ~8), en español y sin decimales raros:

```ts
const etiquetaDuracion = (min: number) => (min === 60 ? '1 hora' : min === 90 ? '1½ horas' : `${min / 60} horas`);
```

- [ ] **Step 6: Mandar la duración al confirmar**

En `confirmar()`, agregar el campo a la llamada:

```tsx
      const r = await crearReserva({ canchaId: sel.canchaId, fecha, horaInicio: sel.hora, nombre: nombre.trim(), telefono, duracionMin: duracionSel });
```

- [ ] **Step 7: Verificar build y lint**

```bash
pnpm build
pnpm lint
```

Esperado: build exitoso; lint con **exactamente 1** error, el preexistente de `pantalla-reserva.tsx`. Si aparecen 2 o más, algo tuyo lo causó.

- [ ] **Step 8: Chequeo visual**

```bash
pnpm dev
```

Requiere que el backend esté corriendo y que `API_URL` y `SERVICE_API_KEY` estén en `.env`. Si no podés levantar el backend, **decilo explícitamente en el informe** en vez de afirmar que verificaste — informar una verificación que no hiciste es peor que no hacerla.

Si podés: a 375 px y en desktop, confirmar que al abrir un turno aparecen las tres opciones con precios distintos, que la seleccionada se resalta en lima, y que un turno cerca del cierre muestra menos opciones.

- [ ] **Step 9: Commit**

```bash
git add reservas/src/lib/types.ts reservas/src/lib/actions.ts reservas/src/components/pantalla-reserva.tsx
git commit -m "feat(reservas): selector de duracion con precios en el modal de reserva"
```

---

### Task 2: Que el resumen y la confirmación digan la duración

Sin esto el cliente elige 2 horas y la pantalla de éxito le dice lo mismo que si hubiera elegido 1: no tiene forma de confirmar que reservó lo que quería.

**Files:**
- Modify: `reservas/src/components/pantalla-reserva.tsx`

**Interfaces:**
- Consumes: `duracionSel`, `sel.duraciones` y `etiquetaDuracion` (Task 1).
- Produces: nada.

- [ ] **Step 1: Calcular el resumen una sola vez**

Las dos ramas del modal (formulario y éxito) muestran la misma línea, así que el texto se arma
**una vez** y se usa en las dos. Nada de repetir el cálculo en el JSX.

Dentro del componente, después de la declaración de `duracionSel` y antes del `return`:

```tsx
  // Resumen del turno elegido: "Cancha 1 · lunes 4 de agosto · 17:00 a 19:00 · 2 horas".
  // `sel` puede ser null hasta que el usuario abre el modal.
  const opcionSel = sel?.duraciones.find((d) => d.min === duracionSel) ?? null;
  const resumenTurno = sel
    ? `${sel.canchaNombre} · ${fechaLarga(fecha)} · ${sel.hora}` +
      (opcionSel ? ` a ${opcionSel.horaFin} · ${etiquetaDuracion(opcionSel.min)}` : '')
    : '';
```

- [ ] **Step 2: Usar el resumen en las dos ramas del modal**

En la rama de éxito, reemplazar la línea ~191:

```tsx
                <p className="text-neutral-400">{resumenTurno}</p>
```

Y en la rama del formulario, la línea ~204:

```tsx
                <p className="mt-1 text-sm text-neutral-400">{resumenTurno}</p>
```

- [ ] **Step 3: Verificar build y lint**

```bash
pnpm build
pnpm lint
```

Esperado: build exitoso; lint sigue en **exactamente 1** error.

- [ ] **Step 4: Commit**

```bash
git add reservas/src/components/pantalla-reserva.tsx
git commit -m "feat(reservas): mostrar el rango horario y la duracion elegida en el modal"
```

---

## Cierre del Plan B1

Al terminar, el cliente puede elegir 1, 1½ o 2 horas desde la web pública, ve el precio de cada opción calculado por el backend, y la confirmación le dice exactamente qué reservó.

**Todavía no se puede deployar.** Falta el Plan B2 (panel): sin él, el mostrador ve los turnos de :30 como si fueran de :00 en el calendario semanal. La decisión de no deployar hasta tener ambos ya está tomada.
