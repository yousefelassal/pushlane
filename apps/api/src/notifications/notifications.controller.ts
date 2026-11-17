import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { identifierSchema, notificationSchema } from '../../../../libs/contracts/src/index.js';
import { IdempotencyKey } from '../common/headers.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentProject, ProjectGuard } from '../projects/project.guard.js';
import { NotificationsService } from './notifications.service.js';

import type { NotificationInput } from '../../../../libs/contracts/src/index.js';
import type { Project } from '../../../../libs/database/src/entities/index.js';

const listQuerySchema = z
  .object({
    userId: identifierSchema.optional(),
    before: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

/** Sending and log inspection. Both require a backend API key. */
@Controller('v1/notifications')
@UseGuards(ProjectGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Post()
  @HttpCode(202)
  send(
    @CurrentProject() project: Project,
    @Body(new ZodValidationPipe(notificationSchema)) body: NotificationInput,
    @IdempotencyKey() key: string
  ) {
    return this.notifications.send(project, body, key);
  }

  @Get()
  list(
    @CurrentProject() project: Project,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>
  ) {
    return this.notifications.list(project, query);
  }

  @Get(':id')
  get(
    @CurrentProject() project: Project,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string
  ) {
    return this.notifications.get(project, id);
  }
}
