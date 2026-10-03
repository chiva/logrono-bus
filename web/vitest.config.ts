import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/board', 'packages/ha-card', 'apps/pwa'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/pwa/src/**/*.ts'],
      // Views and the shell are exercised in a real browser by the Playwright suite
      // (apps/pwa/e2e), which unit coverage cannot see; the threshold applies to the logic.
      exclude: [
        '**/*.gen.ts',
        '**/main.ts',
        '**/index.ts',
        'apps/pwa/src/app.ts',
        'apps/pwa/src/views/**',
      ],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
