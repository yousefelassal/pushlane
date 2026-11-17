import express from 'express';
import helmet from 'helmet';

import { RuntimeConfig } from '../../../libs/database/src/config.js';

import type { INestApplication } from '@nestjs/common';

/** Applies the same HTTP boundaries in production and integration checks. */
export function configureApi(app: INestApplication): void {
  const config = app.get(RuntimeConfig);
  const origins = config.values.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use('/v1/billing/paymob/callback', express.json({ limit: '64kb' }));
  app.use(express.json({ limit: '8kb' }));
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });
  app.enableShutdownHooks();
}
