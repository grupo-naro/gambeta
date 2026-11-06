import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReservasResumen } from '@/lib/types';

function Dato({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono?: 'aviso' }) {
  return (
    <div>
      <div className={`text-xl font-semibold tabular-nums ${tono === 'aviso' ? 'text-amber-700' : 'text-neutral-900'}`}>{valor}</div>
      <div className="text-xs text-neutral-500">{etiqueta}</div>
    </div>
  );
}

/**
 * De qué está hecho el número de "Reservas del período": por deporte, por tipo de turno, y lo que NO
 * se jugó (próximas, canceladas y las que esperan seña), que es lo que antes inflaba el total.
 */
export function ReservasDetalle({ r }: { r: ReservasResumen }) {
  return (
    <Card className="gap-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-neutral-600">Detalle de reservas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          <Dato etiqueta="Fútbol" valor={r.porDeporte.futbol} />
          <Dato etiqueta="Pádel" valor={r.porDeporte.padel} />
          <Dato etiqueta="Sueltas" valor={r.porOrigen.sueltas} />
          <Dato etiqueta="Abonos (fijos)" valor={r.porOrigen.abonos} />
          <Dato etiqueta="Socios" valor={r.porOrigen.socios} />
          <Dato etiqueta="Próximas (sin jugar)" valor={r.proximas} />
          <Dato etiqueta="Canceladas" valor={r.canceladas} tono="aviso" />
          <Dato etiqueta="Esperando seña" valor={r.esperandoSena} tono="aviso" />
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          El total cuenta solo los turnos que ya se usaron: terminó su horario. Los abonos suman a medida que pasan, se hayan cobrado o no. Las próximas, las canceladas y las que esperan seña no cuentan.
        </p>
      </CardContent>
    </Card>
  );
}
