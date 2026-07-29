import { apiFetch } from '@/lib/api';
import type { Cliente } from '@/lib/types';
import { ClientesTable } from '@/components/clientes/clientes-table';

export default async function ClientesPage() {
  const clientes = await apiFetch<Cliente[]>('/clientes');
  return <ClientesTable clientes={clientes} />;
}
