import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import type { DataSource } from 'typeorm';

/** Readiness for load balancers. Fails when PostgreSQL is unreachable. */
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    await this.dataSource.query('SELECT 1');

    return { status: 'ok' };
  }
}
