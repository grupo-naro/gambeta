import Link from 'next/link';

const PAGINAS = [
  { clave: 'catalogo', href: '/buffet', label: 'Catálogo' },
  { clave: 'cierres', href: '/buffet/cierres', label: 'Cierres' },
  { clave: 'conciliaciones', href: '/buffet/conciliaciones', label: 'Faltantes' },
  { clave: 'entregas', href: '/buffet/entregas', label: 'Entregas' },
] as const;

export type PaginaBuffet = (typeof PAGINAS)[number]['clave'];

/**
 * Los links entre las páginas del buffet.
 *
 * Existe porque el menú principal solo lleva a `/buffet`: sin esto, las otras tres son
 * inalcanzables salvo tipeando la URL — que es como quedó `cierres` hasta ahora.
 */
export function SubNavBuffet({ activa }: { activa: PaginaBuffet }) {
  return (
    <nav className="flex flex-wrap gap-2">
      {PAGINAS.map((p) => (
        <Link
          key={p.clave}
          href={p.href}
          className={`rounded-lg px-3 py-1 text-sm font-medium ${
            p.clave === activa ? 'bg-neutral-900 text-white' : 'border text-neutral-700'
          }`}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
