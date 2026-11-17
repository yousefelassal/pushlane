import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { PLAN_LIMITS } from '../../../../libs/contracts/src/index.js';
import { Notification, Project } from '../../../../libs/database/src/entities/index.js';

import type { DataSource } from 'typeorm';
import type { DeliveryStatus } from '../../../../libs/contracts/src/index.js';

/** Expires paid plan periods and notification logs according to each plan's retention. */
@Injectable()
export class RetentionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Ends lapsed paid periods, then purges cloud logs after plan retention. Self-hosted history stays. */
  async cleanup(): Promise<void> {
    await this.expireLapsedPlans();

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

  /**
   * Returns projects whose paid Pro period ended to the free plan. A single statement, so it takes
   * the same row lock as `lockProject` and skips a project whose payment extended it first.
   */
  async expireLapsedPlans(): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update(Project)
      .set({ plan: 'free', planExpiresAt: null })
      .where("plan = 'pro'")
      .andWhere('plan_expires_at <= now()')
      .execute();
  }
}
