import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/require-admin';
import { completarVinculacionMp } from '@/lib/mercadopago-actions';

/** Mercado Pago vuelve acá después de que el dueño autoriza (o cancela) la vinculación en su sitio. */
export default async function MercadoPagoCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; state?: string; error?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  // El dueño canceló en Mercado Pago, o volvió sin los datos esperados: no tocamos ninguna vinculación existente.
  if (sp.error || !sp.code || !sp.state) redirect('/configuracion');

  const r = await completarVinculacionMp(sp.code, sp.state);
  redirect(r.ok ? '/configuracion?mp=ok' : '/configuracion?mp=error');
}
