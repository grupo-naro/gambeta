'use client';
import { useEffect, useRef } from 'react';

/**
 * Avisa que alguien entró al sitio. Vive en el navegador a propósito: es lo que deja afuera a
 * las previsualizaciones de links y a los crawlers, que no ejecutan JavaScript.
 */
export function RegistroVisita() {
  // Guarda por instancia, no de módulo: alcanza para cubrir el doble-montaje de StrictMode en
  // dev (setup → cleanup → setup corren sobre la misma instancia, así que el ref persiste), pero
  // se resetea ante un desmontaje/montaje real. La autoridad sobre si la visita ya se contó es
  // la cookie de sesión del route handler, no un flag que sobreviva más que el componente.
  const enviado = useRef(false);
  useEffect(() => {
    if (enviado.current) return;
    enviado.current = true;
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
