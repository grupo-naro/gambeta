import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '../config/env.js';
import { Conflict } from './errors.js';

const ALGORITMO = 'aes-256-gcm';

/**
 * GCM además de cifrar autentica: si alguien edita el dato en la base, `descifrar` falla
 * en vez de devolver basura silenciosamente.
 */
function clave(): Buffer {
  const raw = getEnv().MP_ENCRYPTION_KEY;
  if (!raw) throw Conflict('Falta la variable MP_ENCRYPTION_KEY en el backend');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw Conflict('MP_ENCRYPTION_KEY tiene que ser de 32 bytes en base64');
  return k;
}

/** Devuelve `iv.tag.datos`, los tres en base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12); // 12 bytes es el tamaño recomendado para GCM
  const c = createCipheriv(ALGORITMO, clave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join('.');
}

export function descifrar(guardado: string): string {
  const [ivB64, tagB64, datosB64] = guardado.split('.');
  if (!ivB64 || !tagB64 || !datosB64) throw Conflict('El dato cifrado está corrupto');
  const d = createDecipheriv(ALGORITMO, clave(), Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datosB64, 'base64')), d.final()]).toString('utf8');
}
