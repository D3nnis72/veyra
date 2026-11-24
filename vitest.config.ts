import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: [
            'packages/{core,server,cli,desktop}/tests/**/*.test.ts',
            'tests/e2e/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'web',
          include: ['packages/web/tests/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
