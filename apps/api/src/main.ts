import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { RuntimeConfig } from '../../../libs/database/src/config.js';
import { AppModule } from './app.module.js';
import { configureApi } from './configure.js';

const app = await NestFactory.create(AppModule, { bodyParser: false });
const config = app.get(RuntimeConfig);

configureApi(app);

await app.listen(config.values.PORT, config.values.HOST);
