import { z } from 'zod';

export const identifierSchema = z.string().min(1).max(200);

/** Canonical UUID spelling keeps HTTP installation identity aligned with PostgreSQL. */
export const installationIdSchema = z
	.uuid()
	.transform((id) => id.toLowerCase());

const httpsUrlSchema = z
	.url()
	.refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS URL.');

/** A provider endpoint belongs to one authenticated app installation. */
export const endpointSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('apns'),
			token: z
				.string()
				.regex(/^[a-fA-F0-9]{64,200}$/)
				.transform((token) => token.toLowerCase()),
			sandbox: z.boolean().default(false),
		})
		.strict(),
	z
		.object({ kind: z.literal('fcm'), token: z.string().min(10).max(4096) })
		.strict(),
	z
		.object({
			kind: z.literal('webpush'),
			subscription: z
				.object({
					endpoint: httpsUrlSchema.transform((value) => new URL(value).href),
					keys: z
						.object({
							p256dh: z.string().regex(/^[\w-]{87}$/),
							auth: z.string().regex(/^[\w-]{22}$/),
						})
						.strict(),
				})
				.strict(),
		})
		.strict(),
]);

export type PushEndpoint = z.infer<typeof endpointSchema>;

/** Shared payload validated at the HTTP boundary before entering the queue. */
export const notificationSchema = z
	.object({
		userId: identifierSchema,
		title: z.string().min(1).max(200),
		body: z.string().min(1).max(2000),
		image: httpsUrlSchema.optional(),
		url: httpsUrlSchema.optional(),
		ttlSeconds: z.number().int().min(1).max(2_419_200).default(86_400),
	})
	.strict()
	.refine(
		(value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 3000,
		'Notification payload exceeds 3000 UTF-8 bytes.',
	);

export type NotificationInput = z.infer<typeof notificationSchema>;

export const registrationTokenSchema = z
	.object({ userId: identifierSchema, installationId: installationIdSchema })
	.strict();

export const providerCredentialsSchema = z
	.object({
		apns: z
			.object({
				teamId: z.string().min(1),
				keyId: z.string().min(1),
				privateKey: z.string().min(1),
				bundleId: z.string().min(1),
			})
			.strict()
			.optional(),
		fcm: z
			.object({
				projectId: z.string().min(1),
				clientEmail: z.email(),
				privateKey: z.string().min(1),
			})
			.strict()
			.optional(),
		webpush: z
			.object({
				subject: z.string().regex(/^(mailto:|https:\/\/)/),
				publicKey: z.string().min(1),
				privateKey: z.string().min(1),
			})
			.strict()
			.optional(),
	})
	.strict();

export type ProviderCredentials = z.infer<typeof providerCredentialsSchema>;

export const deliveryStatusSchema = z.enum([
	'queued',
	'processing',
	'provider_accepted',
	'retrying',
	'failed',
	'expired',
	'suppressed',
]);

export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/** Provider responses describe acceptance, never an unobserved device receipt. */
export type DispatchResult =
	| { kind: 'accepted'; providerMessageId: string }
	| { kind: 'retry'; code: string; retryAfterSeconds?: number }
	| { kind: 'rejected'; code: string; invalidateEndpoint: boolean };

/** A bounded dispatch attempt carries the remaining notification lifetime. */
export interface DispatchRequest {
	deliveryId: string;
	endpoint: PushEndpoint;
	notification: NotificationInput;
	credentials: ProviderCredentials;
	expiresAt: Date;
}

export interface Dispatcher {
	dispatch(request: DispatchRequest): Promise<DispatchResult>;
}

export interface NotificationReceipt {
	id: string;
	status: 'queued' | 'no_registered_devices';
	deliveryCount: number;
}

export const planSchema = z.enum(['free', 'pro', 'self_hosted']);

export type Plan = z.infer<typeof planSchema>;

/** Cloud allowances count target installations once, without billing retries. */
export const PLAN_LIMITS = {
	free: { monthlyDispatches: 10_000, logRetentionDays: 7 },
	pro: { monthlyDispatches: 1_000_000, logRetentionDays: 30 },
	self_hosted: { monthlyDispatches: null, logRetentionDays: null },
} satisfies Record<
	Plan,
	{ monthlyDispatches: number | null; logRetentionDays: number | null }
>;
