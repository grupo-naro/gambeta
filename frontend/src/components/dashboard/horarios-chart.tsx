'use client';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function HorariosChart({ data }: { data: { hora: string; reservas: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">Horarios pico</CardTitle></CardHeader>
      <CardContent className="h-64">
        {data.length === 0 ? (
          <p className="text-sm text-neutral-500">No disponible.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="hora" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip />
              <Bar dataKey="reservas" fill="#171717" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
