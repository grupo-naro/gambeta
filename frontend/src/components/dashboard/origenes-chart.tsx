'use client';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { nombreOrigen } from '@/lib/origen';
import type { OrigenPorTipo } from '@/lib/types';

export function OrigenesChart({ data }: { data: OrigenPorTipo[] }) {
  const filas = data.map((d) => ({ canal: nombreOrigen(d.tipo), visitas: d.visitas }));
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">De dónde llegan</CardTitle></CardHeader>
      <CardContent className="h-64">
        {filas.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay visitas en este período.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filas}>
              <XAxis dataKey="canal" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip />
              <Bar dataKey="visitas" fill="#171717" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
