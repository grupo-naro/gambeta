'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Config } from '@/lib/types';
import { configSchema } from '@/lib/validators';
import { guardarConfig } from '@/lib/config-actions';

export function ConfigForm({ config }: { config: Config }) {
  const [f, setF] = useState({
    horaApertura: config.horaApertura, horaCierre: config.horaCierre,
    horaAperturaFinde: config.horaAperturaFinde, horaCierreFinde: config.horaCierreFinde,
    adminWhatsapp: config.adminWhatsapp,
    diasAnticipacionMax: config.diasAnticipacionMax != null ? String(config.diasAnticipacionMax) : '',
    senaModo: 'FIJO',
    senaPorcentaje: String(config.senaPorcentaje), senaMontoFijo: String(Number(config.senaMontoFijo)),
    cbu: config.cbu, alias: config.alias, titular: config.titular,
    alias2: config.alias2 ?? '', cbu2: config.cbu2 ?? '', titular2: config.titular2 ?? '',
    picoDesde: config.picoDesde, picoHasta: config.picoHasta,
    picoFindeDesde: config.picoFindeDesde, picoFindeHasta: config.picoFindeHasta,
  });
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  function guardar() {
    const parsed = configSchema.safeParse(f);
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await guardarConfig(parsed.data);
      if (r.ok) {
        toast.success('Configuración guardada');
        // Si el admin vació el campo, no viajó en el patch y el backend conservó el valor
        // anterior: repoblarlo desde la config recién guardada evita que el input quede vacío
        // mintiendo que no hay ningún límite cargado.
        setF((p) => ({ ...p, diasAnticipacionMax: r.config.diasAnticipacionMax != null ? String(r.config.diasAnticipacionMax) : '' }));
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <CardHeader><CardTitle className="text-base">Horarios del complejo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-neutral-700">Semana (Lun a Vie)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label htmlFor="ap">Apertura</Label><Input id="ap" type="time" value={f.horaApertura} onChange={(e) => set('horaApertura', e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="ci">Cierre</Label><Input id="ci" type="time" value={f.horaCierre} onChange={(e) => set('horaCierre', e.target.value)} /></div>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-neutral-700">Finde (Sáb y Dom)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label htmlFor="apf">Apertura</Label><Input id="apf" type="time" value={f.horaAperturaFinde} onChange={(e) => set('horaAperturaFinde', e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="cif">Cierre</Label><Input id="cif" type="time" value={f.horaCierreFinde} onChange={(e) => set('horaCierreFinde', e.target.value)} /></div>
            </div>
          </div>
          <p className="text-xs text-neutral-500">Cerrar a las 00:00 = medianoche (último turno 23:00 a 00:00).</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Contacto</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1"><Label htmlFor="wa">WhatsApp del administrador</Label><Input id="wa" value={f.adminWhatsapp} onChange={(e) => set('adminWhatsapp', e.target.value)} placeholder="5491159582039" /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Reservas del sitio público</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1">
            <Label htmlFor="antic">Anticipación máxima (días)</Label>
            <Input id="antic" type="number" min="1" max="365" value={f.diasAnticipacionMax} onChange={(e) => set('diasAnticipacionMax', e.target.value)} />
            <p className="text-xs text-neutral-600">
              Cuántos días adelante puede reservar un cliente desde la web. Con 7, hoy se puede reservar
              hasta dentro de una semana. No afecta al panel: desde acá se puede cargar cualquier fecha.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Pagos / Seña</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1"><Label htmlFor="fijo">Monto de seña por defecto</Label>
            <Input id="fijo" type="number" min="0" value={f.senaMontoFijo} onChange={(e) => set('senaMontoFijo', e.target.value)} />
            <p className="text-xs text-neutral-600">Se usa cuando una cancha no tiene su propio monto de seña cargado.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1"><Label htmlFor="alias">Alias</Label><Input id="alias" value={f.alias} onChange={(e) => set('alias', e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="cbu">CBU</Label><Input id="cbu" value={f.cbu} onChange={(e) => set('cbu', e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="tit">Titular</Label><Input id="tit" value={f.titular} onChange={(e) => set('titular', e.target.value)} /></div>
          <div className="pt-2 border-t">
            <p className="mb-2 text-sm font-medium text-neutral-700">Cuenta secundaria (opcional)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label htmlFor="alias2">Alias</Label><Input id="alias2" value={f.alias2} onChange={(e) => set('alias2', e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="cbu2">CBU</Label><Input id="cbu2" value={f.cbu2} onChange={(e) => set('cbu2', e.target.value)} /></div>
            </div>
            <div className="mt-4 space-y-1"><Label htmlFor="tit2">Titular</Label><Input id="tit2" value={f.titular2} onChange={(e) => set('titular2', e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Hora pico</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-neutral-600">Dejá las franjas vacías para no cobrar hora pico. El precio pico se define por cancha.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1"><Label htmlFor="pd">Semana — desde</Label><Input id="pd" type="time" value={f.picoDesde} onChange={(e) => set('picoDesde', e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="ph">Semana — hasta</Label><Input id="ph" type="time" value={f.picoHasta} onChange={(e) => set('picoHasta', e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="pfd">Finde — desde</Label><Input id="pfd" type="time" value={f.picoFindeDesde} onChange={(e) => set('picoFindeDesde', e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="pfh">Finde — hasta</Label><Input id="pfh" type="time" value={f.picoFindeHasta} onChange={(e) => set('picoFindeHasta', e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>
      <Button onClick={guardar} disabled={pending}>{pending ? 'Guardando…' : 'Guardar cambios'}</Button>
    </div>
  );
}
