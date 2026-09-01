import { describe, it, expect } from 'vitest';
import {
  esEtiquetaValida, serializarOrigen, etiquetaDeVisita, etiquetaDeReserva, MINUTOS_ORIGEN_FRESCO,
} from './origen';

const AHORA = 1_800_000_000_000;
const MIN = 60_000;

describe('esEtiquetaValida', () => {
  it('acepta las etiquetas que usamos', () => {
    for (const e of ['landing', 'ig-bio', 'whatsapp', 'qr-entrada']) expect(esEtiquetaValida(e)).toBe(true);
  });
  it('rechaza mayúsculas, espacios, vacío y demasiado largo', () => {
    for (const e of ['IG-Bio', 'ig bio', '', 'a'.repeat(41), '../etc']) expect(esEtiquetaValida(e)).toBe(false);
  });
});

describe('etiquetaDeVisita', () => {
  it('vale si la cookie se escribió en esta llegada', () => {
    const v = serializarOrigen('ig-bio', AHORA);
    expect(etiquetaDeVisita(v, AHORA + 10_000)).toBe('ig-bio');
  });

  it('no vale pasada la ventana de frescura: si no, quien entró una vez por el QR seguiría contando como QR', () => {
    const v = serializarOrigen('qr-entrada', AHORA);
    expect(etiquetaDeVisita(v, AHORA + (MINUTOS_ORIGEN_FRESCO + 1) * MIN)).toBeNull();
  });

  it('sin cookie o con basura, la visita es directa', () => {
    expect(etiquetaDeVisita(undefined, AHORA)).toBeNull();
    expect(etiquetaDeVisita('sin-punto', AHORA)).toBeNull();
    expect(etiquetaDeVisita('IG BIO.123', AHORA)).toBeNull();
    expect(etiquetaDeVisita('ig-bio.no-es-numero', AHORA)).toBeNull();
  });

  it('en el borde exacto de la ventana todavía cuenta como fresca (comparación es `>` estricto, no `>=`)', () => {
    const v = serializarOrigen('qr-entrada', AHORA);
    expect(etiquetaDeVisita(v, AHORA + MINUTOS_ORIGEN_FRESCO * MIN)).toBe('qr-entrada');
  });

  it('reloj hacia atrás (timestamp futuro en la cookie) también da null', () => {
    const v = serializarOrigen('qr-entrada', AHORA);
    expect(etiquetaDeVisita(v, AHORA - 1)).toBeNull();
  });
});

describe('etiquetaDeReserva', () => {
  it('vale toda la vida de la cookie: la atribución es last-touch', () => {
    const v = serializarOrigen('whatsapp', AHORA);
    expect(etiquetaDeReserva(v)).toBe('whatsapp');
  });
  it('sin cookie no hay atribución', () => {
    expect(etiquetaDeReserva(undefined)).toBeNull();
    expect(etiquetaDeReserva('basura')).toBeNull();
  });
});
