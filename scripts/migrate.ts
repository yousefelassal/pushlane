import { DataSource } from 'typeorm';

import { RuntimeConfig } from '../libs/database/src/config.js';
import { dataSourceOptions } from '../libs/database/src/data-source.js';

const dataSource = await new DataSource(
  dataSourceOptions(new RuntimeConfig().values.DATABASE_URL)
).initialize();

try {
  for (const migration of await dataSource.runMigrations()) {
    process.stdout.write(`Applied ${migration.name}\n`);
  }
} finally {
  await dataSource.destroy();
}
