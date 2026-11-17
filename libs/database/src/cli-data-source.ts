import { DataSource } from 'typeorm';

import { dataSourceOptions } from './data-source.js';

/** Entry point for `typeorm migration:*` commands. Reads DATABASE_URL from the environment. */
export default new DataSource(dataSourceOptions(process.env.DATABASE_URL ?? ''));
