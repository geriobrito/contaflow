/**
 * Escopo de dados da sessão: o escritório (orgId) do usuário autenticado.
 *
 * Definido pelo AuthContext assim que o perfil do usuário é resolvido e limpo no
 * logout. A camada Firestore o exige em toda leitura e escrita — é o que as
 * regras de segurança validam.
 */
let currentOrgId: string | null = null;

export function setOrgId(orgId: string | null): void {
  currentOrgId = orgId;
}

export function getOrgId(): string {
  if (!currentOrgId) {
    throw new Error('Sessão sem escritório definido. Faça login novamente.');
  }
  return currentOrgId;
}

export function peekOrgId(): string | null {
  return currentOrgId;
}
