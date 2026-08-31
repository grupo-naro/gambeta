'use client';
import { useEffect } from 'react';

// Guarda a nivel de módulo, no `useRef`: en desarrollo React monta dos veces con StrictMode y
// serían dos requests. El backend igual deduplica por sesión; esto sólo ahorra el viaje.
let enviado = false;

/**
 * Avisa que alguien entró al sitio. Vive en el navegador a propósito: es lo que deja afuera a
 * las previsualizaciones de links y a los crawlers, que no ejecutan JavaScript.
 */
export function RegistroVisita() {
  useEffect(() => {
    if (enviado) return;
    enviado = true;
    fetch('/api/visita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referer: document.referrer || null }),
    }).catch(() => {
      // Registrar una visita nunca puede romper una reserva.
    });
  }, []);
  return null;
}
