'use client';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { SheetsInfo } from '@/lib/types';
import { sincronizarSheets } from '@/lib/sheets-actions';

export function PlanillaGoogle({ info }: { info: SheetsInfo }) {
  const [pending, start] = useTransition();
  function sync() {
    start(async () => { const r = await sincronizarSheets(); if (r.ok) toast.success('Planilla actualizada'); else toast.error(r.error); });
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Planilla de Google</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {info.configurado ? (
          <>
            <p>La planilla se actualiza sola con cada cambio. <a href={info.url!} target="_blank" rel="noreferrer" className="text-primary underline">Abrir planilla</a></p>
            <Button variant="outline" disabled={pending} onClick={sync}>{pending ? 'Sincronizando…' : 'Sincronizar ahora'}</Button>
          </>
        ) : (
          <p className="text-neutral-600">No está configurada. Para activarla: crear una cuenta de servicio en Google Cloud, compartir el Sheet con su email, y setear <code>GOOGLE_SERVICE_ACCOUNT</code> (base64) y <code>SHEETS_SPREADSHEET_ID</code> en el servidor.</p>
        )}
      </CardContent>
    </Card>
  );
}
