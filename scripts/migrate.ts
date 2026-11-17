import { RuntimeConfig } from '../libs/database/src/config.js';
import { runMigrations } from '../libs/database/src/migrations.js';

await runMigrations(new RuntimeConfig().values.DATABASE_URL);
