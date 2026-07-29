'use client';
import { useActionState } from 'react';
import { login } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7 4.5 3.3-1.7 5.3H9.2L7.5 10.3 12 7Z" />
      <path d="M12 2v5M9.2 21l1.6-4.8M14.8 21l-1.6-4.8M3.6 9.5l4.4 1.1M20.4 9.5 16 10.6" />
    </svg>
  );
}

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-neutral-50 p-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(60% 55% at 50% -10%, oklch(0.55 0.13 150 / 0.14), transparent)' }}
        aria-hidden
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Logo className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Grupo Naro</h1>
          <p className="mt-1 text-sm text-neutral-600">Panel de administración</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <form action={action} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" placeholder="vos@gruponaro.com.ar" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
            </div>
            {state?.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-neutral-500">Grupo Naro · Reservas</p>
      </div>
    </main>
  );
}
