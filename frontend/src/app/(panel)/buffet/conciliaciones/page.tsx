import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { ResumenConciliacion } from '@/lib/types';
import { SubNavBuffet } from '@/components/buffet/sub-nav';

export default async function ConciliacionesPage() {
  await requireAdmin();
  const filas = await apiFetch<ResumenConciliacion[]>('/buffet/conciliaciones/resumen');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Faltantes del buffet</h1>
        <p className="text-sm text-neutral-600">Últimos 90 días, lo que más falta primero.</p>
      </header>
      <SubNavBuffet activa="conciliaciones" />

      {filas.length === 0 ? (
        <p className="text-neutral-600">No hay cierres conciliados en este período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="p-3">Producto</th>
                <th className="p-3">Cierres</th>
                <th className="p-3">Entregado</th>
                <th className="p-3">Vendido</th>
                <th className="p-3">Contado</th>
                <th className="p-3">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.productoId} className="border-t">
                  <td className="p-3 font-medium">{f.nombre}</td>
                  <td className="p-3 tabular-nums">{f.cierres}</td>
                  <td className="p-3 tabular-nums">{f.entregado}</td>
                  <td className="p-3 tabular-nums">{f.vendido}</td>
                  <td className="p-3 tabular-nums">{f.contado}</td>
                  {/* Cero se muestra como texto y no como 0: que NO falte nada es la lectura
                      importante, y un 0 en una columna de numeros se lee como un dato mas. */}
                  <td className={`p-3 tabular-nums ${f.diferencia < 0 ? 'font-semibold text-red-700' : 'text-neutral-500'}`}>
                    {f.diferencia === 0 ? 'sin diferencia' : f.diferencia}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
