import type { ClientCompany } from '@/types/firestore';
import { cleanCNPJ } from '@/lib/utils/formatters';

/** Empresas que casam com a busca por razão social, nome fantasia ou CNPJ. */
export function filterClients(clients: readonly ClientCompany[], search: string): ClientCompany[] {
  const term = search.trim().toLowerCase();
  if (!term) return [...clients];
  // Só busca por CNPJ quando o termo tem algum dígito: nomes ("alpha") não casam com CNPJ alfanumérico.
  const doc = /\d/.test(term) ? cleanCNPJ(term) : '';
  return clients.filter(
    (c) =>
      c.name.toLowerCase().includes(term) ||
      (c.tradeName?.toLowerCase().includes(term) ?? false) ||
      (doc.length > 0 && cleanCNPJ(c.cnpj).includes(doc))
  );
}

/** Iniciais do nome para o selo do cartão (ignora palavras curtas como "de", "e", "da"). */
export function clientInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

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
