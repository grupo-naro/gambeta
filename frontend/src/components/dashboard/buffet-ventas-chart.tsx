'use client';
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Ventas del buffet por día, apiladas por mostrador: se ve cuánto aportó cada puesto. */
export function BuffetVentasChart({ data }: { data: { fecha: string; PRINCIPAL: number; SECUNDARIO: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">Ventas del buffet por día</CardTitle></CardHeader>
      <CardContent className="h-64">
        {data.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin ventas en el período.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="fecha" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(f) => f.slice(8, 10) + '/' + f.slice(5, 7)} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => money(Number(v))} />
              <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(f) => String(f)} />
              <Legend />
              <Bar dataKey="PRINCIPAL" name="Principal" stackId="v" fill="#16a34a" />
              <Bar dataKey="SECUNDARIO" name="Secundario" stackId="v" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
