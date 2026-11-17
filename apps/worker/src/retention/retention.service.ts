import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { PLAN_LIMITS } from '../../../../libs/contracts/src/index.js';
import { Notification } from '../../../../libs/database/src/entities/index.js';

import type { DataSource } from 'typeorm';
import type { DeliveryStatus } from '../../../../libs/contracts/src/index.js';

/** Expires notification logs according to each plan's retention. */
@Injectable()
export class RetentionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Purges cloud logs after plan retention and leaves self-hosted history intact. */
  async cleanup(): Promise<void> {
    for (const [plan, { logRetentionDays }] of Object.entries(PLAN_LIMITS)) {
      if (logRetentionDays === null) continue;

      await this.dataSource
        .createQueryBuilder()
        .delete()
        .from(Notification)
        .where('project_id IN (SELECT p.id FROM projects p WHERE p.plan = :plan)', { plan })
        .andWhere('created_at < now() - make_interval(days => :days)', { days: logRetentionDays })
        .andWhere(
          'NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.notification_id = notifications.id AND d.status IN (:...active))',
          { active: ['queued', 'retrying', 'processing'] satisfies DeliveryStatus[] }
        )
        .execute();
    }
  }
}
