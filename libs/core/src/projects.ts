import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import {
	PLAN_LIMITS,
	planSchema,
	providerCredentialsSchema,
	type ProviderCredentials,
	type Plan,
} from '../../contracts/src/index.js';
import { Database } from '../../database/src/database.js';
import { SecretCipher } from '../../database/src/cipher.js';

export const projectSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	environment: z.enum(['development', 'production']),
	plan: planSchema,
	credentials_ciphertext: z.string(),
});

export type Project = z.infer<typeof projectSchema>;

/** Hashes high-entropy bearer secrets without storing their plaintext. */
export function hashSecret(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

/** Provisions isolated project environments and authenticates backend keys. */
@Injectable()
export class Projects {
	constructor(
		@Inject(Database) private readonly db: Database,
		@Inject(SecretCipher) private readonly cipher: SecretCipher,
	) {}

	async create(input: {
		name: string;
		environment: 'development' | 'production';
		plan: Plan;
		credentials: ProviderCredentials;
	}) {
		const id = randomUUID();
		const apiKey = `pl_${input.environment === 'production' ? 'live' : 'test'}_${randomBytes(32).toString('base64url')}`;

		await this.db.execute(
			'INSERT INTO projects (id, name, environment, plan, api_key_hash, credentials_ciphertext) VALUES ($1, $2, $3, $4, $5, $6)',
			[
				id,
				input.name,
				input.environment,
				input.plan,
				hashSecret(apiKey),
				this.cipher.encrypt(input.credentials, id),
			],
		);

		return {
			projectId: id,
			apiKey,
			environment: input.environment,
			plan: input.plan,
		};
	}

	async authenticate(apiKey: string): Promise<Project> {
		const [project] = await this.db.rows(
			projectSchema,
			'SELECT id, name, environment, plan, credentials_ciphertext FROM projects WHERE api_key_hash = $1',
			[hashSecret(apiKey)],
		);

		if (!project) {
			throw new UnauthorizedException('Invalid backend API key.');
		}

		return project;
	}

	credentials(project: Project): ProviderCredentials {
		return this.cipher.decrypt(
			project.credentials_ciphertext,
			project.id,
			providerCredentialsSchema,
		);
	}

	async describe(project: Project) {
		const [usage] = await this.db.rows(
			z.object({ month: z.string(), reserved_dispatches: z.number() }),
			"SELECT to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM') AS month, coalesce((SELECT reserved_dispatches FROM monthly_usage WHERE project_id = $1 AND month = date_trunc('month', now() AT TIME ZONE 'UTC')::date), 0) AS reserved_dispatches",
			[project.id],
		);
		const credentials = this.credentials(project);
		const { monthlyDispatches: limit, logRetentionDays } =
			PLAN_LIMITS[project.plan];
		const reservedDispatches = usage?.reserved_dispatches ?? 0;

		return {
			id: project.id,
			name: project.name,
			environment: project.environment,
			plan: project.plan,
			providers: Object.keys(credentials),
			webPushPublicKey: credentials.webpush?.publicKey ?? null,
			usage: {
				month: usage?.month ?? '',
				reservedDispatches,
				limit,
				remaining:
					limit === null ? null : Math.max(0, limit - reservedDispatches),
			},
			logRetentionDays,
		};
	}
}
