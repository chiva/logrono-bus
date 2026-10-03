import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'ha-card',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
