'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Refresca los datos del panel (re-ejecuta los Server Components vía router.refresh)
 * cada `intervalMs`. No recarga la página: mantiene scroll, estado de diálogos, etc.
 * Se pausa cuando la pestaña no está visible y refresca al volver.
 */
export function AutoRefresh({ intervalMs = 60000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (id == null) id = setInterval(() => router.refresh(), intervalMs); };
    const stop = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { router.refresh(); start(); }
      else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [router, intervalMs]);
  return null;
}
