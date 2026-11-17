import { Check, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import { environmentSchema, planSchema } from '../../../contracts/src/index.js';
import { oneOf } from '../sql.js';

import type { Environment, Plan } from '../../../contracts/src/index.js';

/** One isolated project environment. Its backend key and provider credentials are never stored in plaintext. */
@Entity('projects')
@Check('length("name") BETWEEN 1 AND 200')
@Check(oneOf('environment', environmentSchema.options))
@Check(oneOf('plan', planSchema.options))
@Check(`"plan_expires_at" IS NULL OR "plan" = 'pro'`)
export class Project {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  name!: string;

  @Column('text')
  environment!: Environment;

  @Column('text')
  plan!: Plan;

  /** End of the paid Pro period. Null means the plan does not lapse. The worker downgrades lapsed projects to free. */
  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  planExpiresAt!: Date | null;

  @Column('text', { unique: true, select: false })
  apiKeyHash!: string;

  @Column('text')
  credentialsCiphertext!: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
