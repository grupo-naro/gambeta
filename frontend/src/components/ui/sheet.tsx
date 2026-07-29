'use client';
import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/30 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-popover p-4 pb-6 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none duration-150 data-open:animate-in data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:slide-out-to-bottom-4 sm:bottom-4 sm:rounded-2xl',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Cerrar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex flex-col gap-1', className)} {...props} />;
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title data-slot="sheet-title" className={cn('font-heading text-base font-medium', className)} {...props} />
  );
}

export { Sheet, SheetContent, SheetHeader, SheetTitle };
