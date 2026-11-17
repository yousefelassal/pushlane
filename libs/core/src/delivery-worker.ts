import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import {
  endpointSchema,
  notificationSchema,
  providerCredentialsSchema,
} from '../../contracts/src/index.js';
import { SecretCipher } from '../../database/src/cipher.js';
import { Database } from '../../database/src/database.js';
import { ProviderDispatcher } from '../../providers/src/index.js';

import type { DispatchResult } from '../../contracts/src/index.js';

const jobSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  notification_id: z.uuid(),
  installation_id: z.uuid(),
  session_id: z.uuid(),
  endpoint_version: z.number(),
  attempt_count: z.number(),
  lease_token: z.uuid(),
  updated_at: z.date(),
});

type Job = z.infer<typeof jobSchema>;
type Outcome = DispatchResult | { kind: 'expired' | 'suppressed'; code: string };

const dispatchContextSchema = z.object({
  payload: notificationSchema,
  expires_at: z.date(),
  user_id: z.string(),
  endpoint_ciphertext: z.string(),
  credentials_ciphertext: z.string(),
  version: z.number(),
  installation_user_id: z.string(),
  current_session_id: z.uuid(),
  revoked_at: z.date().nullable(),
  session_revoked_at: z.date().nullable(),
});

/** Claims expiring leases and records outcomes only while still owning them. */
@Injectable()
export class DeliveryWorker {
  private readonly logger = new Logger(DeliveryWorker.name);

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(ProviderDispatcher) private readonly dispatcher: ProviderDispatcher
  ) {}

  /** One bounded batch can run alongside other workers without shared claims. */
  async tick(): Promise<number> {
    const jobs: Job[] = [];

    for (let index = 0; index < 10; index += 1) {
      const job = await this.claim();

      if (!job) break;

      jobs.push(job);
    }

    await Promise.all(jobs.map((job) => this.process(job)));

    return jobs.length;
  }

  /** Purges cloud logs after retention and leaves self-hosted history intact. */
  async cleanup(): Promise<void> {
    await this.db.execute(`DELETE FROM notifications n USING projects p WHERE n.project_id = p.id
			AND ((p.plan = 'free' AND n.created_at < now() - interval '7 days') OR (p.plan = 'pro' AND n.created_at < now() - interval '30 days'))
			AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.notification_id = n.id AND d.status IN ('queued', 'retrying', 'processing'))`);
  }

  private async claim(): Promise<Job | undefined> {
    return this.db.transaction(async (tx) => {
      const [candidate] = await tx.rows(
        z.object({
          id: z.uuid(),
          status: z.string(),
          attempt_count: z.number(),
          updated_at: z.date(),
        }),
        `SELECT id, status, attempt_count, updated_at FROM deliveries
				WHERE (status IN ('queued', 'retrying') AND next_attempt_at <= now()) OR (status = 'processing' AND lease_expires_at < now())
				ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT 1`
      );

      if (!candidate) return undefined;

      if (candidate.status === 'processing') {
        await tx.execute(
          "INSERT INTO delivery_attempts (delivery_id, attempt, started_at, result, code) VALUES ($1, $2, $3, 'retry', 'worker_lease_expired') ON CONFLICT DO NOTHING",
          [candidate.id, candidate.attempt_count, candidate.updated_at]
        );
      }

      const [job] = await tx.rows(
        jobSchema,
        `UPDATE deliveries SET status = 'processing', lease_token = $2, lease_expires_at = now() + interval '60 seconds', attempt_count = attempt_count + 1, updated_at = now() WHERE id = $1 RETURNING *`,
        [candidate.id, randomUUID()]
      );

      return job;
    });
  }

  private async process(job: Job): Promise<void> {
    let outcome: Outcome;

    try {
      const [context] = await this.db.rows(
        dispatchContextSchema,
        `SELECT n.payload, n.expires_at, n.user_id, i.endpoint_ciphertext, p.credentials_ciphertext, i.version, i.user_id AS installation_user_id, i.session_id AS current_session_id, i.revoked_at, s.revoked_at AS session_revoked_at
				FROM deliveries d JOIN notifications n ON n.id = d.notification_id JOIN projects p ON p.id = d.project_id
				JOIN installations i ON i.project_id = d.project_id AND i.id = d.installation_id JOIN installation_sessions s ON s.id = d.session_id
				WHERE d.id = $1 AND d.lease_token = $2 AND d.status = 'processing' AND d.lease_expires_at > now()`,
        [job.id, job.lease_token]
      );

      if (!context) return;

      if (context.expires_at.getTime() <= Date.now()) {
        outcome = { kind: 'expired', code: 'notification_expired' };
      } else if (
        context.revoked_at ||
        context.session_revoked_at ||
        context.version !== job.endpoint_version ||
        context.current_session_id !== job.session_id ||
        context.user_id !== context.installation_user_id
      ) {
        outcome = { kind: 'suppressed', code: 'installation_binding_changed' };
      } else if (job.attempt_count > 5) {
        outcome = {
          kind: 'rejected',
          code: 'attempt_limit_exceeded',
          invalidateEndpoint: false,
        };
      } else {
        const endpoint = this.cipher.decrypt(
          context.endpoint_ciphertext,
          job.project_id,
          endpointSchema
        );
        const credentials = this.cipher.decrypt(
          context.credentials_ciphertext,
          job.project_id,
          providerCredentialsSchema
        );

        outcome = await this.dispatcher.dispatch({
          deliveryId: job.id,
          endpoint,
          credentials,
          notification: context.payload,
          expiresAt: context.expires_at,
        });

        if (outcome.kind === 'rejected' && outcome.code === 'NOTIFICATION_EXPIRED') {
          outcome = { kind: 'expired', code: 'notification_expired' };
        }
      }
    } catch {
      this.logger.error({ event: 'dispatch_failed', deliveryId: job.id });

      outcome = { kind: 'retry', code: 'dispatch_unavailable' };
    }

    await this.finish(job, outcome);
  }

  private async finish(job: Job, outcome: Outcome): Promise<void> {
    let status: string = outcome.kind;
    let code: string | null = 'code' in outcome ? outcome.code : null;
    const providerMessageId = outcome.kind === 'accepted' ? outcome.providerMessageId : null;
    const retryAfter =
      outcome.kind === 'retry'
        ? Math.ceil(
            Math.max(
              1,
              Math.min(outcome.retryAfterSeconds ?? 2 ** job.attempt_count * 5, 2_419_200)
            )
          )
        : 0;

    if (outcome.kind === 'accepted') status = 'provider_accepted';
    if (outcome.kind === 'rejected') status = 'failed';

    if (outcome.kind === 'retry') {
      status = job.attempt_count >= 5 ? 'failed' : 'retrying';

      if (status === 'failed') code = `attempt_limit:${outcome.code}`;
    }

    await this.db.transaction(async (tx) => {
      const updated = await tx.execute(
        `UPDATE deliveries SET status = $3, last_error = $4, provider_message_id = $5,
				next_attempt_at = LEAST(now() + $6::integer * interval '1 second', (SELECT expires_at FROM notifications WHERE id = deliveries.notification_id)), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
				WHERE id = $1 AND lease_token = $2 AND status = 'processing'`,
        [job.id, job.lease_token, status, code, providerMessageId, retryAfter]
      );

      if (updated === 0) return;

      await tx.execute(
        'INSERT INTO delivery_attempts (delivery_id, attempt, started_at, result, code) VALUES ($1, $2, $3, $4, $5)',
        [job.id, job.attempt_count, job.updated_at, outcome.kind, code]
      );

      if (outcome.kind === 'rejected' && outcome.invalidateEndpoint) {
        await tx.execute(
          'UPDATE installations SET revoked_at = now(), version = version + 1, updated_at = now() WHERE project_id = $1 AND id = $2 AND version = $3 AND session_id = $4',
          [job.project_id, job.installation_id, job.endpoint_version, job.session_id]
        );
      }
    });
  }
}
