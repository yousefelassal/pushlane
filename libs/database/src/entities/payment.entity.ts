import { Check, Column, CreateDateColumn, Entity, ForeignKey, PrimaryColumn } from 'typeorm';

import { Project } from './project.entity.js';

/**
 * One checkout for one month of Pro. Its ID is the Paymob `special_reference`. Callbacks find it by
 * the Paymob order the intention created.
 *
 * A payment moves from `pending` to `paid` once, when a signed Paymob callback reports a captured
 * transaction for its exact amount and currency. Failed and abandoned attempts leave it pending.
 */
@Entity('payments')
@Check(`"status" IN ('pending', 'paid')`)
@Check(`("status" = 'paid') = ("transaction_id" IS NOT NULL AND "paid_at" IS NOT NULL)`)
@Check('"amount_cents" > 0')
export class Payment {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  @ForeignKey(() => Project)
  projectId!: string;

  @Column('text')
  status!: 'pending' | 'paid';

  @Column('integer')
  amountCents!: number;

  @Column('text')
  currency!: string;

  @Column('text', { unique: true })
  paymobOrderId!: string;

  /** Paymob's transaction ID. Unique so one transaction can never pay twice. */
  @Column('text', { nullable: true, unique: true })
  transactionId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  paidAt!: Date | null;
}
