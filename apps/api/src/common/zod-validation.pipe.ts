import { BadRequestException, Injectable } from '@nestjs/common';

import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Parses untrusted HTTP data with a shared contract schema and reports every issue. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
    );
  }

  return result.data;
}

/** Applies {@link parse} to a body, query, or route parameter. */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    return parse(this.schema, value);
  }
}
