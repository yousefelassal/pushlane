import { DataSource } from 'typeorm';

import { RuntimeConfig } from '../libs/database/src/config.js';
import { dataSourceOptions } from '../libs/database/src/data-source.js';

const LOCK = "hashtext('pushlane:migrations')";

const dataSource = await new DataSource(
  dataSourceOptions(new RuntimeConfig().values.DATABASE_URL)
).initialize();

// TypeORM takes no lock, so concurrent deploys would race to create the same tables.
const lock = dataSource.createQueryRunner();

try {
  await lock.query(`SELECT pg_advisory_lock(${LOCK})`);

  for (const migration of await dataSource.runMigrations()) {
    process.stdout.write(`Applied ${migration.name}\n`);
  }
} finally {
  await lock.query(`SELECT pg_advisory_unlock(${LOCK})`).catch(() => undefined);
  await lock.release();
  await dataSource.destroy();
}
