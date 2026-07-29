import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Config } from '@/lib/types';
import { ConfigForm } from '@/components/config/config-form';
import { getSheetsInfo } from '@/lib/sheets-actions';
import { PlanillaGoogle } from '@/components/config/planilla-google';

export default async function ConfiguracionPage() {
  await requireAdmin();
  const [config, sheets] = await Promise.all([apiFetch<Config>('/config'), getSheetsInfo()]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="mt-1 text-sm text-neutral-600">Horarios, contacto y datos de pago del complejo.</p>
      </div>
      <ConfigForm config={config} />
      <PlanillaGoogle info={sheets} />
    </div>
  );
}
