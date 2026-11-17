import { Body, Controller, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';

import { checkoutRequestSchema } from '../../../../libs/contracts/src/index.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentProject, ProjectGuard } from '../projects/project.guard.js';
import { BillingService } from './billing.service.js';

import type { CheckoutRequest } from '../../../../libs/contracts/src/index.js';
import type { Project } from '../../../../libs/database/src/entities/index.js';

/** Backend keys open checkouts. Paymob authenticates its callbacks with an HMAC instead of a key. */
@Controller('v1/billing')
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Post('checkout')
  @UseGuards(ProjectGuard)
  checkout(
    @CurrentProject() project: Project,
    @Body(new ZodValidationPipe(checkoutRequestSchema)) body: CheckoutRequest
  ) {
    return this.billing.checkout(project, body);
  }

  @Post('paymob/callback')
  @HttpCode(200)
  async callback(@Query('hmac') hmac: unknown, @Body() body: unknown) {
    await this.billing.handleCallback(hmac, body);

    return { received: true };
  }
}
