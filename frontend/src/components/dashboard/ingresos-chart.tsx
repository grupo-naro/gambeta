'use client';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function IngresosChart({ data }: { data: { fecha: string; total: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">Ingresos por día</CardTitle></CardHeader>
      <CardContent className="h-64">
        {data.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin ingresos en el período.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="fecha" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(f) => f.slice(8, 10) + '/' + f.slice(5, 7)} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => money(Number(v))} />
              <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(f) => String(f)} />
              <Bar dataKey="total" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
