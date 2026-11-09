'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { BuffetResumen } from '@/lib/types';
import type { DatosCanchasPdf, PeriodoPdf } from '@/lib/dashboard-pdf';

type Props =
  | { vista: 'buffet'; datos: BuffetResumen; periodo: PeriodoPdf }
  | { vista: 'canchas'; datos: DatosCanchasPdf; periodo: PeriodoPdf };

/**
 * Descarga el PDF de lo que se está viendo (canchas o buffet) para el período elegido. El PDF se arma
 * en el navegador con los datos que la pantalla ya tiene; la librería se carga recién al tocar el botón.
 */
export function DescargarPdf(props: Props) {
  const [generando, setGenerando] = useState(false);

  async function descargar() {
    setGenerando(true);
    try {
      const { pdfBuffet, pdfCanchas, nombreArchivoPdf } = await import('@/lib/dashboard-pdf');
      const doc = props.vista === 'buffet' ? pdfBuffet(props.datos, props.periodo) : pdfCanchas(props.datos, props.periodo);
      doc.save(nombreArchivoPdf(props.vista, props.periodo));
    } catch {
      toast.error('No pude generar el PDF. Probá de nuevo.');
    } finally {
      setGenerando(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={descargar} disabled={generando}>
      <Download className="mr-1 h-4 w-4" /> {generando ? 'Generando…' : 'Descargar PDF'}
    </Button>
  );
}
