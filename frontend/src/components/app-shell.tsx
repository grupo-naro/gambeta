'use client';
import { LogOut } from 'lucide-react';
import { logout } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { NavLink } from '@/components/nav-link';
import { navAgrupado } from '@/components/nav-items';
import { MobileNav } from '@/components/mobile-nav';
import { ConfirmProvider } from '@/components/ui/confirm';
import type { Rol } from '@/lib/types';

function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7 4.5 3.3-1.7 5.3H9.2L7.5 10.3 12 7Z" />
      <path d="M12 2v5M9.2 21l1.6-4.8M14.8 21l-1.6-4.8M3.6 9.5l4.4 1.1M20.4 9.5 16 10.6" />
    </svg>
  );
}

export function AppShell({ email, rol, children }: { email: string; rol: Rol; children: React.ReactNode }) {
  const initial = (email?.[0] ?? 'A').toUpperCase();
  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside className="hidden w-64 flex-col border-r border-neutral-200/80 bg-sidebar md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
            <Logo className="h-[18px] w-[18px]" />
          </span>
          <div className="leading-tight">
            <div className="text-[16px] font-semibold tracking-tight text-neutral-900">Gambeteando</div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neutral-500">RESERVAS</div>
          </div>
        </div>
        <nav className="flex-1 space-y-4 px-3 pt-2">
          {navAgrupado(rol).map((g) => (
            <div key={g.grupo} className="space-y-1">
              <div className="px-3 pb-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-neutral-500">{g.grupo}</div>
              {g.items.map((n) => (
                <NavLink key={n.href} href={n.href} label={n.label} Icon={n.icon} />
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-neutral-200/80 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initial}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-600">{email}</span>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-neutral-200/80 bg-white/75 px-6 backdrop-blur-md">
          <div className="md:hidden"><MobileNav rol={rol} /></div>
          <span className="flex items-center gap-2 font-semibold tracking-tight md:hidden">
            <Logo className="h-5 w-5 text-primary" /> Gambeteando
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-neutral-600 sm:inline">{email}</span>
            <form action={logout}>
              <Button variant="ghost" size="sm" type="submit" className="text-neutral-600 hover:text-neutral-900">
                <LogOut className="mr-1.5 h-4 w-4" /> Salir
              </Button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6 lg:p-8">
          <ConfirmProvider>{children}</ConfirmProvider>
        </main>
      </div>
    </div>
  );
}
