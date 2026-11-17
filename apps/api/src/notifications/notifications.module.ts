import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/** Notification acceptance, allowance reservation, and delivery logs. */
@Module({
  imports: [ProjectsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
