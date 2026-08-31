import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { nombreEtiqueta, nombreOrigen } from '@/lib/origen';
import type { OrigenPorEtiqueta } from '@/lib/types';

export function OrigenesTabla({ data }: { data: OrigenPorEtiqueta[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">Detalle por link</CardTitle></CardHeader>
      <CardContent className="h-64 overflow-y-auto">
        {data.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay visitas en este período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr>
                <th className="pb-2 font-medium">Link</th>
                <th className="pb-2 font-medium">Canal</th>
                <th className="pb-2 text-right font-medium">Visitas</th>
                <th className="pb-2 text-right font-medium">Personas</th>
              </tr>
            </thead>
            <tbody>
              {data.map((f) => (
                <tr key={`${f.etiqueta ?? 'directo'}-${f.tipo}`} className="border-t border-neutral-100">
                  <td className="py-2 font-medium text-neutral-900">{nombreEtiqueta(f.etiqueta)}</td>
                  <td className="py-2 text-neutral-600">{nombreOrigen(f.tipo)}</td>
                  <td className="py-2 text-right tabular-nums">{f.visitas}</td>
                  <td className="py-2 text-right tabular-nums text-neutral-600">{f.unicos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
