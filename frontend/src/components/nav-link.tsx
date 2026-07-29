'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';

export function NavLink({ href, label, Icon }: { href: string; label: string; Icon: LucideIcon }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary/10 text-primary'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
      }`}
    >
      <Icon
        className={`h-[18px] w-[18px] transition-colors ${
          active ? 'text-primary' : 'text-neutral-500 group-hover:text-neutral-600'
        }`}
      />
      {label}
    </Link>
  );
}
