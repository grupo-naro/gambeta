import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OcupacionCelda } from '@/lib/types';
import { horasDelDia } from '@/lib/calendario';

const DIAS = [{ dow: 1, l: 'Lun' }, { dow: 2, l: 'Mar' }, { dow: 3, l: 'Mié' }, { dow: 4, l: 'Jue' }, { dow: 5, l: 'Vie' }, { dow: 6, l: 'Sáb' }, { dow: 0, l: 'Dom' }];

export function OcupacionHeatmap({ data, horaApertura, horaCierre }: { data: OcupacionCelda[]; horaApertura: string; horaCierre: string }) {
  // horasDelDia ya resuelve el cruce de medianoche (apertura 07:00/cierre 01:00 -> 07..23,00):
  // el cálculo a mano de acá (ini/fin por Number(slice(0,2))) daba un rango [7, 1) vacío y el
  // heatmap se renderizaba en blanco. Ver Hallazgo 4 de la revisión final del plan de jornada.
  const horas = horasDelDia(horaApertura, horaCierre).map((h) => Number(h.slice(0, 2)));
  const byKey = new Map(data.map((c) => [`${c.dia}|${c.hora}`, c.reservas]));
  const max = data.reduce((m, c) => Math.max(m, c.reservas), 0);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">Ocupación (cuándo se llena)</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[420px]">
            <div className="grid text-center text-[12px] text-neutral-500" style={{ gridTemplateColumns: '40px repeat(7, 1fr)' }}>
              <div></div>
              {DIAS.map((d) => <div key={d.dow} className="pb-1 font-medium">{d.l}</div>)}
            </div>
            {horas.map((h) => (
              <div key={h} className="grid items-center" style={{ gridTemplateColumns: '40px repeat(7, 1fr)' }}>
                <div className="pr-1 text-right text-[12px] text-neutral-500">{String(h).padStart(2, '0')}</div>
                {DIAS.map((d) => {
                  const n = byKey.get(`${d.dow}|${h}`) ?? 0;
                  const alpha = max > 0 && n > 0 ? 0.15 + 0.85 * (n / max) : 0;
                  return (
                    <div key={d.dow} className="m-0.5 h-6 rounded" title={`${d.l} ${h}:00 · ${n} reservas`}
                      style={{ backgroundColor: n > 0 ? `rgba(22,163,74,${alpha})` : '#f1f5f9' }} />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-neutral-500">Más oscuro = más reservado.</p>
      </CardContent>
    </Card>
  );
}
