import type { AccountType, ChartAccount, DREGroup } from '@/types/firestore';
import { resolveDREGroup } from '@/lib/dre/build';
import { accountMatches } from '@/lib/account-search';

/* =========================================================================
   Rótulos
   ========================================================================= */

export const TYPE_LABEL: Record<AccountType, string> = {
  ASSET: 'Ativo',
  LIABILITY: 'Passivo',
  EQUITY: 'Patrimônio líquido',
  COST: 'Custo',
  EXPENSE: 'Despesa',
  REVENUE: 'Receita',
};

export const DRE_GROUPS: readonly { value: DREGroup; label: string }[] = [
  { value: 'GROSS_REVENUE', label: 'Receita operacional bruta' },
  { value: 'DEDUCTIONS', label: 'Deduções da receita bruta' },
  { value: 'COSTS', label: 'Custos das vendas' },
  { value: 'OPERATING_EXPENSES', label: 'Despesas operacionais' },
  { value: 'FINANCIAL_INCOME', label: 'Receitas financeiras' },
  { value: 'FINANCIAL_EXPENSES', label: 'Despesas financeiras' },
  { value: 'OTHER_INCOME', label: 'Outras receitas operacionais' },
  { value: 'OTHER_EXPENSES', label: 'Outras despesas operacionais' },
  { value: 'INCOME_TAXES', label: 'IRPJ e CSLL' },
];

export const DRE_LABEL = new Map<string, string>(DRE_GROUPS.map((g) => [g.value, g.label]));

/** Tipos de conta de resultado (vão para a DRE). */
export const RESULT_TYPES: ReadonlySet<AccountType> = new Set(['REVENUE', 'EXPENSE', 'COST']);

/** Rótulo do grupo da DRE de uma conta analítica, ou null se patrimonial. */
export function dreLabel(account: ChartAccount): string | null {
  const group = resolveDREGroup(account);
  return group ? (DRE_LABEL.get(group) ?? null) : null;
}

/** Grupo da DRE sugerido para uma nova conta: o do pai ou o das contas irmãs. */
export function inheritedDREGroup(parent: ChartAccount | undefined, accounts: readonly ChartAccount[]): DREGroup | '' {
  if (!parent) return '';
  if (parent.dreGroup) return parent.dreGroup;
  const sibling =
    accounts.find((a) => a.parentId === parent.id && a.dreGroup) ??
    accounts.find((a) => a.code.startsWith(`${parent.code}.`) && a.dreGroup);
  return sibling?.dreGroup ?? '';
}

/* =========================================================================
   Árvore (hierarquia inferida pelo código: 1 › 1.1 › 1.1.01 › 1.1.01.001)
   ========================================================================= */

export interface TreeNode {
  account: ChartAccount;
  depth: number;
  children: TreeNode[];
}

export function buildTree(accounts: readonly ChartAccount[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(accounts.map((a) => [a.code, { account: a, depth: 0, children: [] }]));
  const roots: TreeNode[] = [];

  const parentOf = (code: string): TreeNode | undefined => {
    const parts = code.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const candidate = nodes.get(parts.slice(0, i).join('.'));
      if (candidate) return candidate;
    }
    return undefined;
  };

  for (const node of nodes.values()) {
    const parent = parentOf(node.account.code);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortAndDepth = (list: TreeNode[], depth: number) => {
    list.sort((a, b) => a.account.code.localeCompare(b.account.code, undefined, { numeric: true }));
    for (const n of list) {
      n.depth = depth;
      sortAndDepth(n.children, depth + 1);
    }
  };
  sortAndDepth(roots, 0);
  return roots;
}

/** Filtra a árvore mantendo os ancestrais de cada correspondência (busca de `account-search`). */
export function filterTree(nodes: TreeNode[], term: string): TreeNode[] {
  if (!term.trim()) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const children = filterTree(n.children, term);
    const hit = accountMatches(n.account, term);
    if (hit || children.length > 0) out.push({ ...n, children: hit && children.length === 0 ? n.children : children });
  }
  return out;
}

/* =========================================================================
   Códigos
   ========================================================================= */

/** Código ocupado: já existe ou é prefixo hierárquico de outra conta. */
export function isCodeTaken(code: string, accounts: readonly ChartAccount[], excludeId?: string): boolean {
  return accounts.some((a) => a.id !== excludeId && (a.code === code || a.code.startsWith(`${code}.`)));
}

/** Próximo código disponível sob um pai (ex.: 4.1.02 → 4.1.02.004). */
export function suggestCode(parent: ChartAccount | undefined, accounts: readonly ChartAccount[]): string {
  if (!parent) return '';
  const prefix = `${parent.code}.`;
  const siblings = accounts
    .map((a) => a.code)
    .filter((c) => c.startsWith(prefix) && !c.slice(prefix.length).includes('.'))
    .map((c) => c.slice(prefix.length));
  const width = siblings[0]?.length ?? (parent.code.split('.').length >= 3 ? 3 : 2);
  let next = siblings.reduce((max, s) => Math.max(max, Number(s) || 0), 0) + 1;
  // Evita colidir com códigos já usados como prefixo (ex.: 1.1.02 quando existe 1.1.02.001).
  while (isCodeTaken(`${prefix}${String(next).padStart(width, '0')}`, accounts)) next++;
  return `${prefix}${String(next).padStart(width, '0')}`;
}

/**
 * Conta superior sugerida para uma nova conta analítica: o grupo sintético com mais contas
 * analíticas de resultado e, no empate, o mais específico (mais segmentos no código).
 */
export function defaultParent(accounts: readonly ChartAccount[]): ChartAccount | undefined {
  const parents = accounts.filter((a) => a.nature === 'SYNTHETIC');
  const analyticUnder = (p: ChartAccount) =>
    accounts.filter((a) => a.nature === 'ANALYTIC' && RESULT_TYPES.has(a.type) && a.code.startsWith(`${p.code}.`)).length;
  return [...parents].sort(
    (x, y) => analyticUnder(y) - analyticUnder(x) || y.code.split('.').length - x.code.split('.').length
  )[0];
}

/** Erro de código de uma conta (nova ou editada), ou null se estiver bom. `code` já sem espaços. */
export function codeError(
  code: string,
  accounts: readonly ChartAccount[],
  parent: ChartAccount | undefined,
  excludeId?: string
): string | null {
  if (isCodeTaken(code, accounts, excludeId)) return 'Código já utilizado.';
  if (parent && !code.startsWith(`${parent.code}.`)) return `Deve começar com ${parent.code}.`;
  return null;
}
