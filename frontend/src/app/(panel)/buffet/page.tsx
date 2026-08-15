import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { ProductoBuffet, MostradorAdmin } from '@/lib/types';
import { estaBajo, stockTotal } from '@/lib/stock-buffet';
import { ProductosTable } from '@/components/buffet/productos-table';
import { MostradoresPanel } from '@/components/buffet/mostradores-panel';
import { SubNavBuffet } from '@/components/buffet/sub-nav';

export default async function BuffetPage() {
  await requireAdmin();
  const [productos, mostradores] = await Promise.all([
    apiFetch<ProductoBuffet[]>('/buffet/productos'),
    apiFetch<MostradorAdmin[]>('/buffet/mostradores'),
  ]);
  const bajos = productos.filter(estaBajo);
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Buffet</h1>
        <p className="text-sm text-neutral-600">Catálogo y stock</p>
      </header>
      <SubNavBuffet activa="catalogo" />

      {bajos.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="font-medium text-amber-900">Stock bajo ({bajos.length})</p>
          <p className="mt-1 text-sm text-amber-800">
            {bajos.map((p) => `${p.nombre} (${stockTotal(p)})`).join(' · ')}
          </p>
        </div>
      )}

      <ProductosTable productos={productos} />

      <MostradoresPanel mostradores={mostradores} />
    </div>
  );
}
