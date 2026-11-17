import { Module } from '@nestjs/common';

import { InfrastructureModule } from '../../database/src/infrastructure.module.js';
import { Installations } from './installations.js';
import { Notifications } from './notifications.js';
import { Projects } from './projects.js';

/** Shares application services without exposing HTTP or worker concerns. */
@Module({
  imports: [InfrastructureModule],
  providers: [Projects, Installations, Notifications],
  exports: [Projects, Installations, Notifications],
})
export class CoreModule {}
