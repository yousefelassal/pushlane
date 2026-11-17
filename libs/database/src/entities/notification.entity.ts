import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';

import { Project } from './project.entity.js';

import type { NotificationInput } from '../../../contracts/src/index.js';

/** An accepted send request. Its deliveries fan out to every active installation of the user. */
@Entity('notifications')
@Check('"delivery_count" >= 0')
@Unique('notifications_idempotency', ['projectId', 'idempotencyKey'])
@Unique('notifications_project_id_id', ['projectId', 'id'])
@Index('notifications_logs', ['projectId', 'createdAt', 'id'])
@Index('notifications_user_logs', ['projectId', 'userId', 'createdAt', 'id'])
export class Notification {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  @ForeignKey(() => Project)
  projectId!: string;

  @Column('text')
  userId!: string;

  @Column('text')
  idempotencyKey!: string;

  @Column('text')
  requestHash!: string;

  @Column('jsonb')
  payload!: NotificationInput;

  @Column('integer')
  deliveryCount!: number;

  @Column({ type: 'timestamptz', precision: 3 })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
