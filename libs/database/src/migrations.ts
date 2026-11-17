import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';

/** Applies immutable SQL migrations under one transaction-scoped database lock. */
export async function runMigrations(databaseUrl: string): Promise<void> {
	const pool = new Pool({ connectionString: databaseUrl });
	const client = await pool.connect();

	try {
		await client.query('BEGIN');
		await client.query(
			"SELECT pg_advisory_xact_lock(hashtext('pushlane:migrations'))",
		);
		await client.query(
			'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
		);

		const files = (await readdir('migrations'))
			.filter((name) => name.endsWith('.sql'))
			.sort();

		for (const name of files) {
			const sql = await readFile(`migrations/${name}`, 'utf8');
			const checksum = createHash('sha256').update(sql).digest('hex');
			const existing = await client.query<{ checksum: string }>(
				'SELECT checksum FROM schema_migrations WHERE name = $1',
				[name],
			);
			const prior = existing.rows[0];

			if (prior) {
				if (prior.checksum !== checksum)
					throw new Error(`Applied migration changed: ${name}`);

				continue;
			}

			await client.query(sql);
			await client.query(
				'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
				[name, checksum],
			);

			process.stdout.write(`Applied ${name}\n`);
		}

		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');

		throw error;
	} finally {
		client.release();

		await pool.end();
	}
}
