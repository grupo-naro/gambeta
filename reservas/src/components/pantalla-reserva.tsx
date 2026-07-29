'use client';
import { useEffect, useState, useTransition } from 'react';
import { getGrilla, crearReserva, crearPreferenciaPago } from '@/lib/actions';
import type { Deporte, Grilla } from '@/lib/types';
import { Calendario } from './calendario';
import { SelectorFechaMobile } from './selector-fecha-mobile';

const money = (n: number | null) => (n == null ? '' : '$' + Number(n).toLocaleString('es-AR'));
const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const fechaLarga = (fecha: string) => {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
};

const DEPORTES: { key: Deporte; label: string; icon: string }[] = [
  { key: 'futbol', label: 'Fútbol', icon: '⚽' },
  { key: 'padel', label: 'Pádel', icon: '🎾' },
];

export function PantallaReserva() {
  const [deporte, setDeporte] = useState<Deporte>('futbol');
  const [fecha, setFecha] = useState(hoyISO());
  const [canchaSelId, setCanchaSelId] = useState('');
  const [grilla, setGrilla] = useState<Grilla | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorGrilla, setErrorGrilla] = useState('');
  const [sel, setSel] = useState<{ canchaId: string; canchaNombre: string; hora: string } | null>(null);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [errorForm, setErrorForm] = useState('');
  const [ok, setOk] = useState<{ senia: number | null; contacto?: string } | null>(null);
  const [pending, start] = useTransition();

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

  function recargar() { getGrilla(deporte, fecha).then((r) => { if (r.ok) setGrilla(r.data); }); }
  function abrirForm(canchaId: string, canchaNombre: string, hora: string) {
    setSel({ canchaId, canchaNombre, hora }); setNombre(''); setTelefono(''); setErrorForm(''); setOk(null);
  }
  function cerrarModal() { setSel(null); setOk(null); setErrorForm(''); }

  function confirmar() {
    if (!sel) return;
    if (nombre.trim().length < 2) { setErrorForm('Ingresá tu nombre'); return; }
    if (telefono.replace(/\D/g, '').length < 10) { setErrorForm('Ingresá un teléfono válido (10 dígitos)'); return; }
    setErrorForm('');
    start(async () => {
      const r = await crearReserva({ canchaId: sel.canchaId, fecha, horaInicio: sel.hora, nombre: nombre.trim(), telefono });
      if (!r.ok) { setErrorForm(r.error); recargar(); return; }
      const senia = r.data.montoSena == null ? null : Number(r.data.montoSena);
      if (senia != null && senia > 0) {
        const pref = await crearPreferenciaPago(r.data.id);
        if (pref.ok) { window.location.href = pref.data.checkoutUrl; return; }
        // La reserva quedó registrada igual; avisamos que no se pudo generar el link de pago.
        setOk({ senia, contacto: 'No pudimos generar el link de pago. Te contactaremos para coordinarlo.' });
        recargar();
        return;
      }
      setOk({ senia });
      recargar();
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
                              <button type="button" disabled={!libre} onClick={() => abrirForm(c.id, c.nombre, h)}
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
                            <button type="button" onClick={() => abrirForm(canchaSel.id, canchaSel.nombre, h)}
                              className="flex-1 rounded-full bg-lime-500 py-3 text-center font-bold uppercase text-black active:scale-95">
                              Disponible
                            </button>
                          ) : (
                            <span className="flex-1 rounded-full bg-neutral-800 py-3 text-center font-semibold uppercase text-neutral-600">Ocupado</span>
                          )}
                          <span className="w-24 text-right font-semibold text-lime-400">{money(precio)}</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={cerrarModal}>
          <div className="w-full max-w-sm rounded-2xl bg-neutral-900 p-6 text-neutral-100 ring-1 ring-neutral-700" onClick={(e) => e.stopPropagation()}>
            {ok ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="text-5xl">✅</div>
                <h3 className="text-xl font-bold">¡Reserva registrada!</h3>
                <p className="text-neutral-400">{sel.canchaNombre} · {fechaLarga(fecha)} · {sel.hora}</p>
                {ok.contacto
                  ? <p className="text-amber-400">{ok.contacto}</p>
                  : ok.senia != null && ok.senia > 0
                  ? <p>Para confirmarla, aboná la seña de <b>{money(ok.senia)}</b>.</p>
                  : <p>Te contactamos para confirmarla.</p>}
                <button type="button" onClick={cerrarModal} className="mt-2 rounded-xl bg-lime-500 px-6 py-2 font-bold text-black">Listo</button>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold">Reservar</h3>
                <p className="mt-1 text-sm text-neutral-400">{sel.canchaNombre} · {fechaLarga(fecha)} · {sel.hora}</p>
                <div className="mt-4 space-y-3">
                  <input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-xl border border-neutral-700 bg-neutral-800 p-3 text-neutral-100 placeholder:text-neutral-500" />
                  <input placeholder="Teléfono (ej: 11 3662 0274)" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="w-full rounded-xl border border-neutral-700 bg-neutral-800 p-3 text-neutral-100 placeholder:text-neutral-500" />
                </div>
                {errorForm && <p className="mt-2 text-red-400">{errorForm}</p>}
                <div className="mt-4 flex gap-3">
                  <button type="button" onClick={cerrarModal} className="flex-1 rounded-xl border border-neutral-600 py-2 font-semibold">Cancelar</button>
                  <button type="button" disabled={pending} onClick={confirmar} className="flex-[2] rounded-xl bg-lime-500 py-2 font-bold text-black disabled:opacity-50">{pending ? 'Reservando…' : 'Confirmar'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
