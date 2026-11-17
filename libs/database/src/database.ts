import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';

import { RuntimeConfig } from './config.js';

import type { OnModuleDestroy } from '@nestjs/common';
import type { PoolClient } from 'pg';

/** SQL access validates returned records before they enter domain services. */
export class SqlSession {
  constructor(private readonly connection: Pool | PoolClient) {}

  async rows<T>(schema: z.ZodType<T>, sql: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.connection.query(sql, values);

    return z.array(schema).parse(result.rows);
  }

  async execute(sql: string, values: unknown[] = []): Promise<number> {
    const result = await this.connection.query(sql, values);

    return result.rowCount ?? 0;
  }
}

/** Owns connection lifetime and transaction rollback for all applications. */
@Injectable()
export class Database extends SqlSession implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(RuntimeConfig) config: RuntimeConfig) {
    const pool = new Pool({
      connectionString: config.values.DATABASE_URL,
      max: 10,
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 20_000,
    });

    super(pool);

    this.pool = pool;
  }

  async transaction<T>(operation: (session: SqlSession) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const result = await operation(new SqlSession(client));

      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK');

      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
