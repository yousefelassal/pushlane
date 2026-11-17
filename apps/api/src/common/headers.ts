import { createParamDecorator, UnauthorizedException } from '@nestjs/common';

import { identifierSchema } from '../../../../libs/contracts/src/index.js';
import { parse } from './zod-validation.pipe.js';

import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Extracts one bearer credential without accepting credentials in URLs. */
export function bearerToken(value: string | undefined): string {
  const token = /^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(value ?? '')?.[1];

  if (!token) throw new UnauthorizedException('A bearer token is required.');

  return token;
}

/** The request's bearer token. Rejects the request with 401 when it is missing or malformed. */
export const BearerToken = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  bearerToken(context.switchToHttp().getRequest<Request>().headers.authorization)
);

/** The required `Idempotency-Key` header. Rejects the request with 400 when it is invalid. */
export const IdempotencyKey = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  parse(identifierSchema, context.switchToHttp().getRequest<Request>().headers['idempotency-key'])
);
