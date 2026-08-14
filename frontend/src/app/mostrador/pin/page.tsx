import { redirect } from 'next/navigation';
import { sesionBuffetValida } from '@/lib/buffet-session';
import { PinForm } from '@/components/mostrador/pin-form';

export default async function MostradorPinPage({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  // `?motivo=revocado` lo pone `manejarBuffetNoAutorizado` cuando el backend devolvió 401 (el
  // mostrador de esta cookie fue desactivado, o rotaron BUFFET_API_KEY). La cookie sigue
  // firmada y "válida" a los ojos de `sesionBuffetValida()` — no la borramos porque eso solo se
  // puede hacer en una Server Action, no en el render de esta página — así que con la marca
  // presente ignoramos esa validez y mostramos el PIN igual. Sin esto, el guard de abajo
  // mandaría de vuelta a /mostrador y cerraría el loop del que este flujo intenta sacar al
  // operador.
  if (motivo !== 'revocado' && (await sesionBuffetValida())) redirect('/mostrador');
  return <PinForm mensaje={motivo === 'revocado' ? 'Tu sesión fue revocada. Pedí un PIN nuevo para volver a entrar.' : undefined} />;
}
