import { providerLabels } from '@/lib/format';
import { projectQuery } from '@/lib/queries';
import { useConnectedSession } from '@/lib/session';
import { useQuery } from '@tanstack/react-query';
import { CheckIcon, CircleIcon } from 'lucide-react';

import { Card, CardContent } from '@pushlane/ui/components/card';

/** Plan usage, retention, and which push providers have credentials. */
export function ProjectOverview() {
  const session = useConnectedSession();
  const { data: project } = useQuery(projectQuery(session));
  const { usage } = project;
  const metrics = [
    {
      label: 'CURRENT PROJECT',
      value: project.name,
      detail: `${project.environment} environment`,
    },
    {
      label: 'MONTHLY DISPATCHES',
      value: usage.reservedDispatches.toLocaleString(),
      detail:
        usage.limit === null
          ? `No plan allowance · ${usage.month}`
          : `of ${usage.limit.toLocaleString()} allowed · ${usage.month}`,
    },
    {
      label: 'LOG RETENTION',
      value:
        project.logRetentionDays === null ? 'No plan expiry' : `${project.logRetentionDays} days`,
      detail: `${project.plan.replaceAll('_', ' ')} plan`,
    },
  ];

  return (
    <>
      <section aria-label="Project overview" className="grid gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label} size="sm">
            <CardContent className="flex min-w-0 flex-col gap-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                {metric.label}
              </p>
              <strong className="truncate text-lg">{metric.value}</strong>
              <span className="text-sm text-muted-foreground">{metric.detail}</span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section
        aria-labelledby="provider-heading"
        className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border bg-background px-4 py-3"
      >
        <h2 id="provider-heading" className="text-sm font-medium">
          Provider setup
        </h2>
        <ul aria-label="Configured push providers" className="flex flex-wrap gap-4 text-sm">
          {Object.entries(providerLabels).map(([kind, label]) => {
            const configured = project.providers.includes(kind);
            const Icon = configured ? CheckIcon : CircleIcon;

            return (
              <li
                key={kind}
                className={
                  configured
                    ? 'flex items-center gap-1.5'
                    : 'flex items-center gap-1.5 text-muted-foreground'
                }
              >
                <Icon aria-hidden="true" className="size-3.5" />
                {configured ? label : `${label} not configured`}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
