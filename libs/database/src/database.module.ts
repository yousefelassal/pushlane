import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SecretCipher } from './cipher.js';
import { RuntimeConfig } from './config.js';
import { dataSourceOptions } from './data-source.js';

/** Validated configuration and credential encryption, shared by every module in a process. */
@Global()
@Module({
  providers: [RuntimeConfig, SecretCipher],
  exports: [RuntimeConfig, SecretCipher],
})
export class RuntimeModule {}

/** Owns the process-wide TypeORM connection pool. Schema changes ship only as migrations. */
@Module({
  imports: [
    RuntimeModule,
    TypeOrmModule.forRootAsync({
      imports: [RuntimeModule],
      inject: [RuntimeConfig],
      useFactory: (config: RuntimeConfig) => dataSourceOptions(config.values.DATABASE_URL),
    }),
  ],
})
export class DatabaseModule {}
