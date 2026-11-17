import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import {
  endpointSchema,
  installationIdSchema,
  notificationSchema,
  registrationTokenSchema,
} from '../../../libs/contracts/src/index.js';
import { Installations } from '../../../libs/core/src/installations.js';
import { Notifications } from '../../../libs/core/src/notifications.js';
import { Projects } from '../../../libs/core/src/projects.js';
import { Database } from '../../../libs/database/src/database.js';
import { bearerToken, CurrentProject, ProjectGuard } from './auth.js';

import type { Project } from '../../../libs/core/src/projects.js';

/** Converts untrusted HTTP data into the shared domain schema. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
    );
  }

  return result.data;
}

@Controller()
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get('health')
  async health() {
    await this.db.execute('SELECT 1');

    return { status: 'ok' };
  }
}

/** Backend-only operations use project keys, never registration tokens. */
@Controller('v1')
@UseGuards(ProjectGuard)
export class ProjectController {
  constructor(
    @Inject(Projects) private readonly projects: Projects,
    @Inject(Installations) private readonly installations: Installations,
    @Inject(Notifications) private readonly notifications: Notifications
  ) {}

  @Get('project')
  project(@CurrentProject() project: Project) {
    return this.projects.describe(project);
  }

  @Post('registration-tokens')
  registrationToken(@CurrentProject() project: Project, @Body() body: unknown) {
    return this.installations.issueToken(project, parse(registrationTokenSchema, body));
  }

  @Post('notifications')
  @HttpCode(202)
  send(
    @CurrentProject() project: Project,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown
  ) {
    return this.notifications.send(
      project,
      parse(notificationSchema, body),
      parse(z.string().min(1).max(200), key)
    );
  }

  @Get('notifications')
  list(@CurrentProject() project: Project, @Query() query: unknown) {
    return this.notifications.list(
      project,
      parse(
        z
          .object({
            userId: z.string().min(1).max(200).optional(),
            before: z.string().max(500).optional(),
            limit: z.coerce.number().int().min(1).max(100).default(25),
          })
          .strict(),
        query
      )
    );
  }

  @Get('notifications/:id')
  get(@CurrentProject() project: Project, @Param('id') id: string) {
    return this.notifications.get(project, parse(z.uuid(), id));
  }
}

/** Installation sessions cannot inspect logs or send notifications. */
@Controller('v1/installations')
export class InstallationController {
  constructor(@Inject(Installations) private readonly installations: Installations) {}

  @Put(':id')
  register(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown
  ) {
    return this.installations.register(
      bearerToken(authorization),
      parse(installationIdSchema, id),
      parse(endpointSchema, body)
    );
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@Param('id') id: string, @Headers('authorization') authorization: string | undefined) {
    return this.installations.revoke(bearerToken(authorization), parse(installationIdSchema, id));
  }
}
