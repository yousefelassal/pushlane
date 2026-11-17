import 'reflect-metadata';

import { setTimeout } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { DeliveryWorker } from '../../../libs/core/src/delivery-worker.js';
import { RuntimeConfig } from '../../../libs/database/src/config.js';
import { closeApnsConnections } from '../../../libs/providers/src/index.js';
import { WorkerModule } from './worker.module.js';

const app = await NestFactory.createApplicationContext(WorkerModule);
const worker = app.get(DeliveryWorker);
const config = app.get(RuntimeConfig);
const logger = new Logger('Worker');
let stopping = false;
let lastCleanup = 0;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopping = true;
  });
}

try {
  while (!stopping) {
    try {
      await worker.tick();

      if (Date.now() - lastCleanup > 3_600_000) {
        await worker.cleanup();

        lastCleanup = Date.now();
      }
    } catch {
      logger.error({ event: 'worker_batch_failed' });
    }

    if (!stopping) await setTimeout(config.values.WORKER_INTERVAL_MS);
  }
} finally {
  closeApnsConnections();

  await app.close();
}
