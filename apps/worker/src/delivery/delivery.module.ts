import { Module } from '@nestjs/common';

import { ProviderDispatcher } from '../../../../libs/providers/src/index.js';
import { DeliveryWorker, DISPATCHER } from './delivery-worker.service.js';

/** The durable delivery queue consumer and its provider transports. */
@Module({
  providers: [DeliveryWorker, { provide: DISPATCHER, useClass: ProviderDispatcher }],
  exports: [DeliveryWorker],
})
export class DeliveryModule {}
