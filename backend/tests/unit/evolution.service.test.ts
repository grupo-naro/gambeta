import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { evolutionService } from '../../src/services/evolution.service.js';

describe('evolutionService.enviarWhatsapp', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.EVOLUTION_URL = 'http://evo:8080';
    process.env.EVOLUTION_INSTANCE = 'inst';
  });
  afterEach(() => { process.env = { ...OLD }; });

  it('sin API key no envía y devuelve false', async () => {
    process.env.EVOLUTION_API_KEY = '';
    const spy = vi.spyOn(globalThis as any, 'fetch');
    const ok = await evolutionService.enviarWhatsapp('549110', 'hola');
    expect(ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('con config hace POST a /message/sendText/<instancia> con {number,text} y devuelve true en 2xx', async () => {
    process.env.EVOLUTION_API_KEY = 'k';
    const spy = vi.spyOn(globalThis as any, 'fetch').mockResolvedValue({ ok: true, status: 200 } as any);
    const ok = await evolutionService.enviarWhatsapp('549110', 'hola');
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    const [url, opts] = spy.mock.calls[0] as any;
    expect(url).toBe('http://evo:8080/message/sendText/inst');
    expect(opts.method).toBe('POST');
    expect(opts.headers.apikey).toBe('k');
    expect(JSON.parse(opts.body)).toEqual({ number: '549110', text: 'hola' });
  });

  it('respuesta no-2xx devuelve false', async () => {
    process.env.EVOLUTION_API_KEY = 'k';
    vi.spyOn(globalThis as any, 'fetch').mockResolvedValue({ ok: false, status: 500 } as any);
    await expect(evolutionService.enviarWhatsapp('549110', 'hola')).resolves.toBe(false);
  });

  it('si fetch falla, devuelve false y no lanza', async () => {
    process.env.EVOLUTION_API_KEY = 'k';
    vi.spyOn(globalThis as any, 'fetch').mockRejectedValue(new Error('down'));
    await expect(evolutionService.enviarWhatsapp('549110', 'hola')).resolves.toBe(false);
  });
});
