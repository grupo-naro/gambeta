import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { ApiAuthError } from '@/lib/types';
import { AppShell } from '@/components/app-shell';
import { AutoRefresh } from '@/components/auto-refresh';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof ApiAuthError) redirect('/login');
    throw e;
  }
  return <AppShell email={session.email} rol={session.rol}><AutoRefresh />{children}</AppShell>;
}
