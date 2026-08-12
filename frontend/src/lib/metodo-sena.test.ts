import { describe, it, expect } from 'vitest';
import { etiquetaMetodoSena } from './metodo-sena';

describe('etiquetaMetodoSena', () => {
  it('traduce los dos métodos a algo legible', () => {
    expect(etiquetaMetodoSena('MERCADO_PAGO')).toBe('Mercado Pago');
    expect(etiquetaMetodoSena('TRANSFERENCIA')).toBe('Transferencia');
  });

  it('sin método no inventa una etiqueta', () => {
    // Las reservas del panel y las viejas no eligieron nada: mostrar "Mercado Pago"
    // por defecto sería decirle al staff que espere un pago que nadie prometió.
    expect(etiquetaMetodoSena(null)).toBeNull();
    expect(etiquetaMetodoSena(undefined)).toBeNull();
  });
});
