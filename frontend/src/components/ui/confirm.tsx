'use client';
import * as React from 'react';
import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>');
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  function cerrar(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={opts !== null} onOpenChange={(o) => { if (!o) cerrar(false); }}>
        {opts && (
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>{opts.title}</DialogTitle></DialogHeader>
            {opts.description && <p className="text-sm text-neutral-600">{opts.description}</p>}
            <DialogFooter>
              <Button variant="outline" className="h-10" onClick={() => cerrar(false)}>
                {opts.cancelLabel ?? 'Volver'}
              </Button>
              <Button variant={opts.destructive ? 'destructive' : 'default'} className="h-10" onClick={() => cerrar(true)}>
                {opts.confirmLabel ?? 'Confirmar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}
