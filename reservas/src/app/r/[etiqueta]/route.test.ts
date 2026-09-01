import { describe, it, expect } from 'vitest';
import { GET } from './route';

// `ctx.params` es una Promise en Next 16.
const ctx = (etiqueta: string) => ({ params: Promise.resolve({ etiqueta }) });
const pedido = () => new Request('http://cdc5866ac4dd:3000/r/landing');

describe('GET /r/<etiqueta>', () => {
  it('redirige con un Location RELATIVO, sin filtrar el host interno', async () => {
    const res = await GET(pedido(), ctx('landing'));
    expect(res.status).toBe(302);
    // Éste es el caso que rompió producción: con `new URL('/', req.url)` el destino salía
    // `https://<id-del-contenedor>:3000/`, porque detrás de Traefik `req.url` tiene el host
    // interno. El navegador no podía resolverlo. El Location tiene que ser relativo.
    expect(res.headers.get('location')).toBe('/');
  });

  it('deja la cookie de origen con la etiqueta y el timestamp', async () => {
    const res = await GET(pedido(), ctx('ig-bio'));
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('gb_org=ig-bio.');
    expect(cookie).toContain('HttpOnly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
  });

  it('una etiqueta inválida redirige igual, pero sin cookie', async () => {
    const res = await GET(pedido(), ctx('NO VALE'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
