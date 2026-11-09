import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { diaYHora, textoMeses } from '@/lib/dashboard-academia';
import type { AcademiaEntrenamiento } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Cada entrenamiento con lo que vale por mes, lo cobrado en el período y lo que se debe. */
export function AcademiaEntrenamientos({ entrenamientos }: { entrenamientos: AcademiaEntrenamiento[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">Por entrenamiento</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        {entrenamientos.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No hay entrenamientos con valor mensual. Cargalos en Bloqueos: motivo Entrenamiento, tipo Recurrente y &quot;Valor por mes&quot;.
          </p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left font-medium">
                <th className="px-2 py-2">Entrenamiento</th>
                <th className="px-2 py-2 text-right">Valor por mes</th>
                <th className="px-2 py-2 text-right">Cobrado</th>
                <th className="px-2 py-2 text-right">Debe</th>
              </tr>
            </thead>
            <tbody>
              {entrenamientos.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="px-2 py-3">
                    <div className="font-medium">{e.nombre}</div>
                    <div className="text-xs text-neutral-500">{e.cancha} · {diaYHora(e)}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">{money(e.valor)}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">{money(e.cobrado)}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">
                    {e.debe > 0 ? (
                      <>
                        <div className="font-semibold text-amber-700">{money(e.debe)}</div>
                        <div className="text-xs text-neutral-500">{textoMeses(e.mesesConDeuda)}</div>
                      </>
                    ) : (
                      <span className="text-emerald-700">Al día</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
