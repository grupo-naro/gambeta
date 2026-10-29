import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { CuentaBuffet, EstadoCuentaBuffet } from '@/lib/types';
import { SubNavBuffet } from '@/components/buffet/sub-nav';
import { CuentasAdmin } from '@/components/buffet/cuentas-admin';

const ESTADOS: EstadoCuentaBuffet[] = ['ABIERTA', 'RENDIDA', 'CANCELADA', 'IMPAGA'];

export default async function CuentasBuffetPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  await requireAdmin();
  const { estado } = await searchParams;
  const filtro = ESTADOS.find((e) => e === estado);
  const cuentas = await apiFetch<CuentaBuffet[]>(`/buffet/admin/cuentas${filtro ? `?estado=${filtro}` : ''}`);
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Cuentas por cancha</h1>
        <p className="text-sm text-neutral-600">Consumos del buffet por cancha. Solo lectura: se manejan desde el mostrador.</p>
      </header>
      <SubNavBuffet activa="cuentas" />
      <CuentasAdmin cuentas={cuentas} filtro={filtro ?? ''} />
    </div>
  );
}
