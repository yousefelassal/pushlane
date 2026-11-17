import { Module } from '@nestjs/common';

import { ProjectsModule } from '../apps/api/src/projects/projects.module.js';
import { DatabaseModule } from '../libs/database/src/database.module.js';

/** Project provisioning without the HTTP server, for operator scripts. */
@Module({ imports: [DatabaseModule, ProjectsModule] })
export class CliModule {}
