import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { z } from 'zod';

import { PLAN_LIMITS } from '../../../../libs/contracts/src/index.js';
import {
  Delivery,
  DeliveryAttempt,
  Installation,
  InstallationSession,
  MonthlyUsage,
  Notification,
} from '../../../../libs/database/src/entities/index.js';
import { lockProject } from '../../../../libs/database/src/locks.js';
import { currentMonth } from '../../../../libs/database/src/sql.js';
import { logEntry } from './notification-log.js';

import type { DataSource, EntityManager } from 'typeorm';
import type {
  DeliveryStatus,
  NotificationInput,
  NotificationReceipt,
} from '../../../../libs/contracts/src/index.js';
import type { Project } from '../../../../libs/database/src/entities/index.js';
import type { StatusCounts } from './notification-log.js';

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

/** Commits accepted notifications, allowance reservations, and delivery jobs together. */
@Injectable()
export class NotificationsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Queues one delivery per active installation of the user.
   *
   * Repeating a request with the same idempotency key returns the original receipt.
   */
  async send(
    project: Project,
    payload: NotificationInput,
    idempotencyKey: string
  ): Promise<NotificationReceipt> {
    const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    return this.dataSource.transaction(async (manager) => {
      await lockProject(manager, project.id);

      const existing = await manager.findOneBy(Notification, {
        projectId: project.id,
        idempotencyKey,
      });

      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException(
            'Idempotency key already belongs to a different notification.'
          );
        }

        return receipt(existing.id, existing.deliveryCount);
      }

      const installations = await manager
        .createQueryBuilder(Installation, 'i')
        .innerJoin(InstallationSession, 's', 's.id = i.sessionId')
        .where('i.projectId = :projectId AND i.userId = :userId', {
          projectId: project.id,
          userId: payload.userId,
        })
        .andWhere('i.revokedAt IS NULL AND s.revokedAt IS NULL')
        .getMany();

      await this.reserve(manager, project, installations.length);

      const id = randomUUID();

      await manager.insert(Notification, {
        id,
        projectId: project.id,
        userId: payload.userId,
        idempotencyKey,
        requestHash,
        payload,
        deliveryCount: installations.length,
        expiresAt: new Date(Date.now() + payload.ttlSeconds * 1000),
      });

      if (installations.length > 0) {
        await manager.insert(
          Delivery,
          installations.map((installation) => ({
            id: randomUUID(),
            projectId: project.id,
            notificationId: id,
            installationId: installation.id,
            sessionId: installation.sessionId,
            endpointVersion: installation.version,
            provider: installation.provider,
          }))
        );
      }

      return receipt(id, installations.length);
    });
  }

  /** Newest-first logs with a keyset cursor, so new sends never shift later pages. */
  async list(project: Project, input: { userId?: string; before?: string; limit: number }) {
    const cursor = input.before ? decodeCursor(input.before) : undefined;
    const query = this.dataSource
      .getRepository(Notification)
      .createQueryBuilder('n')
      .where('n.projectId = :projectId', { projectId: project.id });

    if (input.userId) query.andWhere('n.userId = :userId', { userId: input.userId });

    if (cursor) {
      query.andWhere('(n.createdAt, n.id) < (:createdAt, :id)', {
        createdAt: new Date(cursor.createdAt),
        id: cursor.id,
      });
    }

    const rows = await query
      .orderBy('n.createdAt', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .limit(input.limit + 1)
      .getMany();
    const page = rows.slice(0, input.limit);
    const counts = await this.statusCounts(page.map((notification) => notification.id));
    const last = page.at(-1);

    return {
      items: page.map((notification) => logEntry(notification, counts.get(notification.id) ?? {})),
      nextCursor: rows.length > input.limit && last ? encodeCursor(last) : null,
    };
  }

  /** One notification with each delivery and its recorded provider attempts. */
  async get(project: Project, id: string) {
    const notification = await this.dataSource
      .getRepository(Notification)
      .findOneBy({ projectId: project.id, id });

    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    const deliveries = await this.dataSource.getRepository(Delivery).find({
      where: { projectId: project.id, notificationId: id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const attempts = deliveries.length
      ? await this.dataSource.getRepository(DeliveryAttempt).find({
          where: { deliveryId: In(deliveries.map((delivery) => delivery.id)) },
          order: { attempt: 'ASC' },
        })
      : [];
    const counts = await this.statusCounts([id]);

    return {
      notification: logEntry(notification, counts.get(id) ?? {}),
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        installationId: delivery.installationId,
        provider: delivery.provider,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        createdAt: delivery.createdAt.toISOString(),
        updatedAt: delivery.updatedAt.toISOString(),
        lastError: delivery.lastError,
        providerMessageId: delivery.providerMessageId,
        attempts: attempts
          .filter((attempt) => attempt.deliveryId === delivery.id)
          .map((attempt) => ({
            attempt: attempt.attempt,
            startedAt: attempt.startedAt.toISOString(),
            finishedAt: attempt.finishedAt.toISOString(),
            result: attempt.result,
            code: attempt.code,
          })),
      })),
    };
  }

  /** Reserves allowance for every target installation, or rejects the send with 429. */
  private async reserve(manager: EntityManager, project: Project, count: number): Promise<void> {
    const month = currentMonth();
    const limit = PLAN_LIMITS[project.plan].monthlyDispatches;

    await manager
      .createQueryBuilder()
      .insert()
      .into(MonthlyUsage)
      .values({ projectId: project.id, month })
      .orIgnore()
      .execute();

    const update = manager
      .createQueryBuilder()
      .update(MonthlyUsage)
      .set({ reservedDispatches: () => 'reserved_dispatches + :count' })
      .where({ projectId: project.id, month })
      .setParameter('count', count);

    if (limit !== null) update.andWhere('reserved_dispatches + :count <= :limit', { limit });

    const { affected } = await update.execute();

    if (!affected) {
      throw new HttpException('Monthly dispatch allowance exceeded.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Delivery status counts for a page of notifications in one grouped query. */
  private async statusCounts(notificationIds: string[]): Promise<Map<string, StatusCounts>> {
    const counts = new Map<string, StatusCounts>();

    if (notificationIds.length === 0) return counts;

    const rows = await this.dataSource
      .getRepository(Delivery)
      .createQueryBuilder('d')
      .select('d.notificationId', 'notificationId')
      .addSelect('d.status', 'status')
      .addSelect('CAST(count(*) AS integer)', 'amount')
      .where({ notificationId: In(notificationIds) })
      .groupBy('d.notificationId')
      .addGroupBy('d.status')
      .getRawMany<{ notificationId: string; status: DeliveryStatus; amount: number }>();

    for (const row of rows) {
      counts.set(row.notificationId, {
        ...counts.get(row.notificationId),
        [row.status]: row.amount,
      });
    }

    return counts;
  }
}

function receipt(id: string, deliveryCount: number): NotificationReceipt {
  return {
    id,
    status: deliveryCount > 0 ? 'queued' : 'no_registered_devices',
    deliveryCount,
  };
}

function encodeCursor(notification: Notification): string {
  return Buffer.from(
    JSON.stringify({ createdAt: notification.createdAt.toISOString(), id: notification.id })
  ).toString('base64url');
}

function decodeCursor(value: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new BadRequestException('Invalid pagination cursor.');
  }
}
