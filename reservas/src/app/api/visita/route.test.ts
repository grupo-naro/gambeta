import { describe, it, expect, vi, beforeEach } from 'vitest';

// Único bloque de decisión de toda la feature: acá se decide si una visita se registra o no,
// y es justo lo que tocaron los arreglos A (sesión vigente + etiqueta fresca abre sesión
// nueva), B (el registro no bloquea la respuesta) y C (guard de mismo origen).

const apiReservasMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api', () => ({ apiReservas: (...args: unknown[]) => apiReservasMock(...args) }));

let cookieStore: Record<string, string> = {};
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in cookieStore ? { value: cookieStore[name] } : undefined),
  }),
}));

// `after()` real depende del scope de un request de Next en producción; acá se reemplaza por
// una versión que ejecuta el callback y guarda la promesa, para poder esperarlo en el test
// antes de mirar si `apiReservas` se llamó.
const tareasPosteriores: Promise<unknown>[] = [];
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (cb: () => unknown) => { tareasPosteriores.push(Promise.resolve(cb())); },
  };
});

function crearRequest(headers: Record<string, string> = {}, body: unknown = { referer: null }): Request {
  return new Request('http://localhost/api/visita', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function post(req: Request) {
  const { POST } = await import('./route');
  const res = await POST(req);
  await Promise.all(tareasPosteriores);
  return res;
}

describe('POST /api/visita', () => {
  beforeEach(() => {
    vi.resetModules();
    apiReservasMock.mockClear();
    cookieStore = {};
    tareasPosteriores.length = 0;
  });

  it('primera visita sin cookies (y sin cabecera Sec-Fetch-Site) → registra', async () => {
    const res = await post(crearRequest());

    expect(res.status).toBe(204);
    expect(apiReservasMock).toHaveBeenCalledTimes(1);
    const [path, init] = apiReservasMock.mock.calls[0];
    expect(path).toBe('/visitas');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.etiqueta).toBeNull();
    // gb_sid y gb_vid nuevos: la respuesta trae las cookies.
    expect(res.cookies.get('gb_sid')?.value).toBeTruthy();
    expect(res.cookies.get('gb_vid')?.value).toBeTruthy();
  });

  it('sesión vigente sin etiqueta fresca → no registra, pero renueva la sesión', async () => {
    cookieStore = { gb_sid: 'sid-existente', gb_vid: 'vid-existente' };

    const res = await post(crearRequest());

    expect(apiReservasMock).not.toHaveBeenCalled();
    // Misma sesión, sólo se le renueva la ventana de 30 minutos.
    expect(res.cookies.get('gb_sid')?.value).toBe('sid-existente');
  });

  it('sesión vigente con etiqueta fresca → sí registra, con sesión nueva (arreglo A)', async () => {
    cookieStore = {
      gb_sid: 'sid-existente',
      gb_vid: 'vid-existente',
      gb_org: `whatsapp.${Date.now()}`,
    };

    const res = await post(crearRequest());

    expect(apiReservasMock).toHaveBeenCalledTimes(1);
    const [, init] = apiReservasMock.mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.etiqueta).toBe('whatsapp');
    // La sesión no puede ser la que ya estaba viva: si no, la llegada por WhatsApp queda
    // absorbida por la visita anterior y se pierde.
    expect(body.sesionId).not.toBe('sid-existente');
    expect(res.cookies.get('gb_sid')?.value).not.toBe('sid-existente');
    // La frescura de gb_org se quema (timestamp 0) pero la atribución de reserva no se pierde.
    expect(res.cookies.get('gb_org')?.value).toBe('whatsapp.0');
  });

  it('Sec-Fetch-Site: cross-site → no registra', async () => {
    const res = await post(crearRequest({ 'sec-fetch-site': 'cross-site' }));

    expect(res.status).toBe(204);
    expect(apiReservasMock).not.toHaveBeenCalled();
  });

  it('Sec-Fetch-Site ausente → registra igual (arreglo C: sólo se rechaza si la cabecera dice explícitamente que no es same-origin)', async () => {
    const res = await post(crearRequest({}));

    expect(apiReservasMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(204);
  });
});
