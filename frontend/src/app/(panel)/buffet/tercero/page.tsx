import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { DiaSecundario, ProductoBuffet } from '@/lib/types';
import { DiarioPuesto } from '@/components/buffet/diario-puesto';
import { ProductosTable } from '@/components/buffet/productos-table';

const TERCERO = 'mostrador-tercero';

/** El tercero no depende del principal: acá se cargan sus productos, con sus precios y su stock. */
export default async function TerceroPage() {
  await requireAdmin();
  const [productos, dias] = await Promise.all([
    apiFetch<ProductoBuffet[]>(`/buffet/productos?mostradorId=${TERCERO}`),
    apiFetch<DiaSecundario[]>(`/buffet/secundario/diario?dias=14&mostradorId=${TERCERO}`),
  ]);
  return (
    <DiarioPuesto titulo="Mostrador tercero" activa="tercero" dias={dias}>
      <section className="space-y-2">
        <div>
          <h2 className="font-medium">Productos del tercero</h2>
          <p className="text-sm text-neutral-600">
            Catálogo propio: sus precios y su stock son independientes del principal. Puede repetir un nombre que ya existe en el principal con otro precio.
          </p>
        </div>
        <ProductosTable productos={productos} mostradorId={TERCERO} />
      </section>
    </DiarioPuesto>
  );
}
