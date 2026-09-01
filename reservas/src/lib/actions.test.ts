import { describe, it, expect, vi, beforeEach } from 'vitest';

// `crearReserva` es el único eslabón de la cadena de atribución sin cobertura: lee `gb_org`
// (ya probado en origen.test.ts) y le pega al backend (ya probado del lado del backend), pero
// nada prueba que el pegamento entre las dos puntas arme bien el body. Si esto falla en
// silencio, el histórico de atribución no se recupera después (ver el spec).
const apiReservasMock = vi.fn().mockResolvedValue({ id: 'r1', montoSena: null });
vi.mock('./api', () => ({ apiReservas: (...args: unknown[]) => apiReservasMock(...args) }));

const cookiesGetMock = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => cookiesGetMock(name) }),
}));

describe('crearReserva — atribución de origen', () => {
  beforeEach(() => {
    apiReservasMock.mockClear();
    cookiesGetMock.mockReset();
  });

  const input = { canchaId: 'c1', fecha: '2026-09-01', horaInicio: '18:00', nombre: 'Juan', telefono: '1122334455' };

  it('con cookie gb_org, el body manda origenEtiqueta con la etiqueta cruda', async () => {
    cookiesGetMock.mockImplementation((name: string) => (name === 'gb_org' ? { value: 'whatsapp.1700000000000' } : undefined));
    const { crearReserva } = await import('./actions');

    await crearReserva(input);

    expect(apiReservasMock).toHaveBeenCalledTimes(1);
    const [path, init] = apiReservasMock.mock.calls[0];
    expect(path).toBe('/reservas');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.origenEtiqueta).toBe('whatsapp');
  });

  it('sin cookie, el body no trae la clave origenEtiqueta', async () => {
    cookiesGetMock.mockReturnValue(undefined);
    const { crearReserva } = await import('./actions');

    await crearReserva(input);

    const [, init] = apiReservasMock.mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body).not.toHaveProperty('origenEtiqueta');
  });
});
