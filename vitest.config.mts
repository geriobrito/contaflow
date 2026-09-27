import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          // Exige o emulador do Firestore: `npm run test:rules`.
          name: 'rules',
          environment: 'node',
          include: ['tests/rules/**/*.test.ts'],
          testTimeout: 20000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
