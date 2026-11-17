import 'reflect-metadata';

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';

import { ProjectsService } from '../apps/api/src/projects/projects.service.js';
import {
  environmentSchema,
  planSchema,
  providerCredentialsSchema,
} from '../libs/contracts/src/index.js';
import { CliModule } from './cli.module.js';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    name: { type: 'string' },
    environment: { type: 'string', default: 'development' },
    plan: { type: 'string', default: 'self_hosted' },
    credentials: { type: 'string' },
  },
});
const name = z.string().min(1).max(200).parse(values.name);
const environment = environmentSchema.parse(values.environment);
const plan = planSchema.parse(values.plan);
const credentials = providerCredentialsSchema.parse(
  values.credentials ? JSON.parse(await readFile(values.credentials, 'utf8')) : {}
);
const app = await NestFactory.createApplicationContext(CliModule, {
  logger: ['error', 'warn'],
});

try {
  const result = await app.get(ProjectsService).create({ name, environment, plan, credentials });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await app.close();
}
