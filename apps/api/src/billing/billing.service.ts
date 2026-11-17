import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { Payment, Project } from '../../../../libs/database/src/entities/index.js';
import { lockProject } from '../../../../libs/database/src/locks.js';
import {
  capturedTransaction,
  createCheckout,
  hasValidHmac,
  transactionCallbackSchema,
} from './paymob.js';

import type { DataSource } from 'typeorm';
import type { CheckoutRequest, CheckoutSession } from '../../../../libs/contracts/src/index.js';
import type { CapturedTransaction, PaymobConfiguration } from './paymob.js';

export const PAYMOB_CONFIGURATION = Symbol('PAYMOB_CONFIGURATION');

/** Paid months apply to free projects and to Pro periods. Self-hosted and permanent Pro projects have nothing to buy. */
function canBuyPro(project: Pick<Project, 'plan' | 'planExpiresAt'>): boolean {
  return project.plan === 'free' || (project.plan === 'pro' && project.planExpiresAt !== null);
}

/** Sells Pro by the month through Paymob. Only a signed Paymob callback changes a project's plan. */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(PAYMOB_CONFIGURATION) private readonly config: PaymobConfiguration | null
  ) {}

  /** Opens a Paymob checkout priced from server configuration and records it as a pending payment. */
  async checkout(project: Project, input: CheckoutRequest): Promise<CheckoutSession> {
    const config = this.enabled();

    if (!canBuyPro(project)) {
      throw new ConflictException('This project does not have a purchasable plan.');
    }

    const paymentId = randomUUID();
    const intention = await createCheckout(config, {
      paymentId,
      projectName: project.name,
      customer: input.customer,
    }).catch((error: unknown) => {
      this.logger.error({ event: 'paymob_intention_failed', paymentId, error: String(error) });

      throw new BadGatewayException('The payment provider is unavailable.');
    });

    await this.dataSource.getRepository(Payment).insert({
      id: paymentId,
      projectId: project.id,
      status: 'pending',
      amountCents: config.PAYMOB_PRO_MONTH_AMOUNT_CENTS,
      currency: config.PAYMOB_CURRENCY,
      paymobOrderId: intention.paymobOrderId,
    });

    return { paymentId, checkoutUrl: intention.checkoutUrl };
  }

  /**
   * Applies a Paymob Transaction Processed callback. Rejects an unsigned body with 401 so a
   * misconfigured secret surfaces as Paymob retries rather than lost payments. Any signed callback
   * succeeds, including ones that pay for nothing.
   */
  async handleCallback(hmac: unknown, body: unknown): Promise<void> {
    const config = this.enabled();
    const callback = transactionCallbackSchema.safeParse(body);

    if (!callback.success || !hasValidHmac(callback.data.obj, hmac, config.PAYMOB_HMAC_SECRET)) {
      throw new UnauthorizedException('Invalid Paymob signature.');
    }

    const transaction = capturedTransaction(callback.data);

    if (transaction) await this.settle(transaction);
  }

  /**
   * Marks the payment paid once and extends Pro by one month from the later of now and the current
   * expiry. Duplicate and concurrent callbacks lose the compare-and-set and change nothing. A project
   * whose plan changed since checkout keeps the payment pending for an operator to refund or apply.
   */
  private async settle(transaction: CapturedTransaction): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOneBy(Payment, {
        paymobOrderId: transaction.paymobOrderId,
      });

      if (!payment) {
        this.logger.warn({ event: 'paymob_unknown_payment', ...transaction });

        return;
      }

      await lockProject(manager, payment.projectId);

      const project = await manager.findOneByOrFail(Project, { id: payment.projectId });

      if (payment.status === 'pending' && !canBuyPro(project)) {
        this.logger.error({
          event: 'paymob_payment_not_applicable',
          paymentId: payment.id,
          ...transaction,
        });

        return;
      }

      const { affected } = await manager
        .createQueryBuilder()
        .update(Payment)
        .set({ status: 'paid', transactionId: transaction.transactionId, paidAt: () => 'now()' })
        .where({
          id: payment.id,
          status: 'pending',
          amountCents: transaction.amountCents,
          currency: transaction.currency,
        })
        .execute();

      if (!affected) {
        if (payment.status === 'pending') {
          this.logger.warn({ event: 'paymob_amount_mismatch', ...transaction });
        }

        return;
      }

      await manager
        .createQueryBuilder()
        .update(Project)
        .set({
          plan: 'pro',
          planExpiresAt: () =>
            "greatest(coalesce(plan_expires_at, now()), now()) + interval '1 month'",
        })
        .where({ id: payment.projectId })
        .execute();
    });
  }

  private enabled(): PaymobConfiguration {
    if (!this.config) throw new NotFoundException('Billing is not enabled on this server.');

    return this.config;
  }
}
