'use client'; // Los error boundaries de Next tienen que ser client components

import { useEffect } from 'react';

/**
 * Boundary de errores para todo /mostrador (venta, pin, entregar, conciliar/[cajaId]).
 *
 * Sin esto, un error de servidor acá (por ejemplo un cajaId que no existe) burbujea hasta
 * `app/global-error.tsx`, que dice "Estamos en mantenimiento" — un mensaje falso, porque el
 * sistema está sano y lo que está mal es el dato o el enlace — y encima reemplaza el layout
 * raíz entero, sin ningún link de vuelta.
 */
export default function MostradorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-xl font-semibold">No se pudo cargar esta pantalla.</p>
      <p className="text-sm text-neutral-600">
        Puede que el enlace esté vencido o el dato no exista. El resto del sistema sigue funcionando.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl border px-6 py-3 font-bold"
        >
          Reintentar
        </button>
        <a href="/mostrador" className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white">Volver a vender</a>
      </div>
    </main>
  );
}
