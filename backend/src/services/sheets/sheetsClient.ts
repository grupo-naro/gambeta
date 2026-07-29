import { google } from 'googleapis';
import { getEnv } from '../../config/env.js';
import type { GrillaDia, ColorRGB } from './grilla.js';

export function estaConfigurado(): boolean {
  const e = getEnv();
  return !!e.GOOGLE_SERVICE_ACCOUNT && !!e.SHEETS_SPREADSHEET_ID;
}
export function sheetUrl(): string | null {
  const id = getEnv().SHEETS_SPREADSHEET_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}` : null;
}

function sheetsApi() {
  const cred = JSON.parse(Buffer.from(getEnv().GOOGLE_SERVICE_ACCOUNT, 'base64').toString('utf8'));
  const auth = new google.auth.JWT({ email: cred.client_email, key: cred.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

const COL = {
  CYAN: { red: 0, green: 1, blue: 1 } as ColorRGB,
  YELLOW: { red: 1, green: 1, blue: 0 } as ColorRGB,
  GREEN: { red: 0, green: 1, blue: 0 } as ColorRGB,
  WHITE: { red: 1, green: 1, blue: 1 } as ColorRGB,
};
const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fechaDMY = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };

function cell(texto: string, bg: ColorRGB, opts: { textColor?: ColorRGB | null; bold?: boolean } = {}) {
  const textFormat: { bold?: boolean; foregroundColor?: ColorRGB } = {};
  if (opts.bold) textFormat.bold = true;
  if (opts.textColor) textFormat.foregroundColor = opts.textColor;
  const userEnteredFormat = (opts.bold || opts.textColor)
    ? { backgroundColor: bg, textFormat }
    : { backgroundColor: bg };
  return { userEnteredValue: { stringValue: texto }, userEnteredFormat };
}

/** Reconstruye una pestaña (la crea si falta) con el estilo de la planilla. */
export async function escribirDia(dia: string, fecha: string, g: GrillaDia): Promise<void> {
  const sheets = sheetsApi();
  const spreadsheetId = getEnv().SHEETS_SPREADSHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  let hoja = meta.data.sheets?.find((s) => s.properties?.title === dia);
  if (!hoja) {
    const add = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: dia } } }] } });
    hoja = add.data.replies?.[0]?.addSheet ? { properties: add.data.replies[0].addSheet!.properties } : undefined;
  }
  const sheetId = hoja?.properties?.sheetId;
  if (sheetId == null) return;

  // Fila 1: encabezado (blanco, negrita) + espaciador + "DIA"
  const headerRow = { values: [...g.header, '', 'DIA'].map((t) => cell(t, COL.WHITE, { bold: true })) };

  // Filas de horas: hora(blanco) + por cancha [nombre(celeste, texto por pago), $$(amarillo)] + espaciador + fecha (solo 1ra fila)
  const filasRows = g.filas.map((f, ri) => {
    const values = [cell(f.hora, COL.WHITE)];
    f.celdas.forEach((c, ci) => {
      const esNombre = ci % 2 === 0;
      values.push(cell(c.texto, esNombre ? COL.CYAN : COL.YELLOW, { textColor: c.colorTexto }));
    });
    values.push(cell('', COL.WHITE));                               // espaciador
    values.push(cell(ri === 0 ? fechaDMY(fecha) : '', COL.WHITE));  // DIA
    return { values };
  });

  // Fila TOTAL (verde): TOTAL + por cancha ['', $cancha] + espaciador + total general
  const totalValues = [cell('TOTAL', COL.GREEN, { bold: true })];
  g.totalesPorCancha.forEach((t) => {
    totalValues.push(cell('', COL.GREEN));
    totalValues.push(cell(money(t), COL.GREEN, { bold: true }));
  });
  totalValues.push(cell('', COL.GREEN));                                       // espaciador
  totalValues.push(cell(money(g.totalGeneral), COL.GREEN, { bold: true }));    // DIA

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            rows: [headerRow, ...filasRows, { values: totalValues }],
            fields: 'userEnteredValue,userEnteredFormat.backgroundColor,userEnteredFormat.textFormat',
            start: { sheetId, rowIndex: 0, columnIndex: 0 },
          },
        },
      ],
    },
  });
}
