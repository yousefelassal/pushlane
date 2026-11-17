import { Check, Column, Entity, ForeignKey, PrimaryColumn } from 'typeorm';

import { Project } from './project.entity.js';

/** Dispatches reserved against a cloud plan allowance for one UTC month. */
@Entity('monthly_usage')
@Check('"reserved_dispatches" >= 0')
export class MonthlyUsage {
  @PrimaryColumn('uuid')
  @ForeignKey(() => Project)
  projectId!: string;

  @PrimaryColumn('date')
  month!: string;

  @Column('integer', { default: 0 })
  reservedDispatches!: number;
}
