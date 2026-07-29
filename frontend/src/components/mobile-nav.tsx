'use client';
import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Menu, LogOut } from 'lucide-react';
import { logout } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { NavLink } from '@/components/nav-link';
import { navAgrupado } from '@/components/nav-items';
import type { Rol } from '@/lib/types';

export function MobileNav({ rol }: { rol: Rol }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button variant="ghost" size="icon" aria-label="Abrir menú" />}>
        <Menu className="h-5 w-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar p-3 shadow-xl outline-none transition-transform duration-200 data-closed:-translate-x-full data-open:translate-x-0">
          <Dialog.Title className="px-2 py-3 text-[16px] font-semibold tracking-tight text-neutral-900">
            Grupo <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neutral-500">NARO</span>
          </Dialog.Title>
          {/* onClick en el contenedor: cualquier NavLink tocado cierra el drawer (burbujea) */}
          <nav className="flex-1 space-y-4" onClick={() => setOpen(false)}>
            {navAgrupado(rol).map((g) => (
              <div key={g.grupo} className="space-y-1">
                <div className="px-3 pb-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-neutral-500">{g.grupo}</div>
                {g.items.map((n) => <NavLink key={n.href} href={n.href} label={n.label} Icon={n.icon} />)}
              </div>
            ))}
          </nav>
          <form action={logout} className="border-t border-neutral-200/80 pt-2">
            <Button variant="ghost" size="sm" type="submit" className="w-full justify-start text-neutral-600">
              <LogOut className="mr-1.5 h-4 w-4" /> Salir
            </Button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
