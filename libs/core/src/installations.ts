import { randomBytes, randomUUID } from 'node:crypto';
import {
	Inject,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import type { PushEndpoint } from '../../contracts/src/index.js';
import { Database } from '../../database/src/database.js';
import { SecretCipher } from '../../database/src/cipher.js';
import { hashSecret, type Project } from './projects.js';

const sessionSchema = z.object({
	id: z.uuid(),
	project_id: z.uuid(),
	installation_id: z.uuid(),
	user_id: z.string(),
});

/** Owns installation identity bindings, endpoint refresh, and revocation. */
@Injectable()
export class Installations {
	constructor(
		@Inject(Database) private readonly db: Database,
		@Inject(SecretCipher) private readonly cipher: SecretCipher,
	) {}

	/** The caller must authenticate its own user before issuing this token. */
	async issueToken(
		project: Project,
		input: { userId: string; installationId: string },
	) {
		const token = `pl_reg_${randomBytes(32).toString('base64url')}`;
		const expiresAt = new Date(Date.now() + 3_600_000);

		await this.db.transaction(async (tx) => {
			await tx.execute('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [
				project.id,
			]);
			await tx.execute(
				'UPDATE installation_sessions SET revoked_at = now() WHERE project_id = $1 AND installation_id = $2 AND revoked_at IS NULL',
				[project.id, input.installationId],
			);
			await tx.execute(
				'UPDATE installations SET revoked_at = now(), version = version + 1, updated_at = now() WHERE project_id = $1 AND id = $2',
				[project.id, input.installationId],
			);
			await tx.execute(
				'INSERT INTO installation_sessions (id, project_id, installation_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
				[
					randomUUID(),
					project.id,
					input.installationId,
					input.userId,
					hashSecret(token),
					expiresAt,
				],
			);
		});

		return { token, expiresAt: expiresAt.toISOString() };
	}

	async register(
		token: string,
		installationId: string,
		endpoint: PushEndpoint,
	) {
		return this.db.transaction(async (tx) => {
			const [candidate] = await tx.rows(
				sessionSchema,
				'SELECT id, project_id, installation_id, user_id FROM installation_sessions WHERE token_hash = $1',
				[hashSecret(token)],
			);

			if (!candidate || candidate.installation_id !== installationId) {
				throw new UnauthorizedException('Invalid registration token.');
			}

			await tx.execute('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [
				candidate.project_id,
			]);

			const [session] = await tx.rows(
				sessionSchema,
				'SELECT id, project_id, installation_id, user_id FROM installation_sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE',
				[candidate.id],
			);

			if (!session) {
				throw new UnauthorizedException(
					'Registration token expired or revoked.',
				);
			}

			const identity =
				endpoint.kind === 'webpush'
					? endpoint.subscription.endpoint
					: endpoint.token;
			const endpointHash = hashSecret(`${endpoint.kind}:${identity}`);
			const endpointFingerprint = hashSecret(JSON.stringify(endpoint));
			const encrypted = this.cipher.encrypt(endpoint, session.project_id);

			await tx.execute(
				'UPDATE installation_sessions SET revoked_at = now() WHERE project_id = $1 AND id IN (SELECT session_id FROM installations WHERE project_id = $1 AND endpoint_hash = $2 AND id <> $3 AND revoked_at IS NULL)',
				[session.project_id, endpointHash, installationId],
			);
			await tx.execute(
				'UPDATE installations SET revoked_at = now(), version = version + 1, updated_at = now() WHERE project_id = $1 AND endpoint_hash = $2 AND id <> $3 AND revoked_at IS NULL',
				[session.project_id, endpointHash, installationId],
			);
			await tx.execute(
				`INSERT INTO installations (project_id, id, user_id, session_id, provider, endpoint_hash, endpoint_ciphertext, endpoint_fingerprint)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT (project_id, id) DO UPDATE SET user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id,
				provider = EXCLUDED.provider, endpoint_hash = EXCLUDED.endpoint_hash, endpoint_ciphertext = EXCLUDED.endpoint_ciphertext,
				endpoint_fingerprint = EXCLUDED.endpoint_fingerprint,
				version = CASE WHEN installations.endpoint_fingerprint = EXCLUDED.endpoint_fingerprint AND installations.session_id = EXCLUDED.session_id AND installations.revoked_at IS NULL THEN installations.version ELSE installations.version + 1 END,
				revoked_at = NULL, updated_at = now()`,
				[
					session.project_id,
					installationId,
					session.user_id,
					session.id,
					endpoint.kind,
					endpointHash,
					encrypted,
					endpointFingerprint,
				],
			);

			return {
				id: installationId,
				userId: session.user_id,
				provider: endpoint.kind,
			};
		});
	}

	/** Revocation is durable and repeated logout requests remain successful. */
	async revoke(token: string, installationId: string): Promise<void> {
		await this.db.transaction(async (tx) => {
			const [session] = await tx.rows(
				sessionSchema,
				'SELECT id, project_id, installation_id, user_id FROM installation_sessions WHERE token_hash = $1',
				[hashSecret(token)],
			);

			if (!session) {
				throw new UnauthorizedException('Invalid registration token.');
			}

			if (session.installation_id !== installationId) {
				throw new NotFoundException('Installation not found.');
			}

			await tx.execute('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [
				session.project_id,
			]);
			await tx.execute(
				'UPDATE installation_sessions SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1',
				[session.id],
			);
			await tx.execute(
				'UPDATE installations SET revoked_at = now(), version = version + 1, updated_at = now() WHERE project_id = $1 AND id = $2 AND session_id = $3 AND revoked_at IS NULL',
				[session.project_id, installationId, session.id],
			);
		});
	}
}
