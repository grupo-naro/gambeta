import { describe, it, expect } from 'vitest';
import { filasPorDia, fmtYmd, nombreArchivoPdf, pdfAcademia, pdfBuffet, pdfCanchas } from './dashboard-pdf';
import type { AcademiaResumen, BuffetDia, BuffetResumen } from './types';

const dia = (fecha: string, unidades: number, efectivo: number, transferencia: number): BuffetDia => ({
  fecha, unidades, efectivo, transferencia, total: efectivo + transferencia,
  mostradores: { PRINCIPAL: { unidades, total: efectivo + transferencia }, SECUNDARIO: { unidades: 0, total: 0 }, TERCERO: { unidades: 0, total: 0 } },
  productos: [{ nombre: 'Coca', unidades, monto: efectivo + transferencia }],
});

const buffet: BuffetResumen = {
  total: { monto: 1379500, tickets: 12, unidades: 248, ticketPromedio: 114958, alquileres: 0, porMedio: { EFECTIVO: 1054400, TRANSFERENCIA: 325100 }, masVendido: { nombre: 'cerveza brahma 1 lt', unidades: 90 } },
  mostradores: [
    { tipo: 'PRINCIPAL', nombre: 'Mostrador principal', enResumen: true, monto: 1000000, tickets: 8, unidades: 180, ticketPromedio: 125000, alquileres: 0, porMedio: { EFECTIVO: 800000, TRANSFERENCIA: 200000 }, topProductos: [{ nombre: 'cerveza brahma 1 lt', unidades: 70, monto: 500000 }] },
    { tipo: 'SECUNDARIO', nombre: 'Mostrador secundario', enResumen: true, monto: 379500, tickets: 4, unidades: 68, ticketPromedio: 94875, alquileres: 0, porMedio: { EFECTIVO: 254400, TRANSFERENCIA: 125100 }, topProductos: [] },
  ],
  dias: [dia('2026-11-09', 0, 0, 0), dia('2026-11-08', 62, 243600, 74600), dia('2026-11-07', 186, 810800, 250500)],
};

describe('filasPorDia', () => {
  it('omite los días sin ventas y agrega el total', () => {
    const filas = filasPorDia(buffet.dias);
    expect(filas).toHaveLength(3); // dos días + total
    expect(filas[0][0]).toBe('dom 08/11');
    expect(filas[2]).toEqual(['Total', '248', '$1.054.400', '$325.100', '$1.379.500']);
  });
  it('sin ventas no hay filas ni total', () => {
    expect(filasPorDia([dia('2026-11-09', 0, 0, 0)])).toEqual([]);
  });
});

describe('nombres y fechas', () => {
  it('arma el nombre del archivo con la vista y el período', () => {
    expect(nombreArchivoPdf('buffet', { desde: '2026-11-02', hasta: '2026-11-08', etiqueta: 'Esta semana' })).toBe('gambeteando-buffet-2026-11-02_2026-11-08.pdf');
  });
  it('escribe la fecha día/mes/año', () => {
    expect(fmtYmd('2026-11-08')).toBe('08/11/2026');
  });
});

describe('generación del PDF', () => {
  const periodo = { desde: '2026-11-02', hasta: '2026-11-08', etiqueta: 'Esta semana' };
  const esPdf = (d: { output: (t: 'arraybuffer') => ArrayBuffer }) => new TextDecoder().decode(new Uint8Array(d.output('arraybuffer')).slice(0, 5));

  it('el PDF del buffet es un PDF válido', () => {
    const doc = pdfBuffet(buffet, periodo);
    expect(esPdf(doc)).toBe('%PDF-');
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
  it('el PDF del buffet sin ventas también se genera', () => {
    const vacio: BuffetResumen = { ...buffet, total: { ...buffet.total, monto: 0, tickets: 0, unidades: 0, masVendido: null }, mostradores: buffet.mostradores.map((m) => ({ ...m, monto: 0, topProductos: [] })), dias: [dia('2026-11-08', 0, 0, 0)] };
    expect(esPdf(pdfBuffet(vacio, periodo))).toBe('%PDF-');
  });
  it('el PDF de la academia es un PDF válido, con y sin entrenamientos', () => {
    const academia: AcademiaResumen = {
      total: { cobrado: 150000, porMedio: { EFECTIVO: 50000, TRANSFERENCIA: 100000 }, debe: 80000, entrenamientos: 2 },
      entrenamientos: [
        { id: 'a', nombre: 'Escuelita', cancha: 'Fútbol 1', diaSemana: 2, horaInicio: '17:00', horaFin: '18:00', valor: 50000, cobrado: 100000, debe: 0, mesesConDeuda: 0 },
        { id: 'b', nombre: 'Clases de pádel', cancha: 'Pádel 1', diaSemana: 3, horaInicio: '19:00', horaFin: '20:00', valor: 30000, cobrado: 50000, debe: 80000, mesesConDeuda: 2 },
      ],
    };
    expect(esPdf(pdfAcademia(academia, periodo))).toBe('%PDF-');
    expect(esPdf(pdfAcademia({ total: { ...academia.total, cobrado: 0, debe: 0, entrenamientos: 0 }, entrenamientos: [] }, periodo))).toBe('%PDF-');
    expect(nombreArchivoPdf('academia', periodo)).toBe('gambeteando-academia-2026-11-02_2026-11-08.pdf');
  });
  it('el PDF de canchas es un PDF válido', () => {
    const doc = pdfCanchas({
      ingresos: 5000000,
      reservas: { total: 120, proximas: 5, canceladas: 3, esperandoSena: 1, porDeporte: { futbol: 90, padel: 30 }, porOrigen: { sueltas: 60, abonos: 50, socios: 10 } },
      canchaTop: 'Cancha 1',
      ingresosPorDia: [{ fecha: '2026-11-08', total: 100000 }, { fecha: '2026-11-07', total: 250000 }],
    }, periodo);
    expect(esPdf(doc)).toBe('%PDF-');
  });
});
