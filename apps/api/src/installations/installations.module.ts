import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module.js';
import { InstallationsController } from './installations.controller.js';
import { InstallationsService } from './installations.service.js';

/** Registration tokens and the installation endpoint lifecycle. */
@Module({
  imports: [ProjectsModule],
  controllers: [InstallationsController],
  providers: [InstallationsService],
})
export class InstallationsModule {}
