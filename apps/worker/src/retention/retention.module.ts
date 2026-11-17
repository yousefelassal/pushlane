import { Module } from '@nestjs/common';

import { RetentionService } from './retention.service.js';

/** Paid plan expiry and plan-based expiry of notification logs. */
@Module({
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
