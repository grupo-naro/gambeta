import Link from 'next/link';

const BASE =
  'inline-flex items-center justify-center rounded-full bg-lime-500 font-bold text-black transition hover:bg-lime-400';

// Mismo criterio que en BotonWhatsapp: el tamaño va por prop, no por className.
const TAMANOS = {
  normal: 'px-8 py-3 text-base',
  ancho: 'w-full px-6 py-3 text-base',
};

/** CTA primario de la landing. Único lugar donde vive el estilo del botón lima. */
export function BotonReservar({
  children = 'Reservar ahora',
  tamano = 'normal',
  className = '',
}: {
  children?: React.ReactNode;
  tamano?: keyof typeof TAMANOS;
  className?: string;
}) {
  return (
    <Link href="/reservar" className={`${BASE} ${TAMANOS[tamano]} ${className}`}>
      {children}
    </Link>
  );
}
