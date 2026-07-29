import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { ProductoBuffet } from '@/lib/types';
import { ProductosTable } from '@/components/buffet/productos-table';
import { PinMostradorForm } from '@/components/buffet/pin-mostrador-form';

export default async function BuffetPage() {
  await requireAdmin();
  const productos = await apiFetch<ProductoBuffet[]>('/buffet/productos');
  const bajos = productos.filter((p) => p.activo && p.stock <= p.stockMinimo);
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Buffet</h1>
        <p className="text-sm text-neutral-600">Catálogo y stock</p>
      </header>

      {bajos.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="font-medium text-amber-900">Stock bajo ({bajos.length})</p>
          <p className="mt-1 text-sm text-amber-800">{bajos.map((p) => `${p.nombre} (${p.stock})`).join(' · ')}</p>
        </div>
      )}

      <ProductosTable productos={productos} />

      <PinMostradorForm />
    </div>
  );
}
