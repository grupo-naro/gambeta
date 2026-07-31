import { whatsappUrl } from '@/lib/negocio';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full border-2 font-semibold transition';

// El tamaño va por prop y no por className: en Tailwind el orden de las clases
// en el atributo no decide quién gana, decide el orden en la hoja generada.
// Pasar `px-5` "encima" de `px-6` no funcionaría de forma confiable.
const TAMANOS = {
  normal: 'px-6 py-3 text-base',
  chico: 'px-5 py-2 text-sm',
};

/**
 * CTA de WhatsApp. Mientras no esté cargado el número en `negocio.ts`,
 * se muestra atenuado y sin link, en vez de un `wa.me/` roto.
 */
export function BotonWhatsapp({
  mensaje,
  children = 'Consultas por WhatsApp',
  tamano = 'normal',
  className = '',
}: {
  mensaje?: string;
  children?: React.ReactNode;
  tamano?: keyof typeof TAMANOS;
  className?: string;
}) {
  const url = whatsappUrl(mensaje);
  const clases = `${BASE} ${TAMANOS[tamano]} ${className}`;

  if (!url) {
    return (
      <span
        className={`${clases} cursor-not-allowed border-neutral-700 text-neutral-500`}
        title="Falta cargar el número de WhatsApp en negocio.ts"
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${clases} border-neutral-600 text-neutral-100 hover:border-lime-500 hover:text-lime-400`}
    >
      {children}
    </a>
  );
}
