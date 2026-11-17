import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const contents = `DATABASE_URL=postgresql://pushlane:pushlane@127.0.0.1:54328/pushlane\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nPORT=3020\nHOST=127.0.0.1\nWORKER_INTERVAL_MS=1000\nCORS_ORIGINS=http://localhost:5173,http://localhost:4321\n`;

try {
	await writeFile('.env', contents, { flag: 'wx', mode: 0o600 });

	process.stdout.write('Created .env with a random encryption key.\n');
} catch (error) {
	if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
		process.stdout.write('Keeping the existing .env file.\n');
	} else {
		throw error;
	}
}
