import { setTimeout } from 'node:timers/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { RuntimeConfig } from '../../../libs/database/src/config.js';
import { DeliveryWorker } from './delivery/delivery-worker.service.js';
import { RetentionService } from './retention/retention.service.js';

import type { BeforeApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';

const RETENTION_INTERVAL_MS = 3_600_000;

/**
 * Polls for due deliveries from bootstrap until shutdown. Shutdown waits for the
 * in-flight batch, so leases are settled before the connection pool closes.
 */
@Injectable()
export class WorkerLoop implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(WorkerLoop.name);
  private readonly stop = new AbortController();
  private running?: Promise<void>;

  constructor(
    @Inject(DeliveryWorker) private readonly deliveries: DeliveryWorker,
    @Inject(RetentionService) private readonly retention: RetentionService,
    @Inject(RuntimeConfig) private readonly config: RuntimeConfig
  ) {}

  onApplicationBootstrap(): void {
    this.running = this.run();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stop.abort();

    await this.running;
  }

  private async run(): Promise<void> {
    let lastCleanup = 0;

    while (!this.stop.signal.aborted) {
      try {
        await this.deliveries.tick();

        if (Date.now() - lastCleanup > RETENTION_INTERVAL_MS) {
          await this.retention.cleanup();

          lastCleanup = Date.now();
        }
      } catch {
        this.logger.error({ event: 'worker_batch_failed' });
      }

      await setTimeout(this.config.values.WORKER_INTERVAL_MS, undefined, {
        signal: this.stop.signal,
      }).catch(() => undefined);
    }
  }
}
