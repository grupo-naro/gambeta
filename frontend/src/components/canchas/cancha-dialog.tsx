'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Cancha } from '@/lib/types';
import { canchaSchema, canchaDivisibleSchema } from '@/lib/validators';
import { crearCancha, editarCancha, crearCanchaDivisible } from '@/lib/canchas-actions';
import { TIPOS, TAMANOS_FUTBOL, OTRO_TAMANO, normalizeTipo } from '@/lib/canchas-catalogo';

function tipoFor(cancha: Cancha | null) {
  if (!cancha) return 'futbol';
  return normalizeTipo(cancha.tipo);
}

export function CanchaDialog({ open, onOpenChange, cancha }: { open: boolean; onOpenChange: (o: boolean) => void; cancha: Cancha | null }) {
  const [nombre, setNombre] = useState(cancha?.nombre ?? '');
  const [tipo, setTipo] = useState(tipoFor(cancha));
  const [jugadores, setJugadores] = useState(String(cancha?.jugadores ?? 5));
  const [destacada, setDestacada] = useState(cancha?.destacada ?? false);
  const [precio, setPrecio] = useState(cancha ? String(Number(cancha.precioHora)) : '');
  const [precioPico, setPrecioPico] = useState(cancha ? String(Number(cancha.precioHoraPico)) : '');
  const [senaMonto, setSenaMonto] = useState(cancha?.senaMonto != null ? String(Number(cancha.senaMonto)) : '');
  const [precio90, setPrecio90] = useState(cancha?.precio90 != null ? String(Number(cancha.precio90)) : '');
  const [precio90Pico, setPrecio90Pico] = useState(cancha?.precio90Pico != null ? String(Number(cancha.precio90Pico)) : '');
  const [precio120, setPrecio120] = useState(cancha?.precio120 != null ? String(Number(cancha.precio120)) : '');
  const [precio120Pico, setPrecio120Pico] = useState(cancha?.precio120Pico != null ? String(Number(cancha.precio120Pico)) : '');
  const [turnoBloque, setTurnoBloque] = useState(cancha?.turnoBloqueMin ? String(cancha.turnoBloqueMin) : '');
  const [turnoDesfase, setTurnoDesfase] = useState(String(cancha?.turnoDesfaseMin ?? 0));
  const [tipoForm, setTipoForm] = useState<'simple' | 'divisible'>('simple');
  const [partes, setPartes] = useState('3');
  const [precioEntera, setPrecioEntera] = useState('');
  const [precioParte, setPrecioParte] = useState('');
  const [jugadoresEntera, setJugadoresEntera] = useState('11');
  const [jugadoresParte, setJugadoresParte] = useState('5');
  const [pending, start] = useTransition();
  const editing = !!cancha;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNombre(cancha?.nombre ?? '');
      setTipo(tipoFor(cancha));
      setJugadores(String(cancha?.jugadores ?? 5));
      setDestacada(cancha?.destacada ?? false);
      setPrecio(cancha ? String(Number(cancha.precioHora)) : '');
      setPrecioPico(cancha ? String(Number(cancha.precioHoraPico)) : '');
      setSenaMonto(cancha?.senaMonto != null ? String(Number(cancha.senaMonto)) : '');
      setPrecio90(cancha?.precio90 != null ? String(Number(cancha.precio90)) : '');
      setPrecio90Pico(cancha?.precio90Pico != null ? String(Number(cancha.precio90Pico)) : '');
      setPrecio120(cancha?.precio120 != null ? String(Number(cancha.precio120)) : '');
      setPrecio120Pico(cancha?.precio120Pico != null ? String(Number(cancha.precio120Pico)) : '');
      setTurnoBloque(cancha?.turnoBloqueMin ? String(cancha.turnoBloqueMin) : '');
      setTurnoDesfase(String(cancha?.turnoDesfaseMin ?? 0));
      setTipoForm('simple');
      setPartes('3');
      setPrecioEntera('');
      setPrecioParte('');
      setJugadoresEntera('11');
      setJugadoresParte('5');
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    if (!editing && tipoForm === 'divisible') {
      const parsed = canchaDivisibleSchema.safeParse({ nombre, partes, precioEntera, precioParte, jugadoresEntera, jugadoresParte });
      if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
      start(async () => {
        const r = await crearCanchaDivisible(parsed.data);
        if (r.ok) { toast.success('Cancha divisible creada'); onOpenChange(false); } else toast.error(r.error);
      });
      return;
    }
    const aNum = (s: string) => (s.trim() === '' ? null : Number(s));
    const parsed = canchaSchema.safeParse({
      nombre, tipo, precioHora: precio, jugadores, destacada, precioHoraPico: precioPico || 0,
      senaMonto: senaMonto.trim() === '' ? null : Number(senaMonto),
      precio90: aNum(precio90), precio90Pico: aNum(precio90Pico), precio120: aNum(precio120), precio120Pico: aNum(precio120Pico),
      turnoBloqueMin: tipo !== 'futbol' && turnoBloque ? Number(turnoBloque) : null,
      turnoDesfaseMin: tipo !== 'futbol' && turnoBloque ? Number(turnoDesfase) : 0,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = editing ? await editarCancha(cancha!.id, parsed.data) : await crearCancha(parsed.data);
      if (r.ok) { toast.success(editing ? 'Cancha actualizada' : 'Cancha creada'); onOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Editar cancha' : 'Nueva cancha'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!editing && (
            <div className="space-y-1">
              <Label htmlFor="c-tipo-form">Tipo de cancha</Label>
              <select id="c-tipo-form" value={tipoForm} onChange={(e) => setTipoForm(e.target.value as 'simple' | 'divisible')} className="w-full rounded-md border px-2 py-1.5">
                <option value="simple">Simple</option>
                <option value="divisible">Divisible (entera + partes)</option>
              </select>
            </div>
          )}
          <div className="space-y-1"><Label htmlFor="c-nombre">Nombre</Label>
            <Input id="c-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cancha 1" />
          </div>
          {(!editing && tipoForm === 'divisible') ? (
            <>
              <div className="space-y-1"><Label htmlFor="c-partes">Cantidad de partes</Label>
                <Input id="c-partes" type="number" min="2" max="6" value={partes} onChange={(e) => setPartes(e.target.value)} placeholder="3" />
              </div>
              <div className="space-y-1"><Label htmlFor="c-jug-entera">Tamaño cancha entera</Label>
                <select id="c-jug-entera" value={jugadoresEntera} onChange={(e) => setJugadoresEntera(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                  {TAMANOS_FUTBOL.map((n) => <option key={n} value={n}>Fútbol {n}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="c-jug-parte">Tamaño de cada parte</Label>
                <select id="c-jug-parte" value={jugadoresParte} onChange={(e) => setJugadoresParte(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                  {TAMANOS_FUTBOL.map((n) => <option key={n} value={n}>Fútbol {n}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="c-precio-entera">Precio entera / hora</Label>
                <Input id="c-precio-entera" type="number" min="0" value={precioEntera} onChange={(e) => setPrecioEntera(e.target.value)} placeholder="30000" />
              </div>
              <div className="space-y-1"><Label htmlFor="c-precio-parte">Precio parte / hora</Label>
                <Input id="c-precio-parte" type="number" min="0" value={precioParte} onChange={(e) => setPrecioParte(e.target.value)} placeholder="12000" />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1"><Label htmlFor="c-subtipo">Tipo</Label>
                <select id="c-subtipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                  {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="c-jugadores">Tamaño (jugadores)</Label>
                <select id="c-jugadores" value={jugadores} onChange={(e) => setJugadores(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                  {TAMANOS_FUTBOL.map((n) => <option key={n} value={n}>Fútbol {n}</option>)}
                  <option value={OTRO_TAMANO}>Otro</option>
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="c-precio">Precio por hora</Label>
                <Input id="c-precio" type="number" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="12000" />
              </div>
              <div className="space-y-1"><Label htmlFor="c-precio-pico">Precio hora pico (opcional)</Label>
                <Input id="c-precio-pico" type="number" min="0" value={precioPico} onChange={(e) => setPrecioPico(e.target.value)} placeholder="0 = sin recargo" />
              </div>
              <div className="space-y-1"><Label htmlFor="c-sena">Monto de seña (opcional)</Label>
                <Input id="c-sena" type="number" min="0" value={senaMonto} onChange={(e) => setSenaMonto(e.target.value)} placeholder="vacío = usa el general" />
              </div>
              {tipo !== 'futbol' && (
                <div className="space-y-3 rounded-md border p-3">
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
              {tipo !== 'futbol' && (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">
                    Inicios escalonados: los turnos de la cancha arrancan cada cierto tiempo, corridos desde la
                    apertura (ej. cada 1 hora y +30 min = 08:30, 09:30, 10:30…). Con inicios cada hora o menos se
                    siguen pudiendo reservar 1, 1½ o 2 horas. Sin elegir, se puede arrancar cada media hora.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label htmlFor="c-bloque">Los turnos arrancan</Label>
                      <select id="c-bloque" value={turnoBloque} onChange={(e) => setTurnoBloque(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                        <option value="">Cada media hora</option>
                        <option value="60">Cada 1 hora</option>
                        <option value="90">Cada 1½ hora (turno fijo)</option>
                        <option value="120">Cada 2 horas (turno fijo)</option>
                      </select>
                    </div>
                    <div className="space-y-1"><Label htmlFor="c-desfase">Primer turno</Label>
                      <select id="c-desfase" value={turnoDesfase} onChange={(e) => setTurnoDesfase(e.target.value)} disabled={!turnoBloque} className="w-full rounded-md border px-2 py-1.5 disabled:opacity-50">
                        <option value="0">A la hora de apertura</option>
                        <option value="30">30 min después</option>
                        <option value="60">1 hora después</option>
                        <option value="90">1½ hora después</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input type="checkbox" checked={destacada} onChange={(e) => setDestacada(e.target.checked)} className="h-4 w-4" />
                Cancha destacada (se ofrece como upgrade)
              </label>
            </>
          )}
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : (editing ? 'Guardar' : 'Crear cancha')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
