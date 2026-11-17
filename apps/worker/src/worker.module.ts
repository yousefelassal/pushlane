import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../libs/database/src/database.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';

/** Runs durable jobs independently from API request lifetime. */
@Module({
  imports: [DatabaseModule, DeliveryModule],
})
export class WorkerModule {}
