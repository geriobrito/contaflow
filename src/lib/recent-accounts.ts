/**
 * Últimas contas escolhidas ao classificar, por empresa, guardadas no navegador: alimentam as
 * "Sugeridas" do seletor sem nenhuma leitura no banco.
 */

const MAX_RECENT = 8;
const keyOf = (clientId: string) => `contaflow_recent_accounts_${clientId}`;

export function loadRecentAccounts(clientId: string | null | undefined): string[] {
  if (!clientId || typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(keyOf(clientId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Coloca as contas no topo das recentes (a primeira do array fica em primeiro). */
export function rememberRecentAccounts(clientId: string | null | undefined, accountIds: readonly (string | null | undefined)[]): void {
  if (!clientId || typeof window === 'undefined') return;
  const fresh = accountIds.filter((id): id is string => Boolean(id));
  if (fresh.length === 0) return;
  const next = [...new Set([...fresh, ...loadRecentAccounts(clientId)])].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(keyOf(clientId), JSON.stringify(next));
  } catch {
    /* navegador sem espaço ou em modo privado: as sugestões só ficam sem as recentes */
  }
}
