import { Global, Module } from '@nestjs/common';
import { RuntimeConfig } from './config.js';
import { Database } from './database.js';
import { SecretCipher } from './cipher.js';

/** Provides the process-wide connection pool and encryption boundary. */
@Global()
@Module({
	providers: [RuntimeConfig, Database, SecretCipher],
	exports: [RuntimeConfig, Database, SecretCipher],
})
export class InfrastructureModule {}
