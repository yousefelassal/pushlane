import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CoreModule } from '../../../libs/core/src/core.module.js';
import { ProjectGuard } from './auth.js';
import { HealthController, InstallationController, ProjectController } from './controllers.js';

/** Composes HTTP concerns around shared application services. */
@Module({
  imports: [CoreModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [HealthController, ProjectController, InstallationController],
  providers: [ProjectGuard, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
