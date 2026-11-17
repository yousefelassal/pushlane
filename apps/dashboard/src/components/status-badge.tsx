import { Badge } from '@pushlane/ui/components/badge';

import { statusLabels } from '@/lib/format';

import type { ComponentProps } from 'react';

const variants: Record<string, ComponentProps<typeof Badge>['variant']> = {
  provider_accepted: 'default',
  failed: 'destructive',
  expired: 'outline',
  suppressed: 'outline',
  no_registered_devices: 'outline',
};

/** Shows a known status with its label and an unfamiliar one as plain text. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={variants[status] ?? 'secondary'}>{statusLabels[status] ?? status}</Badge>;
}
