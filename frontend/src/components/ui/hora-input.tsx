'use client';
import { Input } from '@/components/ui/input';
import { maskHora, normalizeHora } from '@/lib/hora';

export function HoraInput({
  id,
  value,
  onChange,
  placeholder = '21:00',
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(maskHora(e.target.value))}
      onBlur={() => {
        const n = normalizeHora(value);
        if (n) onChange(n);
      }}
    />
  );
}
