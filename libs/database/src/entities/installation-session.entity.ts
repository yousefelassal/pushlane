import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';

import { Project } from './project.entity.js';

/** A short-lived registration grant for one installation and user. Only its token hash is stored. */
@Entity('installation_sessions')
@Unique('installation_sessions_project_id_id', ['projectId', 'id'])
@Index('installation_sessions_active', ['projectId', 'installationId'], {
  unique: true,
  where: '"revoked_at" IS NULL',
})
export class InstallationSession {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  @ForeignKey(() => Project)
  projectId!: string;

  @Column('uuid')
  installationId!: string;

  @Column('text')
  userId!: string;

  @Column('text', { unique: true })
  tokenHash!: string;

  @Column({ type: 'timestamptz', precision: 3 })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
