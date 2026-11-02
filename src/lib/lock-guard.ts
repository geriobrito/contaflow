import type { ClassificationRule, LockState, OpeningBalances } from '@/types/firestore';
import { formatMonth } from '@/lib/periods';

export type ProtectedCollection = 'opening_balances' | 'bank_accounts' | 'chart_of_accounts';

/**
 * Campos cujo valor afeta saldos, partidas ou classificações contábeis já fechadas.
 * Deve permanecer idêntico às listas em `firestore.rules`.
 */
export const PROTECTED_FIELDS: Record<ProtectedCollection, readonly string[]> = {
  opening_balances: ['date', 'mode', 'entries', 'memo', 'lockSeq'],
  bank_accounts: [
    'openingBalance',
    'openingDate',
    'ledgerAccountId',
    'ledgerAccountCode',
    'ledgerAccountName',
    'kind',
    'lockSeq',
  ],
  chart_of_accounts: ['code', 'type', 'nature', 'parentId', 'level', 'dreGroup', 'isContra', 'lockSeq'],
} as const;

export const MISSING_LOCK_STATE_MESSAGE =
  'O controle de fechamento desta empresa ainda não foi inicializado. Execute o script de migração (backfill-lock-state) ou atualize a página.';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Igualdade profunda ignorando chaves `undefined` (mesma semântica do `clean()` gravado no Firestore). */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, idx) => sameFieldValue(item, b[idx]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
    const keysB = Object.keys(b).filter((k) => b[k] !== undefined);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameFieldValue(a[k], b[k]));
  }
  return false;
}

/**
 * Algum campo protegido mudou entre `before` e `after`?
 * Para `lockSeq`, ausência em `after` (ex.: formulário de tela que não copia metadados internos)
 * não conta como alteração; passar um `lockSeq` explícito diferente de `before.lockSeq` conta.
 */
export function touchesProtected<T extends object>(
  collection: ProtectedCollection,
  before: T,
  after: T
): boolean {
  const prev = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  for (const field of PROTECTED_FIELDS[collection]) {
    if (field === 'lockSeq') {
      if (next.lockSeq !== undefined && next.lockSeq !== prev.lockSeq) return true;
      continue;
    }
    if (!sameFieldValue(prev[field], next[field])) return true;
  }
  return false;
}

/**
 * Os campos protegidos de `doc` estão congelados diante de `lockState`?
 * - Conta global (`clientId === 'global'`): estrutura sempre fixa (D3).
 * - Sem `lockState` (empresa anterior ao backfill): falha fechado (`true`).
 * - `count === 0`: nenhuma competência fechada (`false`).
 * - `lockSeq === lockState.seq`: nada fechou desde a última gravação protegida (`false`).
 * - Caso contrário (inclusive documento legado sem `lockSeq`): congelado (`true`).
 */
export function isFrozen(
  doc: { lockSeq?: number; clientId?: string } | null | undefined,
  lockState: LockState | null | undefined
): boolean {
  if (doc?.clientId === 'global') return true;
  if (!lockState) return true;
  if (lockState.count === 0) return false;
  if (!doc) return false;
  return !(typeof doc.lockSeq === 'number' && Number.isInteger(doc.lockSeq) && doc.lockSeq === lockState.seq);
}

/**
 * Saldos de abertura congelados?
 * - Primeiro cadastro (`saved === null`): exige `count === 0` (D1 — meses já fechados mudariam).
 * - Edição (`saved !== null`): segue `isFrozen(saved, lockState)`.
 */
export function isOpeningFrozen(
  saved: Pick<OpeningBalances, 'lockSeq' | 'clientId'> | null | undefined,
  lockState: LockState | null | undefined
): boolean {
  if (!lockState) return true;
  if (!saved) return lockState.count > 0;
  return isFrozen(saved, lockState);
}

/** Carimba o `seq` atual da empresa no documento antes de gravar campo protegido. */
export function stampLockSeq<T extends object>(doc: T, lockState: LockState | null | undefined): T & { lockSeq: number } {
  if (!lockState) throw new Error(MISSING_LOCK_STATE_MESSAGE);
  return { ...doc, lockSeq: lockState.seq };
}

/** Mantém o `lockSeq` anterior (ou a ausência dele) quando só campos livres mudaram. */
export function preserveLockSeq<T extends object>(before: { lockSeq?: number }, after: T): T {
  const copy = { ...(after as Record<string, unknown>) };
  if (before.lockSeq !== undefined) copy.lockSeq = before.lockSeq;
  else delete copy.lockSeq;
  return copy as T;
}

export function formatLockedMonthsSummary(months?: readonly string[]): string {
  if (!months || months.length === 0) return '';
  const sorted = [...new Set(months)].sort();
  if (sorted.length <= 3) return sorted.map(formatMonth).join(', ');
  return `${sorted.slice(0, 3).map(formatMonth).join(', ')} e mais ${sorted.length - 3}`;
}

export function frozenMessage(
  collection: ProtectedCollection,
  options: {
    lockState?: LockState | null;
    lockedMonths?: readonly string[];
    firstTime?: boolean;
    isGlobal?: boolean;
  } = {}
): string {
  if (options.isGlobal) {
    return 'Esta conta é compartilhada (modelo legado): código, natureza e grupo na DRE são fixos; apenas nome e descrição podem ser alterados.';
  }
  if (options.lockState === null) {
    return MISSING_LOCK_STATE_MESSAGE;
  }
  const summary = formatLockedMonthsSummary(options.lockedMonths);
  const suffix = summary ? ` (${summary})` : '';

  if (collection === 'opening_balances') {
    if (options.firstTime) {
      return `Há competências fechadas${suffix}. Reabra-as na Conciliação para implantar os saldos de abertura.`;
    }
    return `Há competências fechadas desde o último ajuste${suffix}. Reabra todas as competências fechadas para alterar os saldos de abertura.`;
  }
  if (collection === 'bank_accounts') {
    return `Há competências fechadas desde o último ajuste${suffix}. Reabra todas as competências fechadas para alterar saldo inicial, data, vínculo contábil ou tipo (o nome continua editável).`;
  }
  return `Há competências fechadas desde o último ajuste${suffix}. Reabra todas as competências fechadas para alterar a estrutura ou o grupo na DRE desta conta (nome e descrição continuam editáveis).`;
}

/**
 * Valida a gravação contra `lockState` e devolve o documento pronto para persistir (com `lockSeq`
 * atualizado quando tocou campo protegido, ou preservado quando só mudou campo livre).
 */
export function prepareProtectedSave<T extends { clientId: string; lockSeq?: number }>(
  collection: ProtectedCollection,
  before: T | null | undefined,
  after: T,
  lockState: LockState | null | undefined,
  lockedMonths?: readonly string[]
): T {
  if (collection === 'chart_of_accounts' && after.clientId === 'global') {
    if (!before) return preserveLockSeq({}, after);
    if (touchesProtected(collection, before, after)) {
      throw new Error(frozenMessage('chart_of_accounts', { isGlobal: true }));
    }
    return preserveLockSeq(before, after);
  }

  if (!before) {
    if (collection === 'opening_balances') {
      if (!lockState) throw new Error(MISSING_LOCK_STATE_MESSAGE);
      if (lockState.count > 0) {
        throw new Error(frozenMessage('opening_balances', { lockState, lockedMonths, firstTime: true }));
      }
    }
    return stampLockSeq(after, lockState);
  }

  if (!touchesProtected(collection, before, after)) {
    return preserveLockSeq(before, after);
  }
  if (isFrozen(before, lockState)) {
    throw new Error(frozenMessage(collection, { lockState: lockState ?? null, lockedMonths }));
  }
  return stampLockSeq(after, lockState);
}

/** Estado inicial de fechamentos para uma empresa recém-criada. */
export const initialLockState = (clientId: string): LockState => ({
  id: clientId,
  clientId,
  count: 0,
  seq: 0,
});

export function nextLockStateOnClose(current: LockState | null | undefined, lockId: string): LockState {
  if (!current) throw new Error(MISSING_LOCK_STATE_MESSAGE);
  return {
    id: current.clientId,
    clientId: current.clientId,
    count: current.count + 1,
    seq: current.seq + 1,
    lastEvent: { kind: 'close', lockId },
  };
}

export function nextLockStateOnReopen(current: LockState | null | undefined, lockId: string): LockState {
  if (!current) throw new Error(MISSING_LOCK_STATE_MESSAGE);
  if (current.count < 1) throw new Error('Nenhuma competência consta como fechada no controle da empresa.');
  return {
    id: current.clientId,
    clientId: current.clientId,
    count: current.count - 1,
    seq: current.seq,
    lastEvent: { kind: 'reopen', lockId },
  };
}

export function nextLockStateOnYearClose(current: LockState | null | undefined, closingAuditId: string): LockState {
  if (!current) throw new Error(MISSING_LOCK_STATE_MESSAGE);
  return {
    id: current.clientId,
    clientId: current.clientId,
    count: current.count,
    seq: current.seq + 1,
    lastEvent: { kind: 'year', lockId: closingAuditId },
  };
}

/** Regra pode ser excluída pelo usuário? Administrador exclui todas; operador, só as que criou (D2). */
export function canDeleteRule(
  rule: Pick<ClassificationRule, 'createdByUid'>,
  actorUid: string | undefined,
  isAdmin: boolean
): boolean {
  return isAdmin || Boolean(actorUid && rule.createdByUid && rule.createdByUid === actorUid);
}

