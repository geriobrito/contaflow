/**
 * Geração de IDs únicos e seguros.
 * Usa crypto.randomUUID() (UUID v4) com fallback para ambientes sem suporte nativo.
 */
export function generateId(prefix?: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}

export const newClientId = (): string => generateId('client');
export const newAccountId = (): string => generateId('acc');
export const newRuleId = (): string => generateId('rule');
export const newBatchId = (): string => generateId('batch');
export const newSplitId = (): string => generateId('split');
