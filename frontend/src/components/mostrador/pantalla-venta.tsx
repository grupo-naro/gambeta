'use client';
import { useEffect, useRef, useState } from 'react';
import type { CajaBuffetEstado, ProductoCobro, MedioPago, ConciliacionPendiente, StockAsignado } from '@/lib/types';
import { abrirCaja, cerrarCaja, cobrar, buscarPorCodigo, salirDelMostrador } from '@/lib/buffet-actions';
import { asignadoPorProducto } from '@/lib/mostrador-stock';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Acumulador del lector: es un teclado que "tipea" el código y cierra con Enter. */
export function parseEscaneo(buffer: string, key: string): { buffer: string; codigo: string | null } {
  if (key === 'Enter') return buffer ? { buffer: '', codigo: buffer } : { buffer: '', codigo: null };
  if (key.length !== 1) return { buffer, codigo: null };
  return { buffer: buffer + key, codigo: null };
}

/** Vuelto: nunca negativo. */
export function calcularVuelto(pagado: number, total: number): number {
  return Math.max(0, Number(pagado || 0) - total);
}

interface Item { productoId: string; nombre: string; precio: number; cantidad: number }

/** Filtra productos por nombre, sin distinguir mayúsculas ni acentos. Query vacío = todos. */
export function filtrarProductos(productos: ProductoCobro[], query: string): ProductoCobro[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = norm(query.trim());
  if (!q) return productos;
  return productos.filter((p) => norm(p.nombre).includes(q));
}

export function PantallaVenta({ inicial, productos, mostrador, pendientes, asignado }: {
  inicial: CajaBuffetEstado | null;
  productos: ProductoCobro[];
  mostrador: { nombre: string; tipo: 'PRINCIPAL' | 'SECUNDARIO' };
  pendientes: ConciliacionPendiente[];
  asignado: StockAsignado[];
}) {
  const [caja, setCaja] = useState(inicial);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [pagoTxt, setPagoTxt] = useState('');
  const [query, setQuery] = useState('');
  const buffer = useRef('');
  const foco = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const uidCobro = useRef<string>('');

  const total = items.reduce((a, it) => a + it.precio * it.cantidad, 0);
  const vuelto = calcularVuelto(Number(pagoTxt), total);
  const esSecundario = mostrador.tipo === 'SECUNDARIO';
  const yaTiene = asignadoPorProducto(asignado);

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

  function agregar(p: { id: string; nombre: string; precio: number }) {
    setError('');
    setItems((prev) => {
      const i = prev.findIndex((x) => x.productoId === p.id);
      if (i >= 0) { const cp = [...prev]; cp[i] = { ...cp[i], cantidad: cp[i].cantidad + 1 }; return cp; }
      return [...prev, { productoId: p.id, nombre: p.nombre, precio: p.precio, cantidad: 1 }];
    });
  }
  function cambiarCantidad(id: string, delta: number) {
    setItems((prev) => prev.flatMap((x) => x.productoId === id ? (x.cantidad + delta <= 0 ? [] : [{ ...x, cantidad: x.cantidad + delta }]) : [x]));
  }
  function vaciar() { setItems([]); }

  async function onCodigo(codigo: string) {
    if (ocupado || cobrando) return;
    setOcupado(true);
    const r = await buscarPorCodigo(codigo);
    setOcupado(false);
    if (r.ok) agregar(r.data);
    else setError(/no encontr|not found/i.test(r.error) ? 'Producto no cargado' : r.error);
  }

  async function confirmarCobro() {
    if (ocupado || items.length === 0) return;
    if (medio === 'EFECTIVO' && Number(pagoTxt) < total) { setError('El monto es menor al total'); return; }
    setOcupado(true);
    const r = await cobrar({
      uid: uidCobro.current,
      medioPago: medio,
      montoPagado: medio === 'EFECTIVO' ? Number(pagoTxt) : total,
      items: items.map((it) => ({ productoId: it.productoId, cantidad: it.cantidad })),
    });
    setOcupado(false);
    if (!r.ok) { setError(r.error); return; }
    setCaja(r.data.caja);
    setItems([]); setPagoTxt(''); setMedio('EFECTIVO'); setCobrando(false); setError('');
  }

  if (!caja) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <button type="button" disabled={ocupado} onMouseDown={(e) => e.preventDefault()}
          onClick={async () => { setOcupado(true); const r = await abrirCaja(); setOcupado(false); if (r.ok) setCaja(r.data); else setError(r.error); }}
          className="h-32 w-full max-w-md rounded-3xl bg-emerald-600 text-4xl font-semibold text-white active:scale-95">
          Abrir caja
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <input ref={foco} className="sr-only" aria-hidden tabIndex={-1} autoFocus
        onKeyDown={(e) => { const r = parseEscaneo(buffer.current, e.key); buffer.current = r.buffer; if (r.codigo) { e.preventDefault(); void onCodigo(r.codigo); } }}
        onChange={() => { /* el valor real vive en buffer.current */ }} value="" />

      {/* Con dos puestos, cobrar en el mostrador equivocado ensucia la conciliación del cierre
          y no hay forma de darse cuenta después. Por eso la identidad va siempre visible. */}
      <div className="flex items-center justify-between rounded-2xl bg-neutral-100 px-4 py-2">
        <p className="font-semibold text-neutral-800">
          {mostrador.nombre}
          <span className="ml-2 text-xs font-normal uppercase text-neutral-500">{mostrador.tipo}</span>
        </p>
        <button
          type="button"
          onClick={() => { void salirDelMostrador().then(() => { window.location.href = '/mostrador/pin'; }); }}
          className="rounded-lg border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700"
        >
          Salir
        </button>
      </div>

      {mostrador.tipo === 'PRINCIPAL' && (
        <div className="flex flex-wrap items-center gap-2">
          <a href="/mostrador/entregar" className="rounded-xl border border-emerald-600 px-4 py-2 font-semibold text-emerald-700">
            Entregar al secundario
          </a>
          {/* El conteo es presencial: el secundario cierra, trae lo que sobro y se cuenta ahi
              mismo. Por eso el aviso va arriba de todo y no escondido en un menu. */}
          {pendientes.map((p) => (
            <a
              key={p.cajaId}
              href={`/mostrador/conciliar/${p.cajaId}`}
              className="rounded-xl bg-amber-500 px-4 py-2 font-bold text-white"
            >
              Contar el cierre de {p.mostradorNombre}
            </a>
          ))}
        </div>
      )}

      <header className="rounded-2xl bg-emerald-50 p-4 text-center ring-1 ring-emerald-600/20">
        <p className="text-sm font-medium text-emerald-700">Total del turno</p>
        <p className="text-3xl font-bold tabular-nums text-emerald-800">{money(caja.totalMonto)}</p>
        <p className="mt-1 text-sm text-emerald-700">Efectivo {money(caja.totalEfectivo)} · Transferencia {money(caja.totalTransferencia)}</p>
      </header>

      <div aria-live="polite" className="min-h-8 text-center text-xl font-semibold text-red-600">{error}</div>

      {/* Carrito */}
      <section className="rounded-2xl border-2 border-neutral-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold">Carrito</p>
          <p className="text-2xl font-bold tabular-nums">{money(total)}</p>
        </div>
        {items.length === 0 ? (
          <p className="py-4 text-center text-neutral-500">Escaneá o tocá un producto</p>
        ) : (
          <ul className="mt-2 divide-y">
            {items.map((it) => (
              <li key={it.productoId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{it.nombre} <span className="text-neutral-500">{money(it.precio)}</span></span>
                <div className="flex items-center gap-2">
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cambiarCantidad(it.productoId, -1)} className="h-9 w-9 rounded-lg border text-xl">–</button>
                  <span className="w-6 text-center tabular-nums">{it.cantidad}</span>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cambiarCantidad(it.productoId, +1)} className="h-9 w-9 rounded-lg border text-xl">+</button>
                  <span className="w-20 text-right tabular-nums">{money(it.precio * it.cantidad)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Buscador */}
      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto…" aria-label="Buscar producto"
          className="w-full rounded-2xl border-2 border-neutral-300 p-3 text-xl" />
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border-2 border-neutral-200 bg-white">
          {filtrarProductos(productos, query).map((p) => {
            const tiene = yaTiene[p.id] ?? 0;
            const sinAsignado = esSecundario && tiene === 0;
            return (
              <button key={p.id} type="button" disabled={ocupado || sinAsignado} onMouseDown={(e) => e.preventDefault()}
                onClick={() => agregar(p)}
                className="flex w-full items-center justify-between border-b p-3 text-left text-lg active:bg-neutral-100 disabled:opacity-40">
                <span>
                  {p.nombre}
                  {/* Sin esto, tocar un producto que no le entregaron termina en un error del
                      backend con el cliente adelante. */}
                  {esSecundario && <span className="block text-xs text-neutral-500">Tenés {tiene}</span>}
                </span>
                <span className="tabular-nums text-neutral-500">{money(p.precio)}</span>
              </button>
            );
          })}
          {filtrarProductos(productos, query).length === 0 && (
            <p className="p-4 text-center text-neutral-500">Sin resultados</p>
          )}
          {esSecundario && asignado.length === 0 && (
            <p className="p-4 text-center text-amber-700">
              No tenés stock asignado. Pedile al mostrador principal que te entregue.
            </p>
          )}
        </div>
      </section>

      <footer className="flex gap-3">
        <button type="button" disabled={ocupado || items.length === 0} onMouseDown={(e) => e.preventDefault()} onClick={vaciar}
          className="h-16 flex-1 rounded-2xl border-2 border-neutral-300 bg-white text-xl font-semibold active:scale-95 disabled:opacity-40">
          Vaciar
        </button>
        <button type="button" disabled={ocupado || items.length === 0} onMouseDown={(e) => e.preventDefault()} onClick={() => { setPagoTxt(''); setMedio('EFECTIVO'); uidCobro.current = crypto.randomUUID(); setCobrando(true); }}
          className="h-16 flex-[2] rounded-2xl bg-emerald-600 text-2xl font-bold text-white active:scale-95 disabled:opacity-40">
          Cobrar {money(total)}
        </button>
        <button type="button" disabled={ocupado} onMouseDown={(e) => e.preventDefault()}
          onClick={async () => { if (!confirm(`¿Cerrar la caja? Se vendieron ${money(caja.totalMonto)}.`)) return; setOcupado(true); const r = await cerrarCaja(); setOcupado(false); if (r.ok) { alert(`Caja cerrada.\nEfectivo ${money(r.data.totalEfectivo)} · Transferencia ${money(r.data.totalTransferencia)}`); setCaja(null); setItems([]); } else setError(r.error); }}
          className="h-16 flex-1 rounded-2xl bg-neutral-900 text-lg font-semibold text-white active:scale-95">
          Cerrar caja
        </button>
      </footer>

      {/* Pantalla de cobro */}
      {cobrando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCobrando(false)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-lg text-neutral-600">Total a cobrar</p>
            <p className="text-center text-5xl font-bold tabular-nums">{money(total)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMedio('EFECTIVO')} className={`h-14 rounded-xl border-2 text-lg font-semibold ${medio === 'EFECTIVO' ? 'border-emerald-600 bg-emerald-50' : 'border-neutral-300'}`}>Efectivo</button>
              <button type="button" onClick={() => setMedio('TRANSFERENCIA')} className={`h-14 rounded-xl border-2 text-lg font-semibold ${medio === 'TRANSFERENCIA' ? 'border-emerald-600 bg-emerald-50' : 'border-neutral-300'}`}>Transferencia</button>
            </div>
            {medio === 'EFECTIVO' && (
              <div className="mt-4">
                <label className="block text-sm text-neutral-600">¿Con cuánto paga?</label>
                <input autoFocus inputMode="numeric" value={pagoTxt} onChange={(e) => setPagoTxt(e.target.value.replace(/\D/g, ''))}
                  className="mt-1 w-full rounded-xl border-2 border-neutral-300 p-3 text-3xl tabular-nums" />
                <p className="mt-2 text-center text-2xl font-semibold">Vuelto: <span className="tabular-nums">{money(vuelto)}</span></p>
              </div>
            )}
            {error && <p className="mt-3 text-center text-red-600">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => { setCobrando(false); setError(''); }} className="h-14 flex-1 rounded-xl border-2 border-neutral-300 text-lg font-semibold">Cancelar</button>
              <button type="button" disabled={ocupado || (medio === 'EFECTIVO' && Number(pagoTxt) < total)} onClick={() => void confirmarCobro()}
                className="h-14 flex-[2] rounded-xl bg-emerald-600 text-xl font-bold text-white disabled:opacity-40">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
