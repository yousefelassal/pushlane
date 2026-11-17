import { Module } from '@nestjs/common';

import { DeliveryWorker } from '../../../libs/core/src/delivery-worker.js';
import { InfrastructureModule } from '../../../libs/database/src/infrastructure.module.js';
import { ProviderDispatcher } from '../../../libs/providers/src/index.js';

/** Runs durable jobs independently from API request lifetime. */
@Module({
  imports: [InfrastructureModule],
  providers: [ProviderDispatcher, DeliveryWorker],
})
export class WorkerModule {}
