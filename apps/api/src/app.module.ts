import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { DatabaseModule } from '../../../libs/database/src/database.module.js';
import { HealthModule } from './health/health.module.js';
import { InstallationsModule } from './installations/installations.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ProjectsModule } from './projects/projects.module.js';

/** Composes the HTTP feature modules over one database connection. */
@Module({
  imports: [
    DatabaseModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    HealthModule,
    ProjectsModule,
    InstallationsModule,
    NotificationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
