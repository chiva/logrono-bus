import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'board',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
