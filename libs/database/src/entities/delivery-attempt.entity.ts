import { Check, Column, CreateDateColumn, Entity, ForeignKey, PrimaryColumn } from 'typeorm';

import { attemptResultSchema } from '../../../contracts/src/index.js';
import { oneOf } from '../sql.js';
import { Delivery } from './delivery.entity.js';

import type { AttemptResult } from '../../../contracts/src/index.js';

/** The recorded outcome of one provider dispatch attempt, shown in the dashboard logs. */
@Entity('delivery_attempts')
@Check(oneOf('result', attemptResultSchema.options))
export class DeliveryAttempt {
  @PrimaryColumn('uuid')
  @ForeignKey(() => Delivery, { onDelete: 'CASCADE' })
  deliveryId!: string;

  @PrimaryColumn('integer')
  attempt!: number;

  @Column({ type: 'timestamptz', precision: 3 })
  startedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  finishedAt!: Date;

  @Column('text')
  result!: AttemptResult;

  @Column('text', { nullable: true })
  code!: string | null;
}
