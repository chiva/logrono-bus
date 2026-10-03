import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'pwa',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
