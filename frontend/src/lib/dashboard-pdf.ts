import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { etiquetaDia } from './dashboard-buffet';
import { diaYHora, textoMeses } from './dashboard-academia';
import type { AcademiaResumen, BuffetDia, BuffetResumen, IngresoDia, ReservasResumen } from './types';

/** Período que cubre el PDF: 'YYYY-MM-DD' inclusivo en los dos extremos, y cómo se llama ("Este mes"). */
export interface PeriodoPdf { desde: string; hasta: string; etiqueta: string }

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
/** '2026-11-08' → "08/11/2026". */
export const fmtYmd = (ymd: string) => ymd.split('-').reverse().join('/');

const VERDE: [number, number, number] = [22, 101, 52];
const GRIS: [number, number, number] = [90, 90, 90];

/** Nombre del archivo: gambeteando-buffet-2026-11-02_2026-11-08.pdf */
export function nombreArchivoPdf(vista: 'canchas' | 'buffet' | 'academia', p: PeriodoPdf): string {
  return `gambeteando-${vista}-${p.desde}_${p.hasta}.pdf`;
}

/** Filas de la tabla "Por día" del buffet: solo los días con ventas, y el total al final. */
export function filasPorDia(dias: BuffetDia[]): string[][] {
  const conVentas = dias.filter((d) => d.total > 0 || d.unidades > 0);
  const filas = conVentas.map((d) => [etiquetaDia(d.fecha), String(d.unidades), money(d.efectivo), money(d.transferencia), money(d.total)]);
  if (conVentas.length > 0) {
    const sum = (f: (d: BuffetDia) => number) => conVentas.reduce((s, d) => s + f(d), 0);
    filas.push(['Total', String(sum((d) => d.unidades)), money(sum((d) => d.efectivo)), money(sum((d) => d.transferencia)), money(sum((d) => d.total))]);
  }
  return filas;
}

/** Cabecera común: marca, título, período y fecha de generación. Devuelve la Y donde sigue el contenido. */
function encabezado(doc: jsPDF, titulo: string, p: PeriodoPdf): number {
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...VERDE).text('Gambeteando', 14, 18);
  doc.setFontSize(14).setTextColor(0, 0, 0).text(titulo, 14, 27);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...GRIS);
  doc.text(`Período: ${p.etiqueta} (${fmtYmd(p.desde)} al ${fmtYmd(p.hasta)})`, 14, 34);
  doc.text(`Generado el ${new Date().toLocaleDateString('es-AR')}`, 14, 39);
  return 46;
}

function subtitulo(doc: jsPDF, texto: string, y: number): number {
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(0, 0, 0).text(texto, 14, y);
  return y + 3;
}

/** Y donde terminó la última tabla dibujada. */
const finTabla = (doc: jsPDF): number => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

const estiloTabla = { headStyles: { fillColor: VERDE }, styles: { fontSize: 9 }, margin: { left: 14, right: 14 } } as const;

/** PDF de la vista Buffet: resumen, cada mostrador y las ventas día por día. */
export function pdfBuffet(b: BuffetResumen, p: PeriodoPdf): jsPDF {
  const doc = new jsPDF();
  let y = encabezado(doc, 'Buffet', p);

  y = subtitulo(doc, 'Resumen (principal y secundario)', y);
  autoTable(doc, {
    ...estiloTabla, startY: y, theme: 'plain', styles: { fontSize: 10 },
    body: [
      ['Ventas', money(b.total.monto)],
      ['Efectivo', money(b.total.porMedio.EFECTIVO)],
      ['Transferencia', money(b.total.porMedio.TRANSFERENCIA)],
      ['Productos vendidos', String(b.total.unidades)],
      ['Más vendido', b.total.masVendido ? `${b.total.masVendido.nombre} (${b.total.masVendido.unidades})` : '—'],
      ['Tickets', `${b.total.tickets} (promedio ${money(Math.round(b.total.ticketPromedio))})`],
      ...(b.total.alquileres > 0 ? [['Alquileres (aparte)', money(b.total.alquileres)]] : []),
    ],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
  });

  y = subtitulo(doc, 'Por mostrador', finTabla(doc) + 8);
  autoTable(doc, {
    ...estiloTabla, startY: y,
    head: [['Mostrador', 'Ventas', 'Tickets', 'Unid.', 'Efectivo', 'Transf.', 'Ticket prom.']],
    didParseCell: (d) => { if (d.section === 'body' && !b.mostradores[d.row.index]?.enResumen) d.cell.styles.textColor = [200, 30, 30]; },
    body: b.mostradores.map((m) => [m.enResumen ? m.nombre : `${m.nombre} (aparte)`, money(m.monto), String(m.tickets), String(m.unidades), money(m.porMedio.EFECTIVO), money(m.porMedio.TRANSFERENCIA), money(Math.round(m.ticketPromedio))]),
  });

  for (const m of b.mostradores) {
    if (m.topProductos.length === 0) continue;
    y = subtitulo(doc, `Lo más vendido — ${m.nombre}`, finTabla(doc) + 8);
    autoTable(doc, {
      ...estiloTabla, startY: y,
      head: [['Producto', 'Unidades', 'Monto']],
      body: m.topProductos.map((t) => [t.nombre, String(t.unidades), money(t.monto)]),
    });
  }

  y = subtitulo(doc, 'Ventas por día', finTabla(doc) + 8);
  const filas = filasPorDia(b.dias);
  if (filas.length === 0) {
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...GRIS).text('Sin ventas en el período.', 14, y + 6);
  } else {
    autoTable(doc, {
      ...estiloTabla, startY: y,
      head: [['Día', 'Unid.', 'Efectivo', 'Transf.', 'Total']],
      body: filas,
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      didParseCell: (d) => { if (d.section === 'body' && d.row.index === filas.length - 1) d.cell.styles.fontStyle = 'bold'; },
    });
  }
  return doc;
}

/** PDF de la vista Academia: lo cobrado, la deuda y cada entrenamiento. */
export function pdfAcademia(a: AcademiaResumen, p: PeriodoPdf): jsPDF {
  const doc = new jsPDF();
  let y = encabezado(doc, 'Academia', p);

  y = subtitulo(doc, 'Resumen', y);
  autoTable(doc, {
    ...estiloTabla, startY: y, theme: 'plain', styles: { fontSize: 10 },
    body: [
      ['Cobrado en el período', money(a.total.cobrado)],
      ['Efectivo', money(a.total.porMedio.EFECTIVO)],
      ['Transferencia', money(a.total.porMedio.TRANSFERENCIA)],
      ['A cobrar (meses sin pagar)', money(a.total.debe)],
      ['Entrenamientos con valor mensual', String(a.total.entrenamientos)],
    ],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 65 } },
  });
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS);
  doc.text('"A cobrar" suma los meses sin pagar hasta el mes actual, sin importar el período elegido.', 14, finTabla(doc) + 6);

  y = subtitulo(doc, 'Por entrenamiento', finTabla(doc) + 14);
  if (a.entrenamientos.length === 0) {
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...GRIS).text('No hay entrenamientos con valor mensual.', 14, y + 6);
  } else {
    autoTable(doc, {
      ...estiloTabla, startY: y,
      head: [['Entrenamiento', 'Cancha', 'Día y hora', 'Valor por mes', 'Cobrado', 'Debe']],
      body: a.entrenamientos.map((e) => [e.nombre, e.cancha, diaYHora(e), money(e.valor), money(e.cobrado), e.debe > 0 ? `${money(e.debe)} (${textoMeses(e.mesesConDeuda)})` : 'Al día']),
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
  }
  return doc;
}

/** Lo que muestra la vista Canchas, ya resuelto (el PDF no vuelve a pedir nada al servidor). */
export interface DatosCanchasPdf {
  ingresos: number;
  reservas: ReservasResumen;
  canchaTop: string;
  ingresosPorDia: IngresoDia[];
}

/** PDF de la vista Canchas (fútbol y pádel): totales, detalle de reservas e ingresos por día. */
export function pdfCanchas(d: DatosCanchasPdf, p: PeriodoPdf): jsPDF {
  const doc = new jsPDF();
  let y = encabezado(doc, 'Canchas — fútbol y pádel', p);

  y = subtitulo(doc, 'Resumen', y);
  autoTable(doc, {
    ...estiloTabla, startY: y, theme: 'plain', styles: { fontSize: 10 },
    body: [
      ['Ingresos del período', money(d.ingresos)],
      ['Reservas del período', String(d.reservas.total)],
      ['Cancha más reservada', d.canchaTop],
    ],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
  });

  y = subtitulo(doc, 'Detalle de reservas', finTabla(doc) + 8);
  const r = d.reservas;
  autoTable(doc, {
    ...estiloTabla, startY: y,
    head: [['Fútbol', 'Pádel', 'Sueltas', 'Abonos (fijos)', 'Socios', 'Próximas', 'Canceladas', 'Esperando seña']],
    body: [[r.porDeporte.futbol, r.porDeporte.padel, r.porOrigen.sueltas, r.porOrigen.abonos, r.porOrigen.socios, r.proximas, r.canceladas, r.esperandoSena].map(String)],
  });
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS);
  doc.text('El total cuenta solo los turnos que ya se usaron. Las próximas, canceladas y las que esperan seña no cuentan.', 14, finTabla(doc) + 6);

  y = subtitulo(doc, 'Ingresos por día', finTabla(doc) + 14);
  const dias = [...d.ingresosPorDia].sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (dias.length === 0) {
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...GRIS).text('Sin ingresos en el período.', 14, y + 6);
  } else {
    autoTable(doc, {
      ...estiloTabla, startY: y,
      head: [['Día', 'Ingresos']],
      body: dias.map((x) => [etiquetaDia(x.fecha), money(Number(x.total))]),
      columnStyles: { 1: { halign: 'right' } },
    });
  }
  return doc;
}
