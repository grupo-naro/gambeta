'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usuarioSchema } from '@/lib/validators';
import { crearUsuario } from '@/lib/usuarios-actions';

export function UsuarioDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<'ADMIN' | 'RECEPCIONISTA'>('RECEPCIONISTA');
  const [venc, setVenc] = useState('');
  const [pending, start] = useTransition();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setEmail(''); setNombre(''); setPassword(''); setRol('RECEPCIONISTA'); setVenc('');
    }
    onOpenChange(next);
  }

  function submit() {
    const duracionDias = venc ? (Number(venc) as 1 | 2 | 7 | 30) : undefined;
    const parsed = usuarioSchema.safeParse({ email, nombre, password, rol, duracionDias });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await crearUsuario(parsed.data);
      if (r.ok) { toast.success('Usuario creado'); handleOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo usuario</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-nombre">Nombre</Label>
            <Input id="u-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-pass">Contraseña</Label>
            <Input id="u-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mín. 6 caracteres" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-rol">Rol</Label>
            <select id="u-rol" value={rol} onChange={(e) => setRol(e.target.value as 'ADMIN' | 'RECEPCIONISTA')} className="w-full rounded-md border px-2 py-1.5">
              <option value="RECEPCIONISTA">Recepcionista</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-venc">Vencimiento</Label>
            <select id="u-venc" value={venc} onChange={(e) => setVenc(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              <option value="">Sin vencimiento</option>
              <option value="1">1 día</option>
              <option value="2">2 días</option>
              <option value="7">7 días</option>
              <option value="30">30 días</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : 'Crear usuario'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
