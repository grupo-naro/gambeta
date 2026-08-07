import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Config } from '@/lib/types';
import { ConfigForm } from '@/components/config/config-form';
import { getSheetsInfo } from '@/lib/sheets-actions';
import { getCuentaMp } from '@/lib/mercadopago-actions';
import { PlanillaGoogle } from '@/components/config/planilla-google';
import { CuentaMercadoPago } from '@/components/config/cuenta-mercadopago';

export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ mp?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const resultado = sp.mp === 'ok' || sp.mp === 'error' ? sp.mp : undefined;
  const [config, sheets, cuentaMp] = await Promise.all([apiFetch<Config>('/config'), getSheetsInfo(), getCuentaMp()]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="mt-1 text-sm text-neutral-600">Horarios, contacto y datos de pago del complejo.</p>
      </div>
      <ConfigForm config={config} />
      <CuentaMercadoPago cuenta={cuentaMp} resultado={resultado} />
      <PlanillaGoogle info={sheets} />
    </div>
  );
}
