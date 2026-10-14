import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;

/**
 * Testes de ponta a ponta no navegador, no modo local do app (dados no localStorage): não
 * dependem de Firebase, emulador nem rede. O servidor é o build de produção, gerado com as
 * variáveis do Firebase vazias — assim nunca tocam num projeto real, mesmo que o `.env.local`
 * da máquina aponte para um.
 *
 *   npm run test:e2e                                  (Chromium do Playwright: `npx playwright install chromium`)
 *   PLAYWRIGHT_CHANNEL=chrome npm run test:e2e        (Chrome já instalado na máquina)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) },
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_FIREBASE_API_KEY: '',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: '',
      NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY: '',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
