import { createHash, randomUUID } from 'node:crypto';
import {
	ConflictException,
	HttpException,
	Inject,
	Injectable,
	NotFoundException,
	BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import {
	PLAN_LIMITS,
	notificationSchema,
	type NotificationInput,
	type NotificationReceipt,
} from '../../contracts/src/index.js';
import { Database } from '../../database/src/database.js';
import type { Project } from './projects.js';

const dateSchema = z.date().transform((value) => value.toISOString());
const notificationRowSchema = z.object({
	id: z.uuid(),
	user_id: z.string(),
	payload: notificationSchema,
	delivery_count: z.number(),
	created_at: dateSchema,
	counts: z.record(z.string(), z.number()),
});
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

type NotificationRow = z.infer<typeof notificationRowSchema>;

/** Derives a truthful summary without treating provider acceptance as receipt. */
function logEntry(row: NotificationRow) {
	const count = (status: string) => row.counts[status] ?? 0;
	let status = 'partial';

	if (row.delivery_count === 0) status = 'no_registered_devices';
	else if (count('queued') === row.delivery_count) status = 'queued';
	else if (count('processing') + count('retrying') + count('queued') > 0)
		status = 'processing';
	else if (count('provider_accepted') === row.delivery_count)
		status = 'provider_accepted';
	else if (count('failed') === row.delivery_count) status = 'failed';
	else if (count('expired') === row.delivery_count) status = 'expired';
	else if (count('suppressed') === row.delivery_count) status = 'suppressed';

	return {
		id: row.id,
		...row.payload,
		createdAt: row.created_at,
		status,
		deliveryCount: row.delivery_count,
		counts: row.counts,
	};
}

const logSelect = `SELECT n.id, n.user_id, n.payload, n.delivery_count, n.created_at,
  coalesce((SELECT jsonb_object_agg(status, amount) FROM
    (SELECT d.status, count(*)::int AS amount FROM deliveries d WHERE d.notification_id = n.id GROUP BY d.status) grouped), '{}'::jsonb) AS counts
  FROM notifications n`;

/** Commits accepted notifications, quota reservations, and jobs together. */
@Injectable()
export class Notifications {
	constructor(@Inject(Database) private readonly db: Database) {}

	async send(
		project: Project,
		payload: NotificationInput,
		idempotencyKey: string,
	): Promise<NotificationReceipt> {
		const requestHash = createHash('sha256')
			.update(JSON.stringify(payload))
			.digest('hex');

		return this.db.transaction(async (tx) => {
			await tx.execute('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [
				project.id,
			]);

			const [existing] = await tx.rows(
				z.object({
					id: z.uuid(),
					request_hash: z.string(),
					delivery_count: z.number(),
				}),
				'SELECT id, request_hash, delivery_count FROM notifications WHERE project_id = $1 AND idempotency_key = $2',
				[project.id, idempotencyKey],
			);

			if (existing) {
				if (existing.request_hash !== requestHash) {
					throw new ConflictException(
						'Idempotency key already belongs to a different notification.',
					);
				}

				return {
					id: existing.id,
					status:
						existing.delivery_count > 0 ? 'queued' : 'no_registered_devices',
					deliveryCount: existing.delivery_count,
				};
			}

			const installations = await tx.rows(
				z.object({
					id: z.uuid(),
					session_id: z.uuid(),
					version: z.number(),
					provider: z.string(),
				}),
				`SELECT i.id, i.session_id, i.version, i.provider FROM installations i JOIN installation_sessions s ON s.id = i.session_id WHERE i.project_id = $1 AND i.user_id = $2 AND i.revoked_at IS NULL AND s.revoked_at IS NULL`,
				[project.id, payload.userId],
			);

			await tx.execute(
				"INSERT INTO monthly_usage (project_id, month) VALUES ($1, date_trunc('month', now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING",
				[project.id],
			);

			const limit = PLAN_LIMITS[project.plan].monthlyDispatches;
			const reserved = await tx.execute(
				"UPDATE monthly_usage SET reserved_dispatches = reserved_dispatches + $2 WHERE project_id = $1 AND month = date_trunc('month', now() AT TIME ZONE 'UTC')::date AND ($3::integer IS NULL OR reserved_dispatches + $2 <= $3)",
				[project.id, installations.length, limit],
			);

			if (reserved === 0) {
				throw new HttpException('Monthly dispatch allowance exceeded.', 429);
			}

			const id = randomUUID();
			const expiresAt = new Date(Date.now() + payload.ttlSeconds * 1000);

			await tx.execute(
				'INSERT INTO notifications (id, project_id, user_id, idempotency_key, request_hash, payload, delivery_count, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
				[
					id,
					project.id,
					payload.userId,
					idempotencyKey,
					requestHash,
					JSON.stringify(payload),
					installations.length,
					expiresAt,
				],
			);

			for (const installation of installations) {
				await tx.execute(
					'INSERT INTO deliveries (id, project_id, notification_id, installation_id, session_id, endpoint_version, provider) VALUES ($1, $2, $3, $4, $5, $6, $7)',
					[
						randomUUID(),
						project.id,
						id,
						installation.id,
						installation.session_id,
						installation.version,
						installation.provider,
					],
				);
			}

			return {
				id,
				status: installations.length > 0 ? 'queued' : 'no_registered_devices',
				deliveryCount: installations.length,
			};
		});
	}

	async list(
		project: Project,
		input: { userId?: string; before?: string; limit: number },
	) {
		let cursor: z.infer<typeof cursorSchema> | undefined;

		if (input.before) {
			try {
				cursor = cursorSchema.parse(
					JSON.parse(Buffer.from(input.before, 'base64url').toString('utf8')),
				);
			} catch {
				throw new BadRequestException('Invalid pagination cursor.');
			}
		}

		const rows = await this.db.rows(
			notificationRowSchema,
			`${logSelect} WHERE n.project_id = $1 AND ($2::text IS NULL OR n.user_id = $2) AND ($3::timestamptz IS NULL OR (n.created_at, n.id) < ($3::timestamptz, $4::uuid)) ORDER BY n.created_at DESC, n.id DESC LIMIT $5`,
			[
				project.id,
				input.userId ?? null,
				cursor?.createdAt ?? null,
				cursor?.id ?? null,
				input.limit + 1,
			],
		);
		const page = rows.slice(0, input.limit);
		const last = page.at(-1);
		const nextCursor =
			rows.length > input.limit && last
				? Buffer.from(
						JSON.stringify({ createdAt: last.created_at, id: last.id }),
					).toString('base64url')
				: null;

		return { items: page.map(logEntry), nextCursor };
	}

	async get(project: Project, id: string) {
		const [notification] = await this.db.rows(
			notificationRowSchema,
			`${logSelect} WHERE n.project_id = $1 AND n.id = $2`,
			[project.id, id],
		);

		if (!notification) {
			throw new NotFoundException('Notification not found.');
		}

		const rows = await this.db.rows(
			z.object({
				id: z.uuid(),
				installation_id: z.uuid(),
				provider: z.string(),
				status: z.string(),
				attempt_count: z.number(),
				created_at: dateSchema,
				updated_at: dateSchema,
				last_error: z.string().nullable(),
				provider_message_id: z.string().nullable(),
			}),
			'SELECT id, installation_id, provider, status, attempt_count, created_at, updated_at, last_error, provider_message_id FROM deliveries WHERE project_id = $1 AND notification_id = $2 ORDER BY created_at, id',
			[project.id, id],
		);
		const attempts = await this.db.rows(
			z.object({
				delivery_id: z.uuid(),
				attempt: z.number(),
				started_at: dateSchema,
				finished_at: dateSchema,
				result: z.string(),
				code: z.string().nullable(),
			}),
			'SELECT a.* FROM delivery_attempts a JOIN deliveries d ON d.id = a.delivery_id WHERE d.project_id = $1 AND d.notification_id = $2 ORDER BY a.attempt',
			[project.id, id],
		);

		return {
			notification: logEntry(notification),
			deliveries: rows.map((row) => ({
				id: row.id,
				installationId: row.installation_id,
				provider: row.provider,
				status: row.status,
				attemptCount: row.attempt_count,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
				lastError: row.last_error,
				providerMessageId: row.provider_message_id,
				attempts: attempts
					.filter((attempt) => attempt.delivery_id === row.id)
					.map((attempt) => ({
						attempt: attempt.attempt,
						startedAt: attempt.started_at,
						finishedAt: attempt.finished_at,
						result: attempt.result,
						code: attempt.code,
					})),
			})),
		};
	}
}
