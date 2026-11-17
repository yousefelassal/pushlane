import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService, PAYMOB_CONFIGURATION } from './billing.service.js';
import { paymobConfiguration } from './paymob.js';

/** Paymob checkout and payment callbacks. Disabled unless `PAYMOB_SECRET_KEY` is set. */
@Module({
  imports: [ProjectsModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    { provide: PAYMOB_CONFIGURATION, useFactory: () => paymobConfiguration(process.env) },
  ],
})
export class BillingModule {}
