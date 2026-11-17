import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { endpointSchema, providerCredentialsSchema } from '../../../../libs/contracts/src/index.js';
import { SecretCipher } from '../../../../libs/database/src/cipher.js';
import {
  Delivery,
  DeliveryAttempt,
  Installation,
  InstallationSession,
  Notification,
  Project,
} from '../../../../libs/database/src/entities/index.js';

import type { DataSource } from 'typeorm';
import type {
  DeliveryStatus,
  Dispatcher,
  DispatchResult,
  NotificationInput,
} from '../../../../libs/contracts/src/index.js';

/** Injection token for the provider transport, replaceable in tests. */
export const DISPATCHER = Symbol('Dispatcher');

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const LEASE = "interval '60 seconds'";

type Outcome = DispatchResult | { kind: 'expired' | 'suppressed'; code: string };

/** Everything a dispatch needs, read in one query while the lease is still held. */
interface DispatchContext {
  payload: NotificationInput;
  expiresAt: Date;
  userId: string;
  endpointCiphertext: string;
  credentialsCiphertext: string;
  version: number;
  installationUserId: string;
  currentSessionId: string;
  revokedAt: Date | null;
  sessionRevokedAt: Date | null;
}

/** Claims expiring leases and records outcomes only while still owning them. */
@Injectable()
export class DeliveryWorker {
  private readonly logger = new Logger(DeliveryWorker.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(DISPATCHER) private readonly dispatcher: Dispatcher
  ) {}

  /** One bounded batch can run alongside other workers without shared claims. */
  async tick(): Promise<number> {
    const jobs: Delivery[] = [];

    for (let index = 0; index < BATCH_SIZE; index += 1) {
      const job = await this.claim();

      if (!job) break;

      jobs.push(job);
    }

    await Promise.all(jobs.map((job) => this.process(job)));

    return jobs.length;
  }

  /** Takes one due job, or one whose previous worker lost its lease, and records the lost attempt. */
  private async claim(): Promise<Delivery | undefined> {
    return this.dataSource.transaction(async (manager) => {
      const candidate = await manager
        .createQueryBuilder(Delivery, 'd')
        .where(
          "(d.status IN ('queued', 'retrying') AND d.nextAttemptAt <= now()) OR (d.status = 'processing' AND d.leaseExpiresAt < now())"
        )
        .orderBy('d.nextAttemptAt')
        .addOrderBy('d.id')
        .limit(1)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();

      if (!candidate) return undefined;

      if (candidate.status === 'processing') {
        await manager
          .createQueryBuilder()
          .insert()
          .into(DeliveryAttempt)
          .values({
            deliveryId: candidate.id,
            attempt: candidate.attemptCount,
            startedAt: candidate.updatedAt,
            result: 'retry',
            code: 'worker_lease_expired',
          })
          .orIgnore()
          .execute();
      }

      await manager.update(
        Delivery,
        { id: candidate.id },
        {
          status: 'processing',
          leaseToken: randomUUID(),
          leaseExpiresAt: () => `now() + ${LEASE}`,
          attemptCount: () => 'attempt_count + 1',
        }
      );

      return manager.findOneByOrFail(Delivery, { id: candidate.id });
    });
  }

  private async process(job: Delivery): Promise<void> {
    let outcome: Outcome;

    try {
      const context = await this.context(job);

      if (!context) return;

      outcome = await this.dispatch(job, context);
    } catch {
      this.logger.error({ event: 'dispatch_failed', deliveryId: job.id });

      outcome = { kind: 'retry', code: 'dispatch_unavailable' };
    }

    await this.finish(job, outcome);
  }

  private async context(job: Delivery): Promise<DispatchContext | undefined> {
    return this.dataSource
      .createQueryBuilder(Delivery, 'd')
      .innerJoin(Notification, 'n', 'n.id = d.notificationId')
      .innerJoin(Project, 'p', 'p.id = d.projectId')
      .innerJoin(Installation, 'i', 'i.projectId = d.projectId AND i.id = d.installationId')
      .innerJoin(InstallationSession, 's', 's.id = d.sessionId')
      .select('n.payload', 'payload')
      .addSelect('n.expiresAt', 'expiresAt')
      .addSelect('n.userId', 'userId')
      .addSelect('i.endpointCiphertext', 'endpointCiphertext')
      .addSelect('p.credentialsCiphertext', 'credentialsCiphertext')
      .addSelect('i.version', 'version')
      .addSelect('i.userId', 'installationUserId')
      .addSelect('i.sessionId', 'currentSessionId')
      .addSelect('i.revokedAt', 'revokedAt')
      .addSelect('s.revokedAt', 'sessionRevokedAt')
      .where("d.id = :id AND d.leaseToken = :leaseToken AND d.status = 'processing'", {
        id: job.id,
        leaseToken: job.leaseToken,
      })
      .andWhere('d.leaseExpiresAt > now()')
      .getRawOne<DispatchContext>();
  }

  /** Suppresses jobs whose binding changed since they were queued, then calls the provider. */
  private async dispatch(job: Delivery, context: DispatchContext): Promise<Outcome> {
    if (context.expiresAt.getTime() <= Date.now()) {
      return { kind: 'expired', code: 'notification_expired' };
    }

    if (
      context.revokedAt ||
      context.sessionRevokedAt ||
      context.version !== job.endpointVersion ||
      context.currentSessionId !== job.sessionId ||
      context.userId !== context.installationUserId
    ) {
      return { kind: 'suppressed', code: 'installation_binding_changed' };
    }

    if (job.attemptCount > MAX_ATTEMPTS) {
      return { kind: 'rejected', code: 'attempt_limit_exceeded', invalidateEndpoint: false };
    }

    const result = await this.dispatcher.dispatch({
      deliveryId: job.id,
      endpoint: this.cipher.decrypt(context.endpointCiphertext, job.projectId, endpointSchema),
      credentials: this.cipher.decrypt(
        context.credentialsCiphertext,
        job.projectId,
        providerCredentialsSchema
      ),
      notification: context.payload,
      expiresAt: context.expiresAt,
    });

    if (result.kind === 'rejected' && result.code === 'NOTIFICATION_EXPIRED') {
      return { kind: 'expired', code: 'notification_expired' };
    }

    return result;
  }

  /** Records the outcome only if this worker still holds the lease. */
  private async finish(job: Delivery, outcome: Outcome): Promise<void> {
    const { status, code } = settle(job.attemptCount, outcome);
    const retryAfterSeconds =
      outcome.kind === 'retry'
        ? Math.ceil(
            Math.max(1, Math.min(outcome.retryAfterSeconds ?? 2 ** job.attemptCount * 5, 2_419_200))
          )
        : 0;

    await this.dataSource.transaction(async (manager) => {
      const { affected } = await manager
        .createQueryBuilder()
        .update(Delivery)
        .set({
          status,
          lastError: code,
          providerMessageId: outcome.kind === 'accepted' ? outcome.providerMessageId : null,
          nextAttemptAt: () =>
            'LEAST(now() + make_interval(secs => :retryAfterSeconds), (SELECT n.expires_at FROM notifications n WHERE n.id = deliveries.notification_id))',
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where({ id: job.id, leaseToken: job.leaseToken, status: 'processing' })
        .setParameter('retryAfterSeconds', retryAfterSeconds)
        .execute();

      if (!affected) return;

      await manager.insert(DeliveryAttempt, {
        deliveryId: job.id,
        attempt: job.attemptCount,
        startedAt: job.updatedAt,
        result: outcome.kind,
        code,
      });

      if (outcome.kind === 'rejected' && outcome.invalidateEndpoint) {
        await manager.update(
          Installation,
          {
            projectId: job.projectId,
            id: job.installationId,
            version: job.endpointVersion,
            sessionId: job.sessionId,
          },
          { revokedAt: () => 'now()', version: () => 'version + 1' }
        );
      }
    });
  }
}

/** Maps a dispatch outcome to the delivery's next status and its recorded error code. */
function settle(
  attemptCount: number,
  outcome: Outcome
): { status: DeliveryStatus; code: string | null } {
  switch (outcome.kind) {
    case 'accepted':
      return { status: 'provider_accepted', code: null };
    case 'rejected':
      return { status: 'failed', code: outcome.code };
    case 'retry':
      return attemptCount >= MAX_ATTEMPTS
        ? { status: 'failed', code: `attempt_limit:${outcome.code}` }
        : { status: 'retrying', code: outcome.code };
    case 'expired':
    case 'suppressed':
      return { status: outcome.kind, code: outcome.code };
  }
}
