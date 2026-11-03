import type { ClientCompany } from '@/types/firestore';

/**
 * Campos do cadastro gravados fora do formulário de Clientes, que precisam seguir com a
 * empresa quando ela é editada: `saveClient` substitui o documento inteiro, então o que o
 * formulário não remonta se perderia.
 * - `ignoredTemplateCodes`: tela do Plano de Contas;
 * - `daybook`: termos do Livro Diário.
 */
export function fieldsKeptOutsideForm(existing: ClientCompany | null | undefined): Partial<ClientCompany> {
  if (!existing) return {};
  return {
    ...(existing.ignoredTemplateCodes?.length ? { ignoredTemplateCodes: existing.ignoredTemplateCodes } : {}),
    ...(existing.daybook ? { daybook: existing.daybook } : {}),
  };
}
