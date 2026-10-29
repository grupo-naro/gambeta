'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CuentaBuffet, ProductoCobro, MedioPago } from '@/lib/types';
import { fijarConsumo, rendirCuenta, cancelarCuenta, cuentaImpaga } from '@/lib/buffet-actions';
import { cantidadDe, ajustarCantidad, validarRendicion, etiquetaEstado } from './cuenta-reglas';
import { calcularVuelto, filtrarProductos } from './pantalla-venta';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/**
 * Una cuenta abierta: se suman los consumos del grupo a medida que los piden (el stock baja en el
 * momento) y al final se rinde, se da por impaga o se cancela. Todos los botones se bloquean mientras
 * hay una llamada en curso: un doble toque no puede sumar ni cobrar dos veces.
 */
export function PantallaCuenta({ inicial, productos }: { inicial: CuentaBuffet; productos: ProductoCobro[] }) {
  const router = useRouter();
  const [cuenta, setCuenta] = useState(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [rindiendo, setRindiendo] = useState(false);
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [pagoTxt, setPagoTxt] = useState('');

  const abierta = cuenta.estado === 'ABIERTA';
  const volver = () => router.push('/mostrador/cuentas');

  async function fijar(productoId: string, cantidad: number) {
    if (ocupado || !abierta) return;
    setOcupado(true);
    setError('');
    const r = await fijarConsumo(cuenta.id, productoId, cantidad);
    setOcupado(false);
    if (!r.ok) { setError(r.error); return; }
    setCuenta(r.data);
  }

  async function rendir() {
    if (ocupado) return;
    const problema = validarRendicion(cuenta, medio, pagoTxt);
    if (problema) { setError(problema); return; }
    setOcupado(true);
    setError('');
    const r = await rendirCuenta(cuenta.id, medio, medio === 'EFECTIVO' ? Number(pagoTxt) : cuenta.total);
    if (!r.ok) { setOcupado(false); setError(r.error); return; }
    volver();
  }

  async function cerrarSin(accion: 'cancelar' | 'impaga') {
    if (ocupado) return;
    const aviso = accion === 'cancelar'
      ? 'Se anula la cuenta y se devuelve todo el stock. ¿Cancelarla?'
      : 'El grupo se fue sin pagar: el stock queda descontado y la cuenta queda registrada como impaga. ¿Confirmás?';
    if (!window.confirm(aviso)) return;
    setOcupado(true);
    setError('');
    const r = accion === 'cancelar' ? await cancelarCuenta(cuenta.id) : await cuentaImpaga(cuenta.id);
    if (!r.ok) { setOcupado(false); setError(r.error); return; }
    volver();
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <Link href="/mostrador/cuentas" className="rounded-xl border border-neutral-300 px-4 py-2 font-semibold text-neutral-700">← Cuentas</Link>
        <div className="text-right">
          <h1 className="text-2xl font-bold">{cuenta.canchaNombre}</h1>
          {cuenta.reserva && <p className="text-sm text-neutral-600">{cuenta.reserva.clienteNombre} · {cuenta.reserva.horaInicio}–{cuenta.reserva.horaFin}</p>}
        </div>
      </div>

      {!abierta && (
        <p className="rounded-2xl bg-neutral-100 p-4 text-center font-semibold text-neutral-700">Esta cuenta está {etiquetaEstado(cuenta.estado).toLowerCase()} y ya no se puede modificar.</p>
      )}

      <div aria-live="polite" className="min-h-8 text-center text-xl font-semibold text-red-600">{error}</div>

      <section className="rounded-2xl border-2 border-neutral-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold">Consumos</p>
          <p className="text-2xl font-bold tabular-nums">{money(cuenta.total)}</p>
        </div>
        {cuenta.lineas.length === 0 ? (
          <p className="py-4 text-center text-neutral-500">Todavía no pidieron nada</p>
        ) : (
          <ul className="mt-2 divide-y">
            {cuenta.lineas.map((l) => (
              <li key={l.productoId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{l.nombre} <span className="text-neutral-500">{money(l.precioUnit)}</span></span>
                <div className="flex items-center gap-2">
                  {abierta && <button type="button" disabled={ocupado} aria-label={`Quitar uno de ${l.nombre}`} onClick={() => void fijar(l.productoId, ajustarCantidad(l.cantidad, -1))} className="h-9 w-9 rounded-lg border text-xl disabled:opacity-40">–</button>}
                  <span className="w-6 text-center tabular-nums">{l.cantidad}</span>
                  {abierta && <button type="button" disabled={ocupado} aria-label={`Sumar uno de ${l.nombre}`} onClick={() => void fijar(l.productoId, ajustarCantidad(l.cantidad, +1))} className="h-9 w-9 rounded-lg border text-xl disabled:opacity-40">+</button>}
                  <span className="w-20 text-right tabular-nums">{money(l.subtotal)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {abierta && !rindiendo && (
        <>
          <section className="flex min-h-0 flex-1 flex-col gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto"
              className="w-full rounded-2xl border-2 border-neutral-300 p-3 text-xl" />
            <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border-2 border-neutral-200 bg-white">
              {filtrarProductos(productos, query).map((p) => (
                <button key={p.id} type="button" disabled={ocupado}
                  onClick={() => void fijar(p.id, ajustarCantidad(cantidadDe(cuenta, p.id), +1))}
                  className="flex w-full items-center justify-between border-b p-3 text-left text-lg active:bg-neutral-100 disabled:opacity-40">
                  <span>{p.nombre}{cantidadDe(cuenta, p.id) > 0 && <span className="ml-2 text-sm text-emerald-700">× {cantidadDe(cuenta, p.id)}</span>}</span>
                  <span className="tabular-nums text-neutral-600">{money(p.precio)}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-3 gap-2">
            <button type="button" disabled={ocupado} onClick={() => void cerrarSin('cancelar')} className="h-14 rounded-2xl border-2 border-neutral-300 font-semibold disabled:opacity-40">Cancelar cuenta</button>
            <button type="button" disabled={ocupado} onClick={() => void cerrarSin('impaga')} className="h-14 rounded-2xl border-2 border-amber-500 font-semibold text-amber-700 disabled:opacity-40">Se fueron sin pagar</button>
            <button type="button" disabled={ocupado || cuenta.lineas.length === 0} onClick={() => { setError(''); setRindiendo(true); }} className="h-14 rounded-2xl bg-emerald-600 text-lg font-bold text-white disabled:opacity-40">Rendir {money(cuenta.total)}</button>
          </div>
        </>
      )}

      {abierta && rindiendo && (
        <section className="space-y-4 rounded-2xl border-2 border-emerald-600 bg-white p-4">
          <p className="text-center text-lg text-neutral-600">Total a cobrar</p>
          <p className="text-center text-5xl font-bold tabular-nums">{money(cuenta.total)}</p>
          <div className="grid grid-cols-2 gap-2">
            {(['EFECTIVO', 'TRANSFERENCIA'] as MedioPago[]).map((m) => (
              <button key={m} type="button" disabled={ocupado} onClick={() => setMedio(m)}
                className={`h-14 rounded-2xl border-2 text-lg font-semibold ${medio === m ? 'border-emerald-600 bg-emerald-50' : 'border-neutral-300'}`}>
                {m === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}
              </button>
            ))}
          </div>
          {medio === 'EFECTIVO' && (
            <div className="space-y-1">
              <input inputMode="numeric" value={pagoTxt} onChange={(e) => setPagoTxt(e.target.value.replace(/\D/g, ''))}
                placeholder="Con cuánto pagan" aria-label="Monto recibido" className="w-full rounded-2xl border-2 border-neutral-300 p-3 text-center text-2xl" />
              <p className="text-center text-xl font-semibold">Vuelto: {money(calcularVuelto(Number(pagoTxt), cuenta.total))}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={ocupado} onClick={() => { setRindiendo(false); setError(''); }} className="h-14 rounded-2xl border-2 border-neutral-300 font-semibold disabled:opacity-40">Volver</button>
            <button type="button" disabled={ocupado} onClick={() => void rendir()} className="h-14 rounded-2xl bg-emerald-600 text-lg font-bold text-white disabled:opacity-40">{ocupado ? 'Cobrando…' : 'Confirmar cobro'}</button>
          </div>
        </section>
      )}
    </main>
  );
}
