# Precio propio por duración (pádel) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una cancha pueda tener un precio propio para 1½ y 2 horas, en banda base y en pico, en vez de derivarlo proporcionalmente del precio por hora.

**Architecture:** Cuatro campos opcionales en `Cancha`. `precioDeRango` **no cambia su lógica de prorrateo**: solo cambia de dónde saca las dos tarifas horarias que ya usa. Un precio por duración se convierte a su tarifa horaria equivalente (`precio × 60 / duracion`) y el resto de la función queda intacto.

**Tech Stack:** Express 5, Prisma 7, TypeScript ESM, PostgreSQL 16, vitest + Testcontainers (backend, **npm**). Next.js 16, Tailwind v4 (panel, **pnpm**).

**Spec:** `docs/superpowers/specs/2026-08-06-precio-por-duracion-padel-design.md`

## Global Constraints

- **Todo en español**: código, comentarios, copy, nombres. No traducir `cancha`, `seña`, `turno`, `fijo`, `abono`.
- **Los cuatro campos son opcionales.** Sin ellos el precio se calcula **exactamente como hoy**. Ninguna fila existente se migra y fútbol no se ve afectado.
- **La decisión es por duración, no por cancha**: una cancha puede tener `precio120` y no `precio90`. En ese caso 2 horas usa el suyo y 1½ cae al proporcional.
- **No validar que el precio por duración sea menor al proporcional.** Un predio puede querer cobrar más por 2 horas (mueve luces, personal). Prohibirlo sería una regla que nadie pidió.
- **Ningún cálculo de plata en el browser.** El backend manda los montos.
- **No cambies la autenticación de ninguna ruta.** Si un test falla por permisos, adaptá el test: en una tarea anterior de este proyecto alguien relajó un endpoint para que pasara un test y hubo que revertirlo.
- **ENTORNO:** la máquina del usuario se congeló dos veces por carga de procesos. **No levantes servidores de desarrollo ni navegadores.** Docker sí hace falta para los tests de integración. Tests/build/lint una vez cada uno por tarea.
- **Baselines**: backend `434 pasan / 3 fallan` (`analytics` ×2, `disponibilidad-tamano` ×1, preexistentes y ajenos) + 21 omitidos por el flag de socios. Panel: `119 / 2` (`validators`, ajenos); lint `4 problems (3 errors, 1 warning)`, sale con código 1 aun en baseline.

## La idea que hace el cambio chico

`precioDeRango` hoy toma dos tarifas **por hora** (`precioHora`, `precioHoraPico`) y prorratea:

```
precio = (minutosBase × base + minutosPico × pico) / 60
```

Un precio por duración se puede expresar como **su tarifa horaria equivalente**:

```
tarifaBase = precio90 × 60 / 90
```

Con eso, **la fórmula de prorrateo no se toca**: solo cambia de dónde salen `base` y `pico`.

Y la regresión queda garantizada por construcción: sin campos nuevos, `base = precioHora` y
`pico = precioHoraPico`, que es literalmente el código actual.

Verificación con los números del spec (`precio90 = 36.000`, `precio90Pico = 45.000`, turno 17:00–18:30 con pico desde las 18:00):

```
tarifaBase = 36.000 × 60/90 = 24.000
tarifaPico = 45.000 × 60/90 = 30.000
precio = (60 × 24.000 + 30 × 30.000) / 60 = 39.000   ✓ coincide con el spec
```

## Estructura de archivos

| Archivo | Qué cambia |
|---|---|
| `backend/prisma/schema.prisma` | 4 campos opcionales en `Cancha`. **Una** migración. |
| `backend/src/validators/cancha.schema.ts` | Los 4 campos, opcionales y positivos. |
| `backend/src/services/precio.service.ts` | Un helper que resuelve las tarifas horarias; el prorrateo no se toca. |
| `backend/tests/unit/precio.service.test.ts` | Casos nuevos + regresión. |
| `frontend/src/lib/types.ts` | Los 4 campos en `Cancha`. |
| `frontend/src/components/canchas/cancha-dialog.tsx` | Los 4 campos en el formulario. |

---

### Task 1: Esquema, migración y validador

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/validators/cancha.schema.ts`

**Interfaces:**
- Produces: `Cancha` con `precio90?`, `precio90Pico?`, `precio120?`, `precio120Pico?`. `POST`/`PATCH /canchas` los aceptan opcionales.

- [ ] **Step 1: Ampliar el esquema**

En `model Cancha`, junto a `precioHoraPico`:

```prisma
  /// Precio propio por duración, por banda. Opcionales: si faltan, el precio de esa duración
  /// se deriva proporcionalmente de precioHora/precioHoraPico, como siempre.
  /// La decisión es POR DURACIÓN: una cancha puede tener precio120 y no precio90.
  precio90      Decimal?            @db.Decimal(10, 2)
  precio90Pico  Decimal?            @db.Decimal(10, 2)
  precio120     Decimal?            @db.Decimal(10, 2)
  precio120Pico Decimal?            @db.Decimal(10, 2)
```

- [ ] **Step 2: Crear la migración**

```bash
npx prisma migrate dev --name precio_por_duracion
npx prisma generate
```

Esperado: una migración con cuatro `ADD COLUMN` nullable. **Si Prisma pide un default o avisa de posible pérdida de datos, algo quedó mal declarado: pará y avisá, no lo fuerces.**

**Nota:** la base de desarrollo local de este proyecto arrastra un *drift* preexistente y ajeno (la FK de `Cobro.suscripcionId`), y `migrate dev` puede exigir un `migrate reset`. **No reseteés.** Si pasa, generá la migración con `prisma migrate diff` contra un Postgres temporal limpio partiendo de las migraciones existentes, verificá que el SQL sea solo `ADD COLUMN` nullable, y dejalo asentado en el informe. Ya se resolvió así antes en este repo.

- [ ] **Step 3: Ampliar el validador**

En `backend/src/validators/cancha.schema.ts`, agregar a los `body` de creación **y** de edición:

```ts
    precio90: z.number().positive().nullable().optional(),
    precio90Pico: z.number().positive().nullable().optional(),
    precio120: z.number().positive().nullable().optional(),
    precio120Pico: z.number().positive().nullable().optional(),
```

`nullable` a propósito: el panel tiene que poder **borrar** un precio propio y volver al proporcional.

- [ ] **Step 4: Verificar**

```bash
npm run typecheck
npm test
```

Esperado: typecheck limpio; la suite **no sube de 3 fallos**.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma backend/src/validators
git commit -m "feat(precios): campos de precio por duracion en canchas"
```

---

### Task 2: El cálculo usa el precio propio cuando existe

**Files:**
- Modify: `backend/src/services/precio.service.ts`
- Test: `backend/tests/unit/precio.service.test.ts`

**Interfaces:**
- Consumes: los campos de la Task 1.
- Produces: `precioDeRango` sin cambio de firma. `CanchaPrecio` suma los cuatro campos opcionales.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/unit/precio.service.test.ts` (leelo antes: reusá su `cfg` y su estilo):

```ts
describe('precio propio por duración', () => {
  const cfg = { picoDesde: '18:00', picoHasta: '00:00', picoFindeDesde: '18:00', picoFindeHasta: '00:00' };
  // 2026-06-10 es miércoles (semana).
  const conPropio = {
    precioHora: 27000, precioHoraPico: 33000,
    precio90: 36000, precio90Pico: 45000,
    precio120: null, precio120Pico: null,
  };

  it('usa el precio propio de 1½ hora en vez del proporcional', () => {
    // Proporcional daría 27.000 × 1,5 = 40.500. Con precio propio, 36.000.
    expect(precioDeRango(conPropio, '2026-06-10', '08:00', 90, cfg)).toBe(36000);
  });

  it('usa el precio propio de pico cuando el turno cae entero en pico', () => {
    expect(precioDeRango(conPropio, '2026-06-10', '19:00', 90, cfg)).toBe(45000);
  });

  it('interpola entre los dos precios propios cuando cruza el borde', () => {
    // 17:00–18:30: 60 min base + 30 min pico.
    // tarifas horarias equivalentes: 24.000 y 30.000 → (60×24.000 + 30×30.000)/60 = 39.000
    expect(precioDeRango(conPropio, '2026-06-10', '17:00', 90, cfg)).toBe(39000);
  });

  it('una duración sin precio propio cae al proporcional', () => {
    // precio120 es null: 2 horas usa precioHora × 2.
    expect(precioDeRango(conPropio, '2026-06-10', '08:00', 120, cfg)).toBe(54000);
  });

  it('1 hora nunca se ve afectada: precioHora YA es su precio propio', () => {
    expect(precioDeRango(conPropio, '2026-06-10', '08:00', 60, cfg)).toBe(27000);
    expect(precioDeRango(conPropio, '2026-06-10', '19:00', 60, cfg)).toBe(33000);
  });

  it('REGRESIÓN: sin campos nuevos el resultado es idéntico al de hoy', () => {
    const sinPropio = { precioHora: 30000, precioHoraPico: 36000 };
    expect(precioDeRango(sinPropio, '2026-06-10', '08:00', 90, cfg)).toBe(45000);
    expect(precioDeRango(sinPropio, '2026-06-10', '17:00', 120, cfg)).toBe(66000);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run tests/unit/precio.service.test.ts
```

Esperado: FAIL en los cuatro primeros (devuelven el proporcional); los dos últimos ya pasan.

- [ ] **Step 3: Implementar**

En `precio.service.ts`, ampliar la interfaz interna:

```ts
interface CanchaPrecio {
  precioHora: unknown; precioHoraPico: unknown;
  precio90?: unknown; precio90Pico?: unknown;
  precio120?: unknown; precio120Pico?: unknown;
}
```

Agregar el helper **antes** de `precioDeRango`:

```ts
/**
 * Tarifas horarias (base y pico) a usar para una duración dada.
 *
 * Un precio propio por duración se expresa como su tarifa horaria equivalente
 * (`precio × 60 / duracion`), y así el prorrateo de `precioDeRango` no cambia: solo cambia
 * de dónde salen sus dos tarifas. Sin precio propio devuelve las de la cancha, que es
 * exactamente el comportamiento de siempre.
 *
 * La decisión es por duración y por banda: si falta el precio de una banda, esa banda cae
 * al proporcional aunque la otra tenga precio propio.
 */
function tarifasDe(cancha: CanchaPrecio, duracionMin: number): { base: number; pico: number } {
  const base = Number(cancha.precioHora);
  const pico = Number(cancha.precioHoraPico);
  const propio = duracionMin === 90
    ? { b: cancha.precio90, p: cancha.precio90Pico }
    : duracionMin === 120
    ? { b: cancha.precio120, p: cancha.precio120Pico }
    : { b: null, p: null }; // 1 hora: precioHora YA es su precio propio.
  const aTarifa = (v: unknown) => (v == null ? null : (Number(v) * 60) / duracionMin);
  return { base: aTarifa(propio.b) ?? base, pico: aTarifa(propio.p) ?? pico };
}
```

Y en `precioDeRango`, reemplazar las dos primeras líneas:

```ts
  const base = Number(cancha.precioHora);
  const pico = Number(cancha.precioHoraPico);
```

por:

```ts
  const { base, pico } = tarifasDe(cancha, duracionMin);
```

**El resto de la función no se toca.** Los early returns al proporcional, la normalización de la franja con `cierreMin`, el cálculo de `minutosPico` y el `Math.round` final quedan igual: ya operan sobre `base` y `pico`, que ahora simplemente tienen el valor correcto para esa duración.

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npx vitest run tests/unit/precio.service.test.ts
npm run typecheck
npm test
```

Esperado: todos los tests del archivo pasan, incluidos los que ya existían; typecheck limpio; la suite **no sube de 3 fallos**.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services backend/tests
git commit -m "feat(precios): usar el precio propio de la duracion cuando esta cargado"
```

---

### Task 3: Cargar los precios desde el panel

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/validators.ts` (`canchaSchema`)
- Modify: `frontend/src/components/canchas/cancha-dialog.tsx`

**Ojo con esto**, que es fácil de pasar por alto: el diálogo valida con un **schema zod propio del
panel** (`canchaSchema.safeParse({...})`, en `frontend/src/lib/validators.ts`). Si agregás los
campos al payload sin declararlos ahí, **zod los descarta en silencio** y nunca llegan al backend.
El formulario parecería andar y los precios no se guardarían.

**Interfaces:**
- Consumes: los campos de la Task 1.

- [ ] **Step 1: Ampliar el tipo**

En `frontend/src/lib/types.ts`, sumar a `Cancha`:

```ts
  precio90?: number | null;
  precio90Pico?: number | null;
  precio120?: number | null;
  precio120Pico?: number | null;
```

- [ ] **Step 2: Declarar los campos en el schema del panel**

En `frontend/src/lib/validators.ts`, dentro de `canchaSchema`, junto a `precioHoraPico`:

```ts
  precio90: z.number().positive().nullable(),
  precio90Pico: z.number().positive().nullable(),
  precio120: z.number().positive().nullable(),
  precio120Pico: z.number().positive().nullable(),
```

- [ ] **Step 3: Los campos en el formulario**

En `cancha-dialog.tsx`, junto a los estados de precio que ya existen:

```tsx
  const [precio90, setPrecio90] = useState(cancha?.precio90 != null ? String(Number(cancha.precio90)) : '');
  const [precio90Pico, setPrecio90Pico] = useState(cancha?.precio90Pico != null ? String(Number(cancha.precio90Pico)) : '');
  const [precio120, setPrecio120] = useState(cancha?.precio120 != null ? String(Number(cancha.precio120)) : '');
  const [precio120Pico, setPrecio120Pico] = useState(cancha?.precio120Pico != null ? String(Number(cancha.precio120Pico)) : '');
```

El bloque solo tiene sentido en canchas que admiten esas duraciones: hoy el fútbol se agenda solo
por hora (ver `reglasDeAgenda` en `backend/src/services/precio.service.ts`). Agregalo después del
campo de seña, siguiendo el mismo patrón de `Label` + `Input` que usan los precios existentes:

```tsx
              {tipo !== 'futbol' && (
                <div className="space-y-3 rounded-md border p-3 sm:col-span-2">
                  <p className="text-xs text-muted-foreground">
                    Precio propio por duración. Si lo dejás vacío, se calcula proporcional al precio por hora.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label htmlFor="c-p90">1½ hora</Label>
                      <Input id="c-p90" type="number" min="0" value={precio90} onChange={(e) => setPrecio90(e.target.value)} placeholder="proporcional" />
                    </div>
                    <div className="space-y-1"><Label htmlFor="c-p90-pico">1½ hora en pico</Label>
                      <Input id="c-p90-pico" type="number" min="0" value={precio90Pico} onChange={(e) => setPrecio90Pico(e.target.value)} placeholder="proporcional" />
                    </div>
                    <div className="space-y-1"><Label htmlFor="c-p120">2 horas</Label>
                      <Input id="c-p120" type="number" min="0" value={precio120} onChange={(e) => setPrecio120(e.target.value)} placeholder="proporcional" />
                    </div>
                    <div className="space-y-1"><Label htmlFor="c-p120-pico">2 horas en pico</Label>
                      <Input id="c-p120-pico" type="number" min="0" value={precio120Pico} onChange={(e) => setPrecio120Pico(e.target.value)} placeholder="proporcional" />
                    </div>
                  </div>
                </div>
              )}
```

Ajustá el `sm:col-span-2` y la ubicación exacta a la grilla real del diálogo.

- [ ] **Step 4: Enviar los campos**

En la llamada a `canchaSchema.safeParse({...})`, agregar los cuatro. **Un campo vacío va como
`null`, no como `0` ni como string vacío**: `0` sería un precio válido de cero y `''` haría fallar
el validador. `null` es lo que borra el precio propio y vuelve al proporcional.

```tsx
      const aNum = (s: string) => (s.trim() === '' ? null : Number(s));
```

y en el objeto: `precio90: aNum(precio90), precio90Pico: aNum(precio90Pico), precio120: aNum(precio120), precio120Pico: aNum(precio120Pico)`.

`editarCancha` y `crearCancha` reciben `parsed.data` completo, así que **no hay que tocar
`canchas-actions.ts`**: los campos viajan solos una vez que están en el schema.

- [ ] **Step 5: Verificar**

```bash
pnpm test
pnpm build
pnpm lint
```

Esperado: tests en el baseline (`119 / 2`); build exitoso; lint en `4 problems (3 errors, 1 warning)`, ni uno más.

No levantes `pnpm dev`: el chequeo visual lo hace el humano.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(canchas): cargar el precio por duracion desde el panel"
```

---

## Cierre

Al terminar, una cancha de pádel puede tener precio propio para 1½ y 2 horas, en banda normal y en pico, y los turnos que cruzan el borde del pico se prorratean entre esos dos precios.

**La regresión está garantizada por construcción**: sin campos cargados, `tarifasDe` devuelve `precioHora` y `precioHoraPico`, que es exactamente el código de hoy. Igual hay un test explícito que lo verifica.

**Nada más cambia.** `precioDeRango` es el único lugar donde se calcula el precio de un turno, así que la grilla de disponibilidad, la web pública, el panel y el bot muestran el precio nuevo sin tocarse.
