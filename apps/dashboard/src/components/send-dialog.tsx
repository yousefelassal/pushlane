import { errorMessage, plural } from '@/lib/format';
import { sendNotification } from '@/lib/queries';
import { useConnectedSession } from '@/lib/session';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SendIcon, XIcon } from 'lucide-react';
import { useRef } from 'react';
import { z } from 'zod';

import { Alert, AlertDescription } from '@pushlane/ui/components/alert';
import { Button } from '@pushlane/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pushlane/ui/components/dialog';
import { Field, FieldError, FieldLabel } from '@pushlane/ui/components/field';
import { Input } from '@pushlane/ui/components/input';
import { Textarea } from '@pushlane/ui/components/textarea';

import type { SendInput } from '@/lib/queries';

const optionalHttps = z
  .string()
  .trim()
  .refine((value) => value === '' || /^https:\/\/\S+$/.test(value), 'Use an HTTPS URL.');

const sendSchema = z.object({
  userId: z.string().trim().min(1, 'Enter a user ID.').max(200),
  title: z.string().min(1, 'Enter a title.').max(200),
  body: z.string().min(1, 'Enter a body.').max(2000),
  image: optionalHttps,
  url: optionalHttps,
});

type SendForm = z.input<typeof sendSchema>;

const emptyForm: SendForm = { userId: '', title: '', body: '', image: '', url: '' };

const fields = [
  { name: 'userId', label: 'User ID', placeholder: 'user_123' },
  { name: 'title', label: 'Title', placeholder: 'Your order shipped' },
  { name: 'body', label: 'Body', placeholder: 'Your package arrives tomorrow.', multiline: true },
  {
    name: 'image',
    label: 'Image URL',
    placeholder: 'https://example.com/package.jpg',
    optional: true,
  },
  {
    name: 'url',
    label: 'Click destination',
    placeholder: 'https://example.com/orders/123',
    optional: true,
  },
] as const;

function toInput(form: SendForm): SendInput {
  return {
    userId: form.userId.trim(),
    title: form.title,
    body: form.body,
    ...(form.image.trim() ? { image: form.image.trim() } : {}),
    ...(form.url.trim() ? { url: form.url.trim() } : {}),
  };
}

/**
 * Sends a notification from the dashboard.
 *
 * A failed request can still have been accepted, so retrying the same payload reuses its
 * idempotency key. Changing the payload starts a new send.
 */
export function SendDialog({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const session = useConnectedSession();
  const queryClient = useQueryClient();
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);

  const send = useMutation({
    mutationFn: (input: SendInput) => {
      const fingerprint = JSON.stringify(input);

      if (pending.current?.fingerprint !== fingerprint) {
        pending.current = { fingerprint, key: crypto.randomUUID() };
      }

      return sendNotification(session, input, pending.current.key);
    },
    onSuccess: (receipt) => {
      pending.current = null;
      form.reset();
      onClose();
      onSent(
        receipt.status === 'no_registered_devices'
          ? `Notification ${receipt.id} was recorded. This user has no registered devices.`
          : `Notification ${receipt.id} was queued for ${plural(receipt.deliveryCount, 'installation')}.`
      );
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });

  const form = useForm({
    defaultValues: emptyForm,
    validators: { onSubmit: sendSchema },
    onSubmit: async ({ value }) => {
      await send.mutateAsync(toInput(value)).catch(() => undefined);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className="max-h-[90svh] overflow-y-auto">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                NEW NOTIFICATION
              </p>
              <DialogTitle>Send to a user</DialogTitle>
              <DialogDescription>
                The worker sends to this user's active installations.
              </DialogDescription>
            </div>
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" aria-label="Close send form" />}
            >
              <XIcon aria-hidden="true" />
            </DialogClose>
          </DialogHeader>

          {fields.map((definition) => (
            <form.Field key={definition.name} name={definition.name}>
              {(field) => {
                const id = `send-${definition.name}`;
                const invalid = field.state.meta.errors.length > 0;
                const props = {
                  id,
                  name: definition.name,
                  placeholder: definition.placeholder,
                  value: field.state.value,
                  'aria-invalid': invalid,
                  onBlur: field.handleBlur,
                };

                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={id}>
                      {definition.label}
                      {'optional' in definition && <span className="sr-only">(optional)</span>}
                    </FieldLabel>
                    {'multiline' in definition ? (
                      <Textarea
                        {...props}
                        rows={3}
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                    ) : (
                      <Input
                        {...props}
                        type={'optional' in definition ? 'url' : 'text'}
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                    )}
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                );
              }}
            </form.Field>
          ))}

          {send.isError && (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription>{errorMessage(send.error)}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(submitting) => (
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send notification'}
                  <SendIcon aria-hidden="true" />
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
