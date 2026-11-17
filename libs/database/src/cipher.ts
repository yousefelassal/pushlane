import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { RuntimeConfig } from './config.js';

/** Encrypts provider credentials and endpoints with authenticated tenant context. */
@Injectable()
export class SecretCipher {
	private readonly key: Buffer;

	constructor(@Inject(RuntimeConfig) config: RuntimeConfig) {
		this.key = Buffer.from(config.values.ENCRYPTION_KEY, 'hex');
	}

	encrypt(value: unknown, context: string): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.key, iv);

		cipher.setAAD(Buffer.from(context));

		const ciphertext = Buffer.concat([
			cipher.update(JSON.stringify(value), 'utf8'),
			cipher.final(),
		]);

		return [iv, cipher.getAuthTag(), ciphertext]
			.map((part) => part.toString('base64url'))
			.join('.');
	}

	decrypt<T>(value: string, context: string, schema: z.ZodType<T>): T {
		const [iv, tag, ciphertext] = value.split('.');

		if (!iv || !tag || !ciphertext) {
			throw new Error('Invalid encrypted record.');
		}

		const decipher = createDecipheriv(
			'aes-256-gcm',
			this.key,
			Buffer.from(iv, 'base64url'),
		);

		decipher.setAAD(Buffer.from(context));
		decipher.setAuthTag(Buffer.from(tag, 'base64url'));

		const plaintext = Buffer.concat([
			decipher.update(Buffer.from(ciphertext, 'base64url')),
			decipher.final(),
		]);

		return schema.parse(JSON.parse(plaintext.toString('utf8')));
	}
}
