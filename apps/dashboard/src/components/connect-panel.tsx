import { errorMessage } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useMutation } from '@tanstack/react-query';
import { ArrowRightIcon } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription } from '@pushlane/ui/components/alert';
import { Button } from '@pushlane/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@pushlane/ui/components/card';
import { Field, FieldDescription, FieldLabel } from '@pushlane/ui/components/field';
import { Input } from '@pushlane/ui/components/input';

/** Collects a backend project key. The key is held in memory only. */
export function ConnectPanel() {
  const { connect } = useSession();
  const [apiKey, setApiKey] = useState('');
  const connection = useMutation({
    mutationFn: connect,
    onSuccess: () => setApiKey(''),
  });

  return (
    <Card role="region" className="mx-auto w-full max-w-2xl" aria-labelledby="connect-heading">
      <CardHeader>
        <p className="text-xs font-medium tracking-wide text-muted-foreground">
          LET'S GET CONNECTED
        </p>
        <CardTitle>
          <h2 id="connect-heading">Your next notification starts here.</h2>
        </CardTitle>
        <CardDescription>
          Connect a project to inspect logs, check provider setup, and send a test notification.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            connection.mutate(apiKey.trim());
          }}
        >
          <Field>
            <FieldLabel htmlFor="api-key">Project API key</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your backend project key"
                required
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <Button type="submit" disabled={connection.isPending}>
                {connection.isPending ? 'Connecting…' : 'Connect project'}
                <ArrowRightIcon aria-hidden="true" />
              </Button>
            </div>
            <FieldDescription>
              Your key stays in this page's memory. Reloading or disconnecting clears it.
            </FieldDescription>
          </Field>
        </form>
        {connection.isError && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(connection.error)}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          Run <code className="rounded bg-muted px-1">pnpm project:create --name "My app"</code> to
          create your first project.
        </p>
      </CardContent>
    </Card>
  );
}
