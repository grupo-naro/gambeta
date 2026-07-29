import { timingSafeEqual } from 'node:crypto';

// Conjunto de service keys aceptadas: la primaria + las extra de SERVICE_API_KEYS
// (coma-separadas). Se lee de process.env en cada llamada para permitir rotación
// sin reiniciar y para ser testeable sin bootstrappear todo el env.
function keysAceptadas(): string[] {
  const raw = [process.env.SERVICE_API_KEY ?? '', ...(process.env.SERVICE_API_KEYS ?? '').split(',')];
  return [...new Set(raw.map((s) => s.trim()).filter((s) => s.length > 0))];
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false; // timingSafeEqual exige mismo largo
  return timingSafeEqual(ab, bb);
}

export function isValidServiceKey(provided: string | undefined | null): boolean {
  if (!provided) return false;
  return keysAceptadas().some((k) => safeEqual(provided, k));
}
