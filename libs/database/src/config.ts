import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const configurationSchema = z.object({
  DATABASE_URL: z.url(),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'ENCRYPTION_KEY must contain 32 random bytes encoded as hex.'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3020),
  HOST: z.string().default('127.0.0.1'),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  CORS_ORIGINS: z.string().default(''),
});

/** Validated process configuration shared by the API, CLI, and worker. */
@Injectable()
export class RuntimeConfig {
  readonly values = configurationSchema.parse(process.env);
}
