import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MonthlyUsage, Project } from '../../../../libs/database/src/entities/index.js';
import { ProjectGuard } from './project.guard.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/** Project provisioning and backend key authentication. Other features reuse its guard. */
@Module({
  imports: [TypeOrmModule.forFeature([Project, MonthlyUsage])],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectGuard],
  exports: [ProjectsService, ProjectGuard],
})
export class ProjectsModule {}
