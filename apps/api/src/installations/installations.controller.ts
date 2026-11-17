import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import {
  endpointSchema,
  installationIdSchema,
  registrationTokenSchema,
} from '../../../../libs/contracts/src/index.js';
import { BearerToken } from '../common/headers.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentProject, ProjectGuard } from '../projects/project.guard.js';
import { InstallationsService } from './installations.service.js';

import type { PushEndpoint } from '../../../../libs/contracts/src/index.js';
import type { Project } from '../../../../libs/database/src/entities/index.js';

/**
 * Backend keys mint registration tokens. Registration tokens only manage their own installation,
 * so they cannot read logs or send notifications.
 */
@Controller('v1')
export class InstallationsController {
  constructor(@Inject(InstallationsService) private readonly installations: InstallationsService) {}

  @Post('registration-tokens')
  @UseGuards(ProjectGuard)
  issueToken(
    @CurrentProject() project: Project,
    @Body(new ZodValidationPipe(registrationTokenSchema))
    body: { userId: string; installationId: string }
  ) {
    return this.installations.issueToken(project, body);
  }

  @Put('installations/:id')
  register(
    @BearerToken() token: string,
    @Param('id', new ZodValidationPipe(installationIdSchema)) id: string,
    @Body(new ZodValidationPipe(endpointSchema)) endpoint: PushEndpoint
  ) {
    return this.installations.register(token, id, endpoint);
  }

  @Delete('installations/:id')
  @HttpCode(204)
  revoke(
    @BearerToken() token: string,
    @Param('id', new ZodValidationPipe(installationIdSchema)) id: string
  ) {
    return this.installations.revoke(token, id);
  }
}
