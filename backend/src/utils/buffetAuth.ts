import { timingSafeEqual } from 'node:crypto';

// Se lee de process.env en cada llamada: permite rotar la key sin reiniciar
// y hace testeable el módulo sin bootstrappear todo el env.
function keysAceptadas(): string[] {
  const raw = [process.env.BUFFET_API_KEY ?? ''];
  return [...new Set(raw.map((s) => s.trim()).filter((s) => s.length > 0))];
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false; // timingSafeEqual exige mismo largo
  return timingSafeEqual(ab, bb);
}

export function isValidBuffetKey(provided: string | undefined | null): boolean {
  if (!provided) return false;
  return keysAceptadas().some((k) => safeEqual(provided, k));
}
