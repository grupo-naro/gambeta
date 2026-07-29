import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';

export function MetricCard({
  title,
  value,
  hint,
  Icon,
}: {
  title: string;
  value: string;
  hint?: string;
  Icon?: LucideIcon;
}) {
  return (
    <Card className="gap-0 transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-neutral-600">{title}</CardTitle>
        {Icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
        )}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight text-neutral-900">{value}</div>
        {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}
