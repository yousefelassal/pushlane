import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { deliveryStatusSchema, providerKinds } from '../../../contracts/src/index.js';
import { oneOf } from '../sql.js';
import { InstallationSession } from './installation-session.entity.js';
import { Installation } from './installation.entity.js';
import { Notification } from './notification.entity.js';

import type { DeliveryStatus, ProviderKind } from '../../../contracts/src/index.js';

/**
 * One durable queue job: a notification bound to one installation version.
 *
 * A worker owns the job only while `leaseToken` matches and `leaseExpiresAt` is in the future.
 */
@Entity('deliveries')
@Check(oneOf('provider', providerKinds))
@Check(oneOf('status', deliveryStatusSchema.options))
@ForeignKey(() => Notification, ['projectId', 'notificationId'], ['projectId', 'id'], {
  onDelete: 'CASCADE',
})
@ForeignKey(() => Installation, ['projectId', 'installationId'], ['projectId', 'id'])
@ForeignKey(() => InstallationSession, ['projectId', 'sessionId'], ['projectId', 'id'])
@Unique('deliveries_notification_installation', ['notificationId', 'installationId'])
@Index('deliveries_pending', ['nextAttemptAt'], {
  where: `"status" IN ('queued', 'retrying')`,
})
@Index('deliveries_leases', ['leaseExpiresAt'], { where: `"status" = 'processing'` })
@Index('deliveries_notification', ['projectId', 'notificationId'])
export class Delivery {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  projectId!: string;

  @Column('uuid')
  notificationId!: string;

  @Column('uuid')
  installationId!: string;

  @Column('uuid')
  sessionId!: string;

  @Column('integer')
  endpointVersion!: number;

  @Column('text')
  provider!: ProviderKind;

  @Column('text', { default: 'queued' })
  status!: DeliveryStatus;

  @Column('integer', { default: 0 })
  attemptCount!: number;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'now()' })
  nextAttemptAt!: Date;

  @Column('uuid', { nullable: true })
  leaseToken!: string | null;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  leaseExpiresAt!: Date | null;

  @Column('text', { nullable: true })
  providerMessageId!: string | null;

  @Column('text', { nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
