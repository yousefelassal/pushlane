import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { CurrentProject, ProjectGuard } from './project.guard.js';
import { ProjectsService } from './projects.service.js';

import type { Project } from '../../../../libs/database/src/entities/index.js';

@Controller('v1/project')
@UseGuards(ProjectGuard)
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  describe(@CurrentProject() project: Project) {
    return this.projects.describe(project);
  }
}
