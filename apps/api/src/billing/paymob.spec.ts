import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  capturedTransaction,
  hasValidHmac,
  paymobConfiguration,
  transactionHmacMessage,
} from './paymob.js';

import type { TransactionCallback } from './paymob.js';

function callback(overrides: Partial<TransactionCallback['obj']> = {}): TransactionCallback {
  return {
    type: 'TRANSACTION',
    obj: {
      amount_cents: 100,
      created_at: '2020-03-25T18:39:44.719228',
      currency: 'EGP',
      error_occured: false,
      has_parent_transaction: false,
      id: 2556706,
      integration_id: 6741,
      is_3d_secure: true,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      order: { id: 4778239 },
      owner: 4705,
      pending: false,
      source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
      success: true,
      ...overrides,
    },
  };
}

describe('Paymob transaction callbacks', () => {
  it("signs the fields in Paymob's documented order", () => {
    expect(transactionHmacMessage(callback().obj)).toBe(
      '1002020-03-25T18:39:44.719228EGPfalsefalse25567066741truefalsefalsefalsetruefalse47782394705false2346MasterCardcardtrue'
    );
  });

  it('signs a missing or null field as an empty string', () => {
    const { obj } = callback({ source_data: { pan: null, sub_type: 'Wallet', type: 'wallet' } });
    const { obj: missing } = callback({ source_data: { sub_type: 'Wallet', type: 'wallet' } });

    expect(transactionHmacMessage(obj)).toContain('falseWalletwallettrue');
    expect(transactionHmacMessage(missing)).toBe(transactionHmacMessage(obj));
  });

  it('accepts only the HMAC-SHA512 of those fields under the shared secret', () => {
    const { obj } = callback();
    const hmac = createHmac('sha512', 'secret').update(transactionHmacMessage(obj)).digest('hex');

    expect(hasValidHmac(obj, hmac, 'secret')).toBe(true);
    expect(hasValidHmac(obj, hmac.toUpperCase(), 'secret')).toBe(true);
    expect(hasValidHmac(obj, hmac, 'other')).toBe(false);
    expect(hasValidHmac({ ...obj, amount_cents: 1 }, hmac, 'secret')).toBe(false);
    expect(hasValidHmac(obj, hmac.slice(1), 'secret')).toBe(false);
    expect(hasValidHmac(obj, undefined, 'secret')).toBe(false);
    expect(hasValidHmac(obj, [hmac], 'secret')).toBe(false);
  });

  it('pays only for a settled sale that names a payment', () => {
    expect(capturedTransaction(callback())).toEqual({
      transactionId: '2556706',
      paymobOrderId: '4778239',
      amountCents: 100,
      currency: 'EGP',
    });

    for (const unpaid of [
      { success: false },
      { pending: true },
      { is_auth: true },
      { is_voided: true },
      { is_refunded: true },
    ]) {
      expect(capturedTransaction(callback(unpaid))).toBeNull();
    }

    expect(capturedTransaction({ ...callback(), type: 'TOKEN' })).toBeNull();
  });
});

describe('Paymob configuration', () => {
  const complete = {
    PAYMOB_SECRET_KEY: 'sk_test',
    PAYMOB_PUBLIC_KEY: 'pk_test',
    PAYMOB_HMAC_SECRET: 'hmac',
    PAYMOB_INTEGRATION_IDS: '123, 456',
    PAYMOB_CURRENCY: 'EGP',
    PAYMOB_PRO_MONTH_AMOUNT_CENTS: '50000',
    PUBLIC_API_URL: 'https://api.example.com/',
    BILLING_RETURN_URL: 'https://app.example.com/billing',
  };

  it('turns billing off when no secret key is set', () => {
    expect(paymobConfiguration({})).toBeNull();
  });

  it('rejects a partial configuration instead of starting half-enabled', () => {
    expect(() => paymobConfiguration({ PAYMOB_SECRET_KEY: 'sk_test' })).toThrow();
    expect(() =>
      paymobConfiguration({ ...complete, PUBLIC_API_URL: 'http://api.example.com' })
    ).toThrow();
  });

  it('parses integration IDs and strips trailing slashes', () => {
    expect(paymobConfiguration(complete)).toMatchObject({
      PAYMOB_BASE_URL: 'https://accept.paymob.com',
      PAYMOB_INTEGRATION_IDS: [123, 456],
      PAYMOB_PRO_MONTH_AMOUNT_CENTS: 50000,
      PUBLIC_API_URL: 'https://api.example.com',
    });
  });
});
