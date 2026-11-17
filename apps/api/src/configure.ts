import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import express from 'express';
import helmet from 'helmet';
import { RuntimeConfig } from '../../../libs/database/src/config.js';

/** Applies the same HTTP boundaries in production and integration checks. */
export function configureApi(app: INestApplication): void {
	const config = app.get(RuntimeConfig);
	const origins = config.values.CORS_ORIGINS.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean);

	app.use(helmet());
	app.use(express.json({ limit: '8kb' }));
	app.enableCors({
		origin: origins,
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
		allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
	});
	app.use(
		'/dashboard',
		express.static(resolve('apps/dashboard/dist'), { index: 'index.html' }),
	);
	app.enableShutdownHooks();
}
