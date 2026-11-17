import { defineConfig, loadEnv } from 'vite';

import type { Plugin } from 'vite';

/**
 * Emits Cloudflare Workers static asset headers.
 *
 * The dashboard holds a backend API key in memory, so the policy allows network requests only to
 * this origin and the configured API origin.
 */
function securityHeaders(apiOrigin: string): Plugin {
  const policy = [
    "default-src 'self'",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  return {
    name: 'pushlane-security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          `  Content-Security-Policy: ${policy}`,
          '  Referrer-Policy: no-referrer',
          '  X-Content-Type-Options: nosniff',
          '',
        ].join('\n'),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const apiBase = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE_URL ?? '';

  if (mode === 'cloudflare' && !apiBase) {
    throw new Error('Set VITE_API_BASE_URL to the Pushlane API origin before deploying.');
  }

  return {
    plugins: [securityHeaders(apiBase ? new URL(apiBase).origin : '')],
    server: {
      proxy: {
        '/v1': 'http://127.0.0.1:3020',
      },
    },
  };
});
