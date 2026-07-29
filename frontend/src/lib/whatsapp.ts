// Espejo de backend/src/utils/whatsapp.ts. Mantener en sync.
export function aCanonico(raw: string): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 13 && d.startsWith('549')) return d;
  if (d.length === 12 && d.startsWith('54')) return '549' + d.slice(2);
  if (d.length === 10) return '549' + d;
  return null;
}

// "5491136620274" → "+54 9 11 3662-0274". null si el input no resuelve.
export function previewWhatsapp(raw: string): string | null {
  const c = aCanonico(raw);
  if (!c) return null;
  const local = c.slice(3); // 10 dígitos: área(2) + número(8)
  return `+54 9 ${local.slice(0, 2)} ${local.slice(2, 6)}-${local.slice(6)}`;
}
