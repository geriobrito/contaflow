import type { Page } from '@playwright/test';

/**
 * Resposta simulada da consulta de CNPJ (`/api/cnpj/...`): os testes não dependem da Receita
 * nem da internet. Sem `data`, a consulta responde como indisponível (preenchimento manual).
 */
export async function mockReceita(page: Page, data?: Record<string, unknown>) {
  await page.route('**/api/cnpj/**', (route) =>
    data ? route.fulfill({ json: data }) : route.fulfill({ status: 503, json: { error: 'Consulta automática indisponível — preencha os campos manualmente.' } })
  );
}
