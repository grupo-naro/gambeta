import { requireAdmin } from '@/lib/require-admin';
import { getSession } from '@/lib/session';
import { apiFetch } from '@/lib/api';
import type { Usuario } from '@/lib/types';
import { UsuariosTable } from '@/components/usuarios/usuarios-table';

export default async function UsuariosPage() {
  await requireAdmin();
  const [usuarios, session] = await Promise.all([
    apiFetch<Usuario[]>('/usuarios'),
    getSession(),
  ]);
  return <UsuariosTable usuarios={usuarios} currentEmail={session.email} />;
}
