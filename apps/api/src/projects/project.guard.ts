import { createParamDecorator, Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import { bearerToken } from '../common/headers.js';
import { ProjectsService } from './projects.service.js';

import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Project } from '../../../../libs/database/src/entities/index.js';

interface ProjectRequest extends Request {
  project?: Project;
}

/** Backend API keys grant access only to their own project environment. */
@Injectable()
export class ProjectGuard implements CanActivate {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProjectRequest>();

    request.project = await this.projects.authenticate(bearerToken(request.headers.authorization));

    return true;
  }
}

/** The project authenticated by {@link ProjectGuard}. */
export const CurrentProject = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Project => {
    const project = context.switchToHttp().getRequest<ProjectRequest>().project;

    if (!project) throw new UnauthorizedException('Project authentication is required.');

    return project;
  }
);
