import { Sun, LayoutDashboard, CalendarDays, CalendarRange, CalendarCheck, LandPlot, CalendarClock, Ban, Settings, Users, Activity, Wallet, Contact, ShoppingBasket, Handshake, BadgeCheck, type LucideIcon } from 'lucide-react';
import type { Rol } from '@/lib/types';
import { SOCIOS_HABILITADO } from '@/lib/features';

export type Grupo = 'Operación' | 'Programación' | 'Administración';

export interface NavItem { href: string; label: string; icon: LucideIcon; roles: Rol[]; grupo: Grupo }

const AMBOS: Rol[] = ['ADMIN', 'RECEPCIONISTA'];
const SOLO_ADMIN: Rol[] = ['ADMIN'];

/** Orden canónico en que se muestran los grupos del menú. */
export const GRUPOS: Grupo[] = ['Operación', 'Programación', 'Administración'];

export const nav: NavItem[] = [
  // Operación — el día a día
  { href: '/hoy', label: 'Hoy', icon: Sun, roles: AMBOS, grupo: 'Operación' },
  { href: '/reservas', label: 'Reservas', icon: CalendarDays, roles: AMBOS, grupo: 'Operación' },
  { href: '/disponibilidad', label: 'Disponibilidad', icon: CalendarCheck, roles: AMBOS, grupo: 'Operación' },
  { href: '/calendario', label: 'Calendario', icon: CalendarRange, roles: AMBOS, grupo: 'Operación' },
  { href: '/caja', label: 'Caja', icon: Wallet, roles: AMBOS, grupo: 'Operación' },
  { href: '/clientes', label: 'Clientes', icon: Contact, roles: AMBOS, grupo: 'Operación' },
  { href: '/buffet', label: 'Buffet', icon: ShoppingBasket, roles: SOLO_ADMIN, grupo: 'Operación' },
  { href: '/alquileres', label: 'Alquileres', icon: Handshake, roles: SOLO_ADMIN, grupo: 'Operación' },
  // Programación — la grilla / recursos
  { href: '/canchas', label: 'Canchas', icon: LandPlot, roles: SOLO_ADMIN, grupo: 'Programación' },
  { href: '/turnos-fijos', label: 'Turnos fijos', icon: CalendarClock, roles: AMBOS, grupo: 'Programación' },
  { href: '/bloqueos', label: 'Bloqueos', icon: Ban, roles: SOLO_ADMIN, grupo: 'Programación' },
  // Administración — gestión / sistema
  { href: '/dashboard', label: 'Analíticas', icon: LayoutDashboard, roles: SOLO_ADMIN, grupo: 'Administración' },
  // Socios está apagado: el complejo maneja a los socios con turnos fijos. La entrada queda
  // acá, detrás del flag, para reactivarla sin reescribir el menú. Ver lib/features.ts.
  ...(SOCIOS_HABILITADO ? [{ href: '/socios', label: 'Socios', icon: BadgeCheck, roles: SOLO_ADMIN, grupo: 'Administración' as const }] : []),
  { href: '/configuracion', label: 'Configuración', icon: Settings, roles: SOLO_ADMIN, grupo: 'Administración' },
  { href: '/usuarios', label: 'Usuarios', icon: Users, roles: SOLO_ADMIN, grupo: 'Administración' },
  { href: '/actividad', label: 'Actividad', icon: Activity, roles: SOLO_ADMIN, grupo: 'Administración' },
];

export interface GrupoNav { grupo: Grupo; items: NavItem[] }

/** Grupos (en orden de GRUPOS) con sus ítems visibles para el rol; omite grupos vacíos. */
export function navAgrupado(rol: Rol): GrupoNav[] {
  return GRUPOS
    .map((grupo) => ({ grupo, items: nav.filter((n) => n.grupo === grupo && n.roles.includes(rol)) }))
    .filter((g) => g.items.length > 0);
}
