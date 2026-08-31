import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { ArticuloAlquiler } from '@/lib/types';
import { ArticulosTable } from '@/components/alquileres/articulos-table';
import { SubNavAlquileres } from '@/components/alquileres/sub-nav';

export default async function AlquileresPage() {
  await requireAdmin();
  const articulos = await apiFetch<ArticuloAlquiler[]>('/alquileres/articulos');
  const sinStock = articulos.filter((a) => a.activo && a.disponible === 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Alquileres</h1>
        <p className="text-sm text-neutral-600">Artículos e inventario</p>
      </header>
      <SubNavAlquileres activa="catalogo" />

      {sinStock.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="font-medium text-amber-900">Sin disponibilidad ({sinStock.length})</p>
          <p className="mt-1 text-sm text-amber-800">{sinStock.map((a) => a.nombre).join(' · ')}</p>
        </div>
      )}

      <ArticulosTable articulos={articulos} />
    </div>
  );
}
