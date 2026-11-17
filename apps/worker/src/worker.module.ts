import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../libs/database/src/database.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { WorkerLoop } from './worker-loop.service.js';

/** Runs durable jobs independently from API request lifetime. */
@Module({
  imports: [DatabaseModule, DeliveryModule, RetentionModule],
  providers: [WorkerLoop],
})
export class WorkerModule {}
