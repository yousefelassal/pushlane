import { z } from 'zod';
import { HttpClient, type ConnectionOptions } from './http.js';

export { PushlaneError } from './http.js';

/** Content sent to every active installation belonging to the user. */
export interface NotificationInput {
	userId: string;
	title: string;
	body: string;
	image?: string;
	url?: string;
	ttlSeconds?: number;
}

const receiptSchema = z.object({
	id: z.string(),
	status: z.enum(['queued', 'no_registered_devices']),
	deliveryCount: z.number().int().nonnegative(),
});

const registrationSchema = z.object({
	token: z.string().min(1),
	expiresAt: z.iso.datetime(),
});

const notificationLogSchema = z.object({
	id: z.string(),
	userId: z.string(),
	title: z.string(),
	body: z.string(),
	image: z.string().optional(),
	url: z.string().optional(),
	createdAt: z.iso.datetime(),
	status: z.string(),
	deliveryCount: z.number().int().nonnegative(),
	counts: z.record(z.string(), z.number().int().nonnegative()),
});

const deliverySchema = z.object({
	id: z.string(),
	installationId: z.string(),
	provider: z.enum(['apns', 'fcm', 'webpush']),
	status: z.string(),
	attemptCount: z.number().int().nonnegative(),
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
	lastError: z.string().nullable(),
	providerMessageId: z.string().nullable(),
	attempts: z.array(
		z.object({
			attempt: z.number().int(),
			startedAt: z.iso.datetime(),
			finishedAt: z.iso.datetime(),
			result: z.string(),
			code: z.string().nullable(),
		}),
	),
});

export type NotificationReceipt = z.infer<typeof receiptSchema>;
export type NotificationLog = z.infer<typeof notificationLogSchema>;
export type RegistrationToken = z.infer<typeof registrationSchema>;
export type NotificationDetails = {
	notification: NotificationLog;
	deliveries: Array<z.infer<typeof deliverySchema>>;
};

/** Backend client. Never ship its secret API key to a browser or mobile app. */
export class Pushlane {
	private readonly http: HttpClient;
	private readonly apiKey: string;

	constructor(options: ConnectionOptions & { apiKey: string }) {
		this.http = new HttpClient(options);
		this.apiKey = options.apiKey;
	}

	/** Issues an installation-scoped session after your backend authenticates the user. */
	createRegistrationToken(input: {
		userId: string;
		installationId: string;
	}): Promise<RegistrationToken> {
		return this.http.request({
			path: '/v1/registration-tokens',
			method: 'POST',
			token: this.apiKey,
			body: input,
			schema: registrationSchema,
		});
	}

	/** Durably accepts one notification. Reuse the same key only for the same logical send. */
	send(
		input: NotificationInput,
		options: { idempotencyKey: string },
	): Promise<NotificationReceipt> {
		return this.http.request({
			path: '/v1/notifications',
			method: 'POST',
			token: this.apiKey,
			body: input,
			idempotencyKey: options.idempotencyKey,
			schema: receiptSchema,
		});
	}

	/** Returns project-scoped logs with an opaque cursor for the next page. */
	listNotifications(
		options: { userId?: string; limit?: number; before?: string } = {},
	): Promise<{ items: NotificationLog[]; nextCursor: string | null }> {
		const query = new URLSearchParams();

		if (options.userId !== undefined) query.set('userId', options.userId);
		if (options.limit !== undefined) query.set('limit', String(options.limit));
		if (options.before !== undefined) query.set('before', options.before);

		return this.http.request({
			path: `/v1/notifications?${query}`,
			method: 'GET',
			token: this.apiKey,
			schema: z.object({
				items: z.array(notificationLogSchema),
				nextCursor: z.string().nullable(),
			}),
		});
	}

	/** Returns the notification and provider attempts without exposing device tokens. */
	getNotification(id: string): Promise<NotificationDetails> {
		return this.http.request({
			path: `/v1/notifications/${encodeURIComponent(id)}`,
			method: 'GET',
			token: this.apiKey,
			schema: z.object({
				notification: notificationLogSchema,
				deliveries: z.array(deliverySchema),
			}),
		});
	}
}
