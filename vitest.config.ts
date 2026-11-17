import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.spec.ts', 'libs/**/*.spec.ts', 'packages/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
