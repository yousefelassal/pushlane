import { entities } from './entities/index.js';
import { migrations } from './migrations/index.js';
import { SnakeNamingStrategy } from './naming-strategy.js';

import type { DataSourceOptions } from 'typeorm';

/** Shared connection settings for the Nest applications, scripts, and the TypeORM CLI. */
export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities,
    migrations,
    migrationsTransactionMode: 'all',
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    poolSize: 10,
    extra: {
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 20_000,
    },
  };
}
