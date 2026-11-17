import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const httpsUrl = z
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS URL.')
  .transform((value) => value.replace(/\/+$/, ''));

const paymobConfigurationSchema = z.object({
  PAYMOB_BASE_URL: httpsUrl.default('https://accept.paymob.com'),
  PAYMOB_SECRET_KEY: z.string().min(1),
  PAYMOB_PUBLIC_KEY: z.string().min(1),
  PAYMOB_HMAC_SECRET: z.string().min(1),
  PAYMOB_INTEGRATION_IDS: z
    .string()
    .transform((value) => value.split(',').map((id) => Number(id.trim())))
    .pipe(z.array(z.number().int().positive()).min(1)),
  PAYMOB_CURRENCY: z.string().regex(/^[A-Z]{3}$/),
  PAYMOB_PRO_MONTH_AMOUNT_CENTS: z.coerce.number().int().positive(),
  PUBLIC_API_URL: httpsUrl,
  BILLING_RETURN_URL: httpsUrl,
});

export type PaymobConfiguration = z.infer<typeof paymobConfigurationSchema>;

/**
 * Paymob settings, or null when billing is off. Self-hosted servers leave `PAYMOB_SECRET_KEY`
 * unset. Setting it requires every other value, so a partial configuration fails at startup.
 */
export function paymobConfiguration(env: NodeJS.ProcessEnv): PaymobConfiguration | null {
  if (!env.PAYMOB_SECRET_KEY) return null;

  return paymobConfigurationSchema.parse(env);
}

const signedScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** The Transaction Processed callback body. Fields are kept raw because the HMAC signs them as sent. */
export const transactionCallbackSchema = z.object({
  type: z.string(),
  obj: z.object({
    amount_cents: signedScalar,
    created_at: signedScalar,
    currency: signedScalar,
    error_occured: signedScalar,
    has_parent_transaction: signedScalar,
    id: signedScalar,
    integration_id: signedScalar,
    is_3d_secure: signedScalar,
    is_auth: signedScalar,
    is_capture: signedScalar,
    is_refunded: signedScalar,
    is_standalone_payment: signedScalar,
    is_voided: signedScalar,
    order: z.object({ id: signedScalar }),
    owner: signedScalar,
    pending: signedScalar,
    source_data: z.object({
      pan: signedScalar.optional(),
      sub_type: signedScalar.optional(),
      type: signedScalar.optional(),
    }),
    success: signedScalar,
  }),
});

export type TransactionCallback = z.infer<typeof transactionCallbackSchema>;

/**
 * The string Paymob signs for a Transaction Processed callback, in Paymob's documented field order.
 * Paymob does not document how it signs a missing or null field, such as `source_data.pan` on some
 * wallet payments. An empty string is an assumption until a real callback of that kind confirms it.
 */
export function transactionHmacMessage(obj: TransactionCallback['obj']): string {
  return [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    obj.order.id,
    obj.owner,
    obj.pending,
    obj.source_data.pan,
    obj.source_data.sub_type,
    obj.source_data.type,
    obj.success,
  ]
    .map((value) => String(value ?? ''))
    .join('');
}

/** Compares the callback's `hmac` query parameter with HMAC-SHA512 over the signed fields in constant time. */
export function hasValidHmac(
  obj: TransactionCallback['obj'],
  received: unknown,
  secret: string
): boolean {
  if (typeof received !== 'string') return false;

  const expected = Buffer.from(
    createHmac('sha512', secret).update(transactionHmacMessage(obj)).digest('hex')
  );
  const actual = Buffer.from(received.toLowerCase());

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * A verified callback reduced to what billing acts on. It correlates by the signed Paymob order ID,
 * because the echoed `merchant_order_id` is outside the HMAC and could be swapped.
 */
export interface CapturedTransaction {
  transactionId: string;
  paymobOrderId: string;
  amountCents: number;
  currency: string;
}

/** Accepts only a settled sale: successful, not pending, not an authorization hold, and not voided or refunded. */
export function capturedTransaction(callback: TransactionCallback): CapturedTransaction | null {
  const { obj } = callback;

  if (
    callback.type !== 'TRANSACTION' ||
    obj.success !== true ||
    obj.pending !== false ||
    obj.is_auth !== false ||
    obj.is_voided !== false ||
    obj.is_refunded !== false
  ) {
    return null;
  }

  return {
    transactionId: String(obj.id),
    paymobOrderId: String(obj.order.id),
    amountCents: Number(obj.amount_cents),
    currency: String(obj.currency),
  };
}

const intentionResponseSchema = z.object({
  client_secret: z.string().min(1),
  intention_order_id: z.union([z.number().int(), z.string().min(1)]).transform(String),
});

/** Creates a Paymob intention. Returns its Unified Checkout URL and the Paymob order that callbacks name. */
export async function createCheckout(
  config: PaymobConfiguration,
  input: {
    paymentId: string;
    projectName: string;
    customer: { firstName: string; lastName: string; email: string; phone: string };
  }
): Promise<{ checkoutUrl: string; paymobOrderId: string }> {
  const response = await fetch(`${config.PAYMOB_BASE_URL}/v1/intention/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.PAYMOB_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: config.PAYMOB_PRO_MONTH_AMOUNT_CENTS,
      currency: config.PAYMOB_CURRENCY,
      payment_methods: config.PAYMOB_INTEGRATION_IDS,
      items: [
        {
          name: 'Pushlane Pro, 1 month',
          amount: config.PAYMOB_PRO_MONTH_AMOUNT_CENTS,
          description: input.projectName.slice(0, 255),
          quantity: 1,
        },
      ],
      billing_data: {
        first_name: input.customer.firstName,
        last_name: input.customer.lastName,
        email: input.customer.email,
        phone_number: input.customer.phone,
        apartment: 'NA',
        floor: 'NA',
        street: 'NA',
        building: 'NA',
        shipping_method: 'NA',
        postal_code: 'NA',
        city: 'NA',
        state: 'NA',
        country: 'EGY',
      },
      special_reference: input.paymentId,
      notification_url: `${config.PUBLIC_API_URL}/v1/billing/paymob/callback`,
      redirection_url: config.BILLING_RETURN_URL,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`Paymob rejected the intention with HTTP ${response.status}.`);

  const intention = intentionResponseSchema.parse(await response.json());
  const url = new URL(`${config.PAYMOB_BASE_URL}/unifiedcheckout/`);

  url.searchParams.set('publicKey', config.PAYMOB_PUBLIC_KEY);
  url.searchParams.set('clientSecret', intention.client_secret);

  return { checkoutUrl: url.href, paymobOrderId: intention.intention_order_id };
}
