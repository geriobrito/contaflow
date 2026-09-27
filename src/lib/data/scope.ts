import type { Actor } from '@/lib/audit';

/**
 * Escopo de dados da sessão: o escritório (orgId) e o usuário autenticado (ator).
 *
 * Definido pelo AuthContext assim que o perfil é resolvido e limpo no logout.
 * A camada Firestore exige o orgId em toda leitura/escrita e o ator em todo registro
 * de auditoria — ambos validados pelas regras de segurança.
 */
let currentOrgId: string | null = null;
let currentActor: Actor | null = null;

export function setSession(orgId: string | null, actor: Actor | null): void {
  currentOrgId = orgId;
  currentActor = orgId ? actor : null;
}

export function getOrgId(): string {
  if (!currentOrgId) {
    throw new Error('Sessão sem escritório definido. Faça login novamente.');
  }
  return currentOrgId;
}

export function getActor(): Actor {
  if (!currentActor) {
    throw new Error('Sessão sem usuário identificado. Faça login novamente.');
  }
  return currentActor;
}

export function peekOrgId(): string | null {
  return currentOrgId;
}
