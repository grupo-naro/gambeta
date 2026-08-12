'use client';
import { useEffect, useState, useTransition } from 'react';
import { getGrilla, crearReserva, crearPreferenciaPago } from '@/lib/actions';
import type { Deporte, DuracionSlot, Grilla, MetodoSena, MetodosPago } from '@/lib/types';
import { Calendario } from './calendario';
import { SelectorFechaMobile } from './selector-fecha-mobile';
import { DatosTransferencia } from './datos-transferencia';

const money = (n: number | null) => (n == null ? '' : '$' + Number(n).toLocaleString('es-AR'));
const etiquetaDuracion = (min: number) => (min === 60 ? '1 hora' : min === 90 ? '1½ horas' : `${min / 60} horas`);
const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const fechaLarga = (fecha: string) => {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
};

const DEPORTES: { key: Deporte; label: string; icon: string }[] = [
  { key: 'futbol', label: 'Fútbol', icon: '⚽' },
  { key: 'padel', label: 'Pádel', icon: '🎾' },
];

export function PantallaReserva({ metodos }: { metodos: MetodosPago }) {
  const [deporte, setDeporte] = useState<Deporte>('futbol');
  const [fecha, setFecha] = useState(hoyISO());
  const [canchaSelId, setCanchaSelId] = useState('');
  const [grilla, setGrilla] = useState<Grilla | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorGrilla, setErrorGrilla] = useState('');
  const [sel, setSel] = useState<{ canchaId: string; canchaNombre: string; hora: string; fecha: string; duraciones: DuracionSlot[] } | null>(null);
  const [duracionSel, setDuracionSel] = useState(60);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [errorForm, setErrorForm] = useState('');
  const [ok, setOk] = useState<{ senia: number | null; contacto?: string; socio?: boolean } | null>(null);
  const [paso, setPaso] = useState<'datos' | 'metodo'>('datos');
  const [transferencia, setTransferencia] = useState<{ montoSena: number } | null>(null);
  const [pending, start] = useTransition();

  // Resumen del turno elegido: "Cancha 1 · lunes 4 de agosto · 17:00 a 19:00 · 2 horas".
  // `sel` puede ser null hasta que el usuario abre el modal.
  const opcionSel = sel?.duraciones.find((d) => d.min === duracionSel) ?? null;
  const resumenTurno = sel
    ? `${sel.canchaNombre} · ${fechaLarga(sel.fecha)} · ${sel.hora}` +
      (opcionSel ? ` a ${opcionSel.horaFin} · ${etiquetaDuracion(opcionSel.min)}` : '')
    : '';

  useEffect(() => {
    let vivo = true;
    setCargando(true); setErrorGrilla('');
    getGrilla(deporte, fecha).then((r) => {
      if (!vivo) return;
      if (r.ok) setGrilla(r.data); else { setGrilla(null); setErrorGrilla(r.error); }
      setCargando(false);
    });
    return () => { vivo = false; };
  }, [deporte, fecha]);

  function recargar() {
    return getGrilla(deporte, fecha).then((r) => { if (r.ok) { setGrilla(r.data); return r.data; } return null; });
  }
  function abrirForm(canchaId: string, canchaNombre: string, hora: string, duraciones: DuracionSlot[]) {
    setSel({ canchaId, canchaNombre, hora, fecha, duraciones });
    setDuracionSel(duraciones.length ? Math.min(...duraciones.map((d) => d.min)) : 60);
    setNombre(''); setTelefono(''); setErrorForm(''); setOk(null);
    setPaso('datos'); setTransferencia(null);
  }
  function cerrarModal() {
    setSel(null); setOk(null); setErrorForm('');
    setPaso('datos'); setTransferencia(null);
  }

  // Paso 1 -> 2: solo valida. La reserva se crea recién cuando el cliente elige cómo pagar,
  // porque el método viaja en el POST y no se puede agregar después.
  function irAMetodo() {
    if (!sel) return;
    if (nombre.trim().length < 2) { setErrorForm('Ingresá tu nombre'); return; }
    if (telefono.replace(/\D/g, '').length < 10) { setErrorForm('Ingresá un teléfono válido (10 dígitos)'); return; }
    setErrorForm('');
    setPaso('metodo');
  }

  function elegir(metodoSena: MetodoSena) {
    if (!sel) return;
    start(async () => {
      const r = await crearReserva({
        canchaId: sel.canchaId, fecha: sel.fecha, horaInicio: sel.hora,
        nombre: nombre.trim(), telefono, duracionMin: duracionSel, metodoSena,
      });
      if (!r.ok) {
        // El backend rechazó por concurrencia (otro cliente ocupó el turno mientras este
        // elegía). Se vuelve al paso 1 con las duraciones que sigan disponibles.
        const g = await recargar();
        const nuevas = g?.duraciones?.[sel.canchaId]?.[sel.hora] ?? [];
        setSel({ ...sel, duraciones: nuevas });
        setPaso('datos');
        if (nuevas.length === 0) setErrorForm('Ese turno se acaba de ocupar. Elegí otro horario.');
        else if (!nuevas.some((d) => d.min === duracionSel)) {
          setDuracionSel(nuevas[0].min);
          setErrorForm(`Ya no queda lugar para ${etiquetaDuracion(duracionSel)}. Todavía podés reservar ${etiquetaDuracion(nuevas[0].min)}.`);
        } else setErrorForm(r.error);
        return;
      }

      // Socio: la reserva ya vuelve CONFIRMADA y bonificada. El método que eligió no aplica —
      // el backend lo descarta — y se le muestra la pantalla de confirmación de siempre.
      if (r.data.suscripcionId) { setOk({ senia: null, socio: true }); void recargar(); return; }

      const senia = r.data.montoSena == null ? null : Number(r.data.montoSena);
      if (senia == null || senia <= 0) { setOk({ senia }); void recargar(); return; }

      if (metodoSena === 'TRANSFERENCIA') {
        setTransferencia({ montoSena: senia });
        void recargar();
        return;
      }

      const pref = await crearPreferenciaPago(r.data.id);
      if (pref.ok) { window.location.href = pref.data.checkoutUrl; return; }
      // La reserva quedó registrada igual; avisamos que no se pudo generar el link de pago.
      setOk({ senia, contacto: 'No pudimos generar el link de pago. Te contactaremos para coordinarlo.' });
      void recargar();
    });
  }

  const deporteBotones = (
    <div className="flex gap-4">
      {DEPORTES.map((d) => (
        <button key={d.key} type="button" onClick={() => setDeporte(d.key)}
          className={`flex flex-1 flex-col items-center gap-1 rounded-2xl border-2 p-4 ${deporte === d.key ? 'border-lime-500 bg-neutral-800' : 'border-neutral-700 bg-neutral-900'}`}>
          <span className="text-3xl">{d.icon}</span>
          <span className="text-sm font-bold uppercase text-neutral-200">{d.label}</span>
        </button>
      ))}
    </div>
  );

  const tituloGrilla = `${deporte === 'futbol' ? 'Fútbol' : 'Pádel'} · ${fechaLarga(fecha)}`;
  const sinDatos = !grilla || grilla.canchas.length === 0 || grilla.horas.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      {/* ===== Desktop: grilla (sin cambios) ===== */}
      <div className="hidden flex-1 gap-6 p-4 md:grid md:grid-cols-[minmax(280px,380px)_1fr]">
        <aside className="flex flex-col gap-5">
          <div className="text-sm font-semibold uppercase leading-relaxed tracking-wide text-neutral-300">
            Seleccioná el deporte y la fecha que estás buscando.<br />
            En la tabla, buscá el horario disponible.<br />
            Seleccioná y completá el formulario.
          </div>
          {deporteBotones}
          <Calendario value={fecha} onChange={setFecha} min={hoyISO()} />
        </aside>
        <section className="flex min-w-0 flex-col">
          <h2 className="mb-3 text-lg font-bold uppercase text-lime-400">{tituloGrilla}</h2>
          {cargando ? <p className="p-6 text-neutral-500">Cargando…</p>
            : errorGrilla ? <p className="p-6 text-red-400">{errorGrilla}</p>
            : sinDatos ? <p className="p-6 text-neutral-500">No hay disponibilidad para ese día.</p>
            : (
              <div className="overflow-x-auto rounded-xl border border-neutral-800">
                <table className="w-full border-collapse text-center text-sm">
                  <thead>
                    <tr className="bg-neutral-900 text-neutral-300">
                      <th className="sticky left-0 bg-neutral-900 p-2">Hora</th>
                      {grilla!.canchas.map((c) => <th key={c.id} className="p-2 font-semibold">{c.nombre}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {grilla!.horas.map((h, i) => (
                      <tr key={h} className={i % 2 ? 'bg-neutral-950' : 'bg-neutral-900/40'}>
                        <td className="sticky left-0 bg-inherit p-2 font-semibold tabular-nums text-neutral-300">{h}</td>
                        {grilla!.canchas.map((c) => {
                          const libre = grilla!.libres[c.id]?.[h];
                          return (
                            <td key={c.id} className="p-1">
                              <button type="button" disabled={!libre} onClick={() => abrirForm(c.id, c.nombre, h, grilla!.duraciones?.[c.id]?.[h] ?? [])}
                                className={`h-9 w-full rounded ${libre ? 'bg-lime-500 font-semibold text-black hover:bg-lime-400 active:scale-95' : 'cursor-not-allowed bg-neutral-800 text-neutral-600'}`}>
                                {libre ? 'Libre' : '—'}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      </div>

      {/* ===== Mobile: select de cancha + lista ===== */}
      <div className="flex flex-1 flex-col gap-4 p-4 md:hidden">
        {deporteBotones}
        <SelectorFechaMobile value={fecha} onChange={setFecha} />
        <h2 className="text-base font-bold uppercase text-lime-400">{tituloGrilla}</h2>
        {cargando ? <p className="p-6 text-center text-neutral-500">Cargando…</p>
          : errorGrilla ? <p className="p-6 text-center text-red-400">{errorGrilla}</p>
          : sinDatos ? <p className="p-6 text-center text-neutral-500">No hay disponibilidad para ese día.</p>
          : (() => {
              const canchaSel = grilla!.canchas.find((c) => c.id === canchaSelId) ?? grilla!.canchas[0];
              return (
                <>
                  <select value={canchaSel.id} onChange={(e) => setCanchaSelId(e.target.value)}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-neutral-100">
                    {grilla!.canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  <div className="flex flex-col">
                    {grilla!.horas.map((h) => {
                      const libre = grilla!.libres?.[canchaSel.id]?.[h];
                      const precio = grilla!.precios?.[canchaSel.id]?.[h] ?? null;
                      return (
                        <div key={h} className="flex items-center gap-3 border-b border-neutral-800 py-3">
                          <span className="w-14 font-semibold tabular-nums text-neutral-300">{h}</span>
                          {libre ? (
                            <button type="button" onClick={() => abrirForm(canchaSel.id, canchaSel.nombre, h, grilla!.duraciones?.[canchaSel.id]?.[h] ?? [])}
                              className="flex-1 rounded-full bg-lime-500 py-3 text-center font-bold uppercase text-black active:scale-95">
                              Disponible
                            </button>
                          ) : (
                            <span className="flex-1 rounded-full bg-neutral-800 py-3 text-center font-semibold uppercase text-neutral-600">Ocupado</span>
                          )}
                          <span className="w-24 text-right font-semibold text-lime-400">
                            {money(precio)} <span className="text-xs text-neutral-500">/ 1 h</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
      </div>

      {/* ===== Modal (compartido) ===== */}
      {sel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          // Con una reserva ya creada esperando seña, cerrar acá de un tap accidental es
          // irrecuperable: mientras haya un POST en vuelo (`pending`) o la pantalla de datos
          // de transferencia visible, el cliente tiene que tocar "Volver" o "Listo" a propósito.
          onClick={() => { if (!pending && !transferencia) cerrarModal(); }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-neutral-900 p-6 text-neutral-100 ring-1 ring-neutral-700" onClick={(e) => e.stopPropagation()}>
            {/* El orden de este encadenado es load-bearing: socio, seña 0 y el fallback de
                Mercado Pago dejan `paso` en 'metodo' porque solo tocan `ok`/`transferencia`, así
                que `transferencia` y `ok` tienen que resolverse ANTES que `paso === 'metodo'`
                para mostrar la pantalla correcta. No reordenar sin revisar esos tres casos. */}
            {transferencia ? (
              <DatosTransferencia metodos={metodos} montoSena={transferencia.montoSena} resumenTurno={resumenTurno} onCerrar={cerrarModal} />
            ) : ok ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="text-5xl">✅</div>
                <h3 className="text-xl font-bold">{ok.socio ? '¡Turno confirmado!' : '¡Reserva registrada!'}</h3>
                <p className="text-neutral-400">{resumenTurno}</p>
                {ok.contacto
                  ? <p className="text-amber-400">{ok.contacto}</p>
                  : ok.socio
                  ? <p>Quedó <b>bonificado</b> por tu suscripción. ¡Te esperamos!</p>
                  : ok.senia != null && ok.senia > 0
                  ? <p>Para confirmarla, aboná la seña de <b>{money(ok.senia)}</b>.</p>
                  : <p>Te contactamos para confirmarla.</p>}
                <button type="button" onClick={cerrarModal} className="mt-2 rounded-xl bg-lime-500 px-6 py-2 font-bold text-black">Listo</button>
              </div>
            ) : paso === 'metodo' ? (
              <>
                <h3 className="text-lg font-bold">¿Cómo querés pagar la seña?</h3>
                <p className="mt-1 text-sm text-neutral-400">{resumenTurno}</p>
                <div className="mt-4 flex flex-col gap-2">
                  {metodos.mercadoPago && (
                    <button type="button" disabled={pending} onClick={() => elegir('MERCADO_PAGO')}
                      className="rounded-xl border-2 border-neutral-700 bg-neutral-800 p-4 text-left disabled:opacity-50">
                      <span className="block font-bold text-neutral-100">Mercado Pago</span>
                      <span className="block text-sm text-neutral-400">Pagás ahora y el turno queda confirmado solo.</span>
                    </button>
                  )}
                  {metodos.transferencia && (
                    <button type="button" disabled={pending} onClick={() => elegir('TRANSFERENCIA')}
                      className="rounded-xl border-2 border-neutral-700 bg-neutral-800 p-4 text-left disabled:opacity-50">
                      <span className="block font-bold text-neutral-100">Transferencia</span>
                      <span className="block text-sm text-neutral-400">Te damos el alias y el CBU. Confirmás mandando el comprobante.</span>
                    </button>
                  )}
                </div>
                <button type="button" disabled={pending} onClick={() => setPaso('datos')} className="mt-4 w-full rounded-xl border border-neutral-600 py-2 font-semibold">
                  {pending ? 'Reservando…' : 'Volver'}
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold">Reservar</h3>
                <p className="mt-1 text-sm text-neutral-400">{resumenTurno}</p>
                {sel.duraciones.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-sm font-semibold text-neutral-300">¿Cuánto tiempo?</p>
                    {sel.duraciones.length === 1 ? (
                      sel.duraciones.map((d) => (
                        <p key={d.min} className="mt-3 text-sm text-neutral-300">
                          {etiquetaDuracion(d.min)} · <span className="text-lime-400">{money(d.precio)}</span>
                        </p>
                      ))
                    ) : (
                      <div
                        role="radiogroup"
                        aria-label="Duración del turno"
                        className={`grid gap-2 ${sel.duraciones.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}
                      >
                        {sel.duraciones.map((d) => (
                          <button
                            key={d.min}
                            type="button"
                            role="radio"
                            aria-checked={duracionSel === d.min}
                            aria-label={`${etiquetaDuracion(d.min)}, ${money(d.precio)}`}
                            onClick={() => setDuracionSel(d.min)}
                            className={`rounded-xl border-2 p-2 text-center ${duracionSel === d.min ? 'border-lime-500 bg-neutral-800' : 'border-neutral-700 bg-neutral-900'}`}
                          >
                            <span className="block text-sm font-bold text-neutral-100">{etiquetaDuracion(d.min)}</span>
                            <span className="block text-xs text-lime-400">{money(d.precio)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-neutral-500">Total del turno. Para confirmar se abona solo la seña.</p>
                  </div>
                )}
                <div className="mt-4 space-y-3">
                  <input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-xl border border-neutral-700 bg-neutral-800 p-3 text-neutral-100 placeholder:text-neutral-500" />
                  <input placeholder="Teléfono (ej: 11 3662 0274)" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="w-full rounded-xl border border-neutral-700 bg-neutral-800 p-3 text-neutral-100 placeholder:text-neutral-500" />
                </div>
                {errorForm && <p className="mt-2 text-red-400">{errorForm}</p>}
                <div className="mt-4 flex gap-3">
                  <button type="button" onClick={cerrarModal} className="flex-1 rounded-xl border border-neutral-600 py-2 font-semibold">Cancelar</button>
                  <button type="button" onClick={irAMetodo} className="flex-[2] rounded-xl bg-lime-500 py-2 font-bold text-black">Continuar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
