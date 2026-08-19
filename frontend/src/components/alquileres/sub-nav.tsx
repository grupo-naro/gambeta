import Link from 'next/link';

const PAGINAS = [
  { clave: 'catalogo', href: '/alquileres', label: 'Artículos' },
  { clave: 'movimientos', href: '/alquileres/movimientos', label: 'Movimientos' },
] as const;

export type PaginaAlquileres = (typeof PAGINAS)[number]['clave'];

export function SubNavAlquileres({ activa }: { activa: PaginaAlquileres }) {
  return (
    <nav className="flex flex-wrap gap-2">
      {PAGINAS.map((p) => (
        <Link key={p.clave} href={p.href}
          className={`rounded-lg px-3 py-1 text-sm font-medium ${
            p.clave === activa ? 'bg-neutral-900 text-white' : 'border text-neutral-700'
          }`}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
