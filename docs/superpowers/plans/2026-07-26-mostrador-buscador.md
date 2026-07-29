# Buscador en el mostrador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la botonera de botones grandes del mostrador por un buscador que filtra todos los productos activos y los agrega al carrito al tocarlos; el escáner sigue funcionando.

**Architecture:** Nuevo endpoint `GET /buffet/productos/activos` (authBuffet) que devuelve los productos activos como `{id,nombre,precio}`. El mostrador precarga esa lista y filtra en el cliente con una función pura (`filtrarProductos`); el resultado se muestra como lista tocable. El resto del mostrador (carrito, cobro, escáner) no cambia.

**Tech Stack:** Node 22, Express, Prisma 7 + Postgres, Zod, vitest + supertest + testcontainers (backend); Next.js 16 + React 19 (frontend).

## Global Constraints

- El buscador cubre TODOS los productos activos (no solo `enBotonera`).
- Lista precargada; filtrado en el cliente por nombre, insensible a mayúsculas y acentos; query vacío = todos.
- Al agregar un producto desde el resultado, el texto del buscador se mantiene.
- El escáner sigue funcionando; mientras el buscador está enfocado, la recuperación de foco del lector se suspende (no debe robarle el foco al input de búsqueda).
- No se elimina el flag `enBotonera` ni su endpoint (el mostrador simplemente deja de usar la botonera).
- Endpoint del mostrador usa `authBuffet` (header `x-buffet-key`). Tests: `BUFFET_API_KEY` se setea en el archivo de test.
- No tocar `ortigoza/`.

---

## Task 1: Backend — endpoint de productos activos

**Files:**
- Modify: `backend/src/services/buffetProducto.service.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-productos.test.ts`

**Interfaces:**
- Produces:
  - `buffetProductoService.listActivos() → Promise<{ id: string; nombre: string; precio: number }[]>`
  - Ruta `GET /buffet/productos/activos` (authBuffet) → ese array, ordenado por `nombre` asc.

- [ ] **Step 1: Agregar `listActivos` al service**

En `backend/src/services/buffetProducto.service.ts`, agregar dentro del objeto `buffetProductoService` (después de `listBotonera`):
```ts
  async listActivos(): Promise<{ id: string; nombre: string; precio: number }[]> {
    const rows = await prisma.productoBuffet.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
    return rows.map((p) => ({ id: p.id, nombre: p.nombre, precio: Number(p.precio) }));
  },
```

- [ ] **Step 2: Agregar la ruta**

En `backend/src/routes/buffet.routes.ts`, en la sección Mostrador, justo después del handler de `/productos/botonera`, agregar:
```ts
buffetRoutes.get('/productos/activos', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetProductoService.listActivos()); } catch (e) { next(e); }
});
```

- [ ] **Step 3: Escribir el test (falla primero)**

En `backend/tests/integration/buffet-productos.test.ts`, agregar al final del archivo (fuera del `describe` existente):
```ts
describe('buffet: productos activos (mostrador)', () => {
  const mostrador = (r: any) => r.set('x-buffet-key', KEY);
  it('devuelve solo activos, ordenados por nombre, con {id,nombre,precio}', async () => {
    const p = getPrisma();
    await p.productoBuffet.create({ data: { nombre: 'Pancho', precio: '2500', stock: 5, activo: true } });
    await p.productoBuffet.create({ data: { nombre: 'Agua', precio: '1000', stock: 5, activo: true } });
    await p.productoBuffet.create({ data: { nombre: 'Viejo', precio: '100', stock: 0, activo: false } });

    const r = await mostrador(supertest(app).get('/buffet/productos/activos'));
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.nombre)).toEqual(['Agua', 'Pancho']);
    expect(r.body[0]).toEqual({ id: expect.any(String), nombre: 'Agua', precio: 1000 });
  });

  it('sin buffet-key devuelve 401', async () => {
    const r = await supertest(app).get('/buffet/productos/activos');
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 4: Correr el test**

```bash
cd backend && npm test -- buffet-productos
```
Expected: pasa el nuevo `describe` junto con los existentes (testcontainers ya tiene el schema).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/buffetProducto.service.ts backend/src/routes/buffet.routes.ts backend/tests/integration/buffet-productos.test.ts
git commit -m "feat(buffet): endpoint GET /productos/activos para el buscador del mostrador"
```

---

## Task 2: Frontend — buscador en el mostrador (reemplaza la botonera)

**Files:**
- Modify: `frontend/src/app/mostrador/page.tsx`
- Modify: `frontend/src/components/mostrador/pantalla-venta.tsx`
- Test: `frontend/src/components/mostrador/pantalla-venta.test.tsx`

**Interfaces:**
- Consumes: `GET /buffet/productos/activos` (Task 1); `ProductoCobro` (`{id,nombre,precio}`, ya existe en `types.ts`).
- Produces: mostrador con buscador; función pura `filtrarProductos`.

- [ ] **Step 1: La página carga los productos activos**

Reemplazar el contenido de `frontend/src/app/mostrador/page.tsx` por:
```tsx
import { redirect } from 'next/navigation';
import { sesionBuffetValida } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { CajaBuffetEstado, ProductoCobro } from '@/lib/types';
import { PantallaVenta } from '@/components/mostrador/pantalla-venta';

export default async function MostradorPage() {
  if (!(await sesionBuffetValida())) redirect('/mostrador/pin');
  const [caja, productos] = await Promise.all([
    buffetFetch<CajaBuffetEstado | null>('/buffet/caja/actual'),
    buffetFetch<ProductoCobro[]>('/buffet/productos/activos'),
  ]);
  return <PantallaVenta inicial={caja} productos={productos} />;
}
```

- [ ] **Step 2: Cambiar la prop y agregar `filtrarProductos` + estado de búsqueda**

En `frontend/src/components/mostrador/pantalla-venta.tsx`:

a) Cambiar el import de tipos (quitar `ProductoBuffet`, sumar `ProductoCobro`):
```tsx
import type { CajaBuffetEstado, ProductoCobro, MedioPago } from '@/lib/types';
```

b) Agregar la función pura exportada (junto a `parseEscaneo`/`calcularVuelto`):
```tsx
/** Filtra productos por nombre, sin distinguir mayúsculas ni acentos. Query vacío = todos. */
export function filtrarProductos(productos: ProductoCobro[], query: string): ProductoCobro[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = norm(query.trim());
  if (!q) return productos;
  return productos.filter((p) => norm(p.nombre).includes(q));
}
```

c) Cambiar la firma del componente:
```tsx
export function PantallaVenta({ inicial, productos }: { inicial: CajaBuffetEstado | null; productos: ProductoCobro[] }) {
```

d) Agregar estado del buscador y ref del input (junto a los otros `useState`/`useRef`):
```tsx
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
```

- [ ] **Step 3: Suspender la recuperación de foco mientras el buscador está enfocado**

En el `useEffect` de recuperación de foco, reemplazar la función `recuperar` para que no le robe el foco al buscador:
```tsx
  useEffect(() => {
    if (cobrando) return; // durante el cobro el foco va al input de pago
    const recuperar = () => {
      if (document.activeElement === search.current) return; // no pisar el buscador
      foco.current?.focus();
    };
    recuperar();
    const id = setInterval(recuperar, 1000);
    document.addEventListener('click', recuperar);
    return () => { clearInterval(id); document.removeEventListener('click', recuperar); };
  }, [cobrando]);
```

- [ ] **Step 4: Reemplazar la botonera por el buscador + lista**

Reemplazar todo el bloque `{/* Botonera */}` (la `<section className="grid flex-1 ...">...</section>`) por:
```tsx
      {/* Buscador */}
      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto…" aria-label="Buscar producto"
          className="w-full rounded-2xl border-2 border-neutral-300 p-3 text-xl" />
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border-2 border-neutral-200 bg-white">
          {filtrarProductos(productos, query).map((p) => (
            <button key={p.id} type="button" disabled={ocupado} onMouseDown={(e) => e.preventDefault()}
              onClick={() => agregar(p)}
              className="flex w-full items-center justify-between border-b p-3 text-left text-lg active:bg-neutral-100 disabled:opacity-50">
              <span>{p.nombre}</span>
              <span className="tabular-nums text-neutral-500">{money(p.precio)}</span>
            </button>
          ))}
          {filtrarProductos(productos, query).length === 0 && (
            <p className="p-4 text-center text-neutral-500">Sin resultados</p>
          )}
        </div>
      </section>
```
(El resto del componente —carrito, footer, pantalla de cobro— no cambia. `agregar` acepta `{id,nombre,precio}`, así que recibe el `ProductoCobro` directo.)

- [ ] **Step 5: Actualizar el test**

En `frontend/src/components/mostrador/pantalla-venta.test.tsx`, sumar `filtrarProductos` al import y agregar el describe:
```tsx
import { parseEscaneo, calcularVuelto, filtrarProductos } from './pantalla-venta';

describe('filtrarProductos', () => {
  const prods = [
    { id: '1', nombre: 'Coca Cola', precio: 1500 },
    { id: '2', nombre: 'Café', precio: 800 },
    { id: '3', nombre: 'Agua', precio: 1000 },
  ];
  it('query vacío devuelve todos', () => {
    expect(filtrarProductos(prods, '')).toHaveLength(3);
  });
  it('filtra por nombre, insensible a mayúsculas', () => {
    expect(filtrarProductos(prods, 'coca').map((p) => p.id)).toEqual(['1']);
  });
  it('ignora acentos (cafe encuentra Café)', () => {
    expect(filtrarProductos(prods, 'cafe').map((p) => p.id)).toEqual(['2']);
  });
  it('sin match devuelve vacío', () => {
    expect(filtrarProductos(prods, 'pizza')).toEqual([]);
  });
});
```

- [ ] **Step 6: Verificar build + tests**

```bash
cd frontend && npm run build && npm test -- pantalla-venta
```
Expected: compila sin errores de tipo (la prop `botonera` ya no existe; se usa `productos`) y pasan los tests de `pantalla-venta` (parseEscaneo, calcularVuelto, filtrarProductos).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/mostrador/page.tsx frontend/src/components/mostrador/pantalla-venta.tsx frontend/src/components/mostrador/pantalla-venta.test.tsx
git commit -m "feat(mostrador): buscador de productos en vez de la botonera"
```

---

## Notas de cierre

- El escáner y el flujo de cobro no se tocan; solo se reemplaza el selector de productos.
- La recuperación de foco del lector se suspende cuando el input de búsqueda tiene el foco
  (`document.activeElement === search.current`), así se puede escribir sin que el foco salte.
- `onMouseDown={(e) => e.preventDefault()}` en los resultados evita que el botón le saque el foco
  al buscador, de modo que el texto se mantiene para seguir agregando.
