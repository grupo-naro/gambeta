import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { LogActividad } from '@/lib/types';
import { ActividadList } from '@/components/actividad/actividad-list';

export default async function ActividadPage() {
  await requireAdmin();
  const logs = await apiFetch<LogActividad[]>('/auditoria');
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Actividad</h1>
        <p className="mt-1 text-sm text-neutral-600">Registro de cambios hechos en el panel.</p>
      </div>
      <ActividadList logs={logs} />
    </div>
  );
}
