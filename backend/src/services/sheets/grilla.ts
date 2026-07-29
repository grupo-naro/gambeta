export interface ColorRGB { red: number; green: number; blue: number }

export type TipoTurno = 'fijo' | 'suelto' | 'escuela' | 'torneo' | 'otro';

// Color del TEXTO del nombre según el TIPO de turno (igual que el Excel del complejo).
export const COLORES_TIPO: Record<TipoTurno, ColorRGB> = {
  fijo:    { red: 0,   green: 0,    blue: 0 },
  suelto:  { red: 0.8, green: 0,    blue: 0 },
  escuela: { red: 0.9, green: 0.45, blue: 0 },
  torneo:  { red: 0.5, green: 0.2,  blue: 0.7 },
  otro:    { red: 0.4, green: 0.4,  blue: 0.4 },
};
export function colorPorTipo(tipo: TipoTurno): ColorRGB { return COLORES_TIPO[tipo]; }

export interface ReservaCelda { canchaId: string; fecha?: string; hora: string; cliente: string; monto: number; pagado: number; tipo: TipoTurno }
export interface Celda { texto: string; colorTexto: ColorRGB | null }
export interface FilaGrilla { hora: string; celdas: Celda[] }
export interface GrillaDia { header: string[]; filas: FilaGrilla[]; totalesPorCancha: number[]; totalGeneral: number; nCanchas: number }

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function construirGrillaDia(horas: string[], canchas: { id: string; nombre: string }[], reservas: ReservaCelda[]): GrillaDia {
  const header = ['', ...canchas.flatMap((c) => [c.nombre, '$$'])];
  const byKey = new Map<string, ReservaCelda>();
  for (const r of reservas) byKey.set(`${r.canchaId}|${r.hora}`, r);
  const totalesPorCancha = canchas.map(() => 0);
  const filas: FilaGrilla[] = horas.map((hora) => {
    const celdas: Celda[] = [];
    canchas.forEach((c, i) => {
      const r = byKey.get(`${c.id}|${hora}`);
      if (r) {
        celdas.push({ texto: r.cliente, colorTexto: colorPorTipo(r.tipo) }, { texto: money(r.monto), colorTexto: null });
        totalesPorCancha[i] += Number(r.monto);
      } else {
        celdas.push({ texto: '', colorTexto: null }, { texto: '', colorTexto: null });
      }
    });
    return { hora, celdas };
  });
  const totalGeneral = totalesPorCancha.reduce((s, n) => s + n, 0);
  return { header, filas, totalesPorCancha, totalGeneral, nCanchas: canchas.length };
}
