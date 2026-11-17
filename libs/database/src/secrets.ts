import { createHash } from 'node:crypto';

/** Hashes high-entropy bearer secrets without storing their plaintext. */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
