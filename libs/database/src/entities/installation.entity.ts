import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { providerKinds } from '../../../contracts/src/index.js';
import { oneOf } from '../sql.js';
import { InstallationSession } from './installation-session.entity.js';
import { Project } from './project.entity.js';

import type { ProviderKind } from '../../../contracts/src/index.js';

/**
 * The current endpoint binding for one app installation.
 *
 * `version` increases whenever the binding changes, so queued deliveries for an older binding are
 * suppressed instead of reaching a new user or endpoint.
 */
@Entity('installations')
@Check(oneOf('provider', providerKinds))
@ForeignKey(() => InstallationSession, ['projectId', 'sessionId'], ['projectId', 'id'])
@Index('installations_active_endpoint', ['projectId', 'endpointHash'], {
  unique: true,
  where: '"revoked_at" IS NULL',
})
@Index('installations_user', ['projectId', 'userId'], { where: '"revoked_at" IS NULL' })
export class Installation {
  @PrimaryColumn('uuid')
  @ForeignKey(() => Project)
  projectId!: string;

  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  userId!: string;

  @Column('uuid')
  sessionId!: string;

  @Column('text')
  provider!: ProviderKind;

  @Column('text')
  endpointHash!: string;

  @Column('text')
  endpointCiphertext!: string;

  @Column('text')
  endpointFingerprint!: string;

  @Column('integer', { default: 1 })
  version!: number;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
