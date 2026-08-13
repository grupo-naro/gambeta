import { describe, it, expect, beforeEach } from 'vitest';
import { firmarSesion, leerSesion } from './buffet-session';

beforeEach(() => { process.env.BUFFET_API_KEY = 'clave-de-prueba-1234567890'; });

// El token que emite el backend al verificar el PIN. Tiene un punto adentro a propósito:
// es `<mostradorId>.<firma>`, y el formato viejo de la cookie (`exp.sig`) se rompía al partirlo.
const TOKEN_PRINCIPAL = 'mostrador-principal.a1b2c3d4e5f6';
const TOKEN_SECUNDARIO = 'mostrador-secundario.9f8e7d6c5b4a';

const PRINCIPAL = { token: TOKEN_PRINCIPAL, nombre: 'Principal', tipo: 'PRINCIPAL' as const };
const SECUNDARIO = { token: TOKEN_SECUNDARIO, nombre: 'Secundario', tipo: 'SECUNDARIO' as const };

describe('sesion del mostrador', () => {
  it('devuelve el token del mostrador que se firmo', () => {
    const s = firmarSesion(Date.now() + 60_000, PRINCIPAL);
    expect(leerSesion(s)?.token).toBe(TOKEN_PRINCIPAL);
  });

  it('recuerda quien es el mostrador, para poder mostrarlo en pantalla', () => {
    // Con dos puestos, el cajero necesita ver en cual esta cobrando. Va firmado adentro de la
    // cookie y no en un request aparte: no se puede falsear y no cuesta una llamada extra.
    const s = firmarSesion(Date.now() + 60_000, SECUNDARIO);
    expect(leerSesion(s)).toMatchObject({ nombre: 'Secundario', tipo: 'SECUNDARIO' });
  });

  it('un token con puntos adentro sobrevive el round-trip', () => {
    // Si el formato partiera por el primer punto, el token volvería truncado y el backend
    // lo rechazaría con un 401 imposible de diagnosticar desde la pantalla.
    const s = firmarSesion(Date.now() + 60_000, SECUNDARIO);
    expect(leerSesion(s)?.token).toBe(TOKEN_SECUNDARIO);
  });

  it('una sesion vencida no vale', () => {
    expect(leerSesion(firmarSesion(Date.now() - 1, PRINCIPAL))).toBeNull();
  });

  it('con la firma alterada no vale', () => {
    const s = firmarSesion(Date.now() + 60_000, PRINCIPAL);
    const [payload] = s.split('.');
    expect(leerSesion(`${payload}.firmafalsa`)).toBeNull();
  });

  it('no se puede cambiar de mostrador editando la cookie', () => {
    // El corazon del cambio: si esto pasara, el secundario podria hacerse pasar por el
    // principal y cargar el conteo de cierre de su propia caja.
    const principal = firmarSesion(Date.now() + 60_000, PRINCIPAL);
    const secundario = firmarSesion(Date.now() + 60_000, SECUNDARIO);
    const [, firmaDelPrincipal] = principal.split('.');
    const [payloadDelSecundario] = secundario.split('.');

    expect(leerSesion(`${payloadDelSecundario}.${firmaDelPrincipal}`)).toBeNull();
  });

  it('estirar el vencimiento sin refirmar no vale', () => {
    const s = firmarSesion(Date.now() + 1000, PRINCIPAL);
    const [, sig] = s.split('.');
    const payloadFalso = Buffer.from(
      JSON.stringify({ exp: Date.now() + 999_999, token: TOKEN_PRINCIPAL }),
    ).toString('base64url');
    expect(leerSesion(`${payloadFalso}.${sig}`)).toBeNull();
  });

  it('el formato viejo de cookie se rechaza', () => {
    // Las sesiones anteriores a este cambio no tienen identidad de mostrador. Que caduquen
    // es lo buscado: cada puesto vuelve a poner el PIN una vez y queda identificado.
    expect(leerSesion(`${Date.now() + 60_000}.loquesea`)).toBeNull();
  });

  it('basura no rompe, devuelve null', () => {
    expect(leerSesion('')).toBeNull();
    expect(leerSesion('sin-punto')).toBeNull();
    expect(leerSesion('a.b.c')).toBeNull();
  });
});
