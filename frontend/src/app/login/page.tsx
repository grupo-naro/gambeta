'use client';
import Image from 'next/image';
import { useActionState } from 'react';
import { login } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Mismo criterio que el sidebar: alto fijo, ancho automático (el PNG es retrato 1695x1877),
// sin fondo propio porque el login es de tema claro.
// `alt` va explícito en el uso: con el spread, jsx-a11y/alt-text no puede verificarlo.
const LOGO = { src: '/logo.png', width: 1695, height: 1877 };

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
          <Image {...LOGO} alt="Gambeteando" priority sizes="64px" className="mb-3 h-14 w-auto" />
          <h1 className="text-xl font-semibold tracking-tight">Gambeteando</h1>
          <p className="mt-1 text-sm text-neutral-600">Panel de administración</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <form action={action} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" placeholder="vos@gambeteando.com.ar" />
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
        <p className="mt-6 text-center text-xs text-neutral-500">Gambeteando · Reservas</p>
      </div>
    </main>
  );
}
