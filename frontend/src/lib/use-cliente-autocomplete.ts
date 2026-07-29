'use client';
import { useEffect, useRef, useState } from 'react';
import { buscarClientePorWhatsapp } from '@/lib/clientes-actions';
import { aCanonico } from '@/lib/whatsapp';

/**
 * Busca (con debounce) el cliente por WhatsApp y, si existe, llama onFound(nombre).
 * Devuelve `encontrado` para mostrar un cartelito.
 */
export function useClienteAutocomplete(whatsapp: string, onFound: (nombre: string) => void): boolean {
  const [encontrado, setEncontrado] = useState(false);
  const reqRef = useRef(0);
  const onFoundRef = useRef(onFound);
  useEffect(() => { onFoundRef.current = onFound; });

  useEffect(() => {
    const canon = aCanonico(whatsapp);
    if (!canon) {
      setEncontrado(false);
      return;
    }
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      const c = await buscarClientePorWhatsapp(whatsapp);
      if (reqRef.current !== id) return; // llegó una búsqueda más nueva
      if (c) {
        onFoundRef.current(c.nombre);
        setEncontrado(true);
      } else {
        setEncontrado(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [whatsapp]);

  return encontrado;
}
