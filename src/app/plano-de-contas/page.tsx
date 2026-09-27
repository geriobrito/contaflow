'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, Trash2, Wand2 } from 'lucide-react';
import type { AccountType, ChartAccount, DREGroup } from '@/types/firestore';
import { applyDefaultChartTemplate, deleteAccount, getAccounts, saveAccount } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import {
  BUTTON,
  ConfirmButton,
  EmptyState,
  Field,
  INPUT,
  PageHeader,
  SearchField,
  Sheet,
  SURFACE,
} from '@/components/ui/primitives';

/* =========================================================================
   Rótulos
   ========================================================================= */

const TYPE_LABEL: Record<AccountType, string> = {
  ASSET: 'Ativo',
  ATIVO: 'Ativo',
  LIABILITY: 'Passivo',
  EQUITY: 'Patrimônio líquido',
  PASSIVO: 'Passivo',
  COST: 'Custo',
  CUSTO: 'Custo',
  EXPENSE: 'Despesa',
  DESPESA: 'Despesa',
  REVENUE: 'Receita',
  RECEITA: 'Receita',
};

const DRE_GROUPS: readonly { value: DREGroup; label: string }[] = [
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

/** Grupo da DRE sugerido para uma nova conta: o do pai ou o das contas irmãs. */
function inheritedDREGroup(parent: ChartAccount | undefined, accounts: readonly ChartAccount[]): DREGroup | '' {
  if (!parent) return '';
  if (parent.dreGroup) return parent.dreGroup;
  const sibling = accounts.find((a) => a.parentId === parent.id && a.dreGroup) ??
    accounts.find((a) => a.code.startsWith(`${parent.code}.`) && a.dreGroup);
  return sibling?.dreGroup ?? '';
}

const RESULT_TYPES: ReadonlySet<AccountType> = new Set(['REVENUE', 'RECEITA', 'EXPENSE', 'DESPESA', 'COST', 'CUSTO']);

/* =========================================================================
   Árvore (hierarquia inferida pelo código: 1 › 1.1 › 1.1.01 › 1.1.01.001)
   ========================================================================= */

interface TreeNode {
  account: ChartAccount;
  depth: number;
  children: TreeNode[];
}

function buildTree(accounts: readonly ChartAccount[]): TreeNode[] {
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

/** Filtra a árvore mantendo os ancestrais de cada correspondência. */
function filterTree(nodes: TreeNode[], term: string): TreeNode[] {
  if (!term) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const children = filterTree(n.children, term);
    const hit = `${n.account.code} ${n.account.name}`.toLowerCase().includes(term);
    if (hit || children.length > 0) out.push({ ...n, children: hit && children.length === 0 ? n.children : children });
  }
  return out;
}

/** Próximo código disponível sob um pai (ex.: 4.1.02 → 4.1.02.004). */
function suggestCode(parent: ChartAccount | undefined, accounts: readonly ChartAccount[]): string {
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

/** Código ocupado: já existe ou é prefixo hierárquico de outra conta. */
function isCodeTaken(code: string, accounts: readonly ChartAccount[]): boolean {
  return accounts.some((a) => a.code === code || a.code.startsWith(`${code}.`));
}

/* =========================================================================
   Linha da árvore
   ========================================================================= */

interface TreeRowProps {
  node: TreeNode;
  expanded: (code: string) => boolean;
  onToggle: (code: string) => void;
  onDelete: (account: ChartAccount) => void;
}

function TreeRow({ node, expanded, onToggle, onDelete }: TreeRowProps) {
  const { account, depth, children } = node;
  const hasChildren = children.length > 0;
  const open = expanded(account.code);
  const synthetic = account.nature === 'SYNTHETIC';

  return (
    <>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={false}
        aria-expanded={hasChildren ? open : undefined}
        className={`group flex items-center gap-2 pr-3 border-b border-black/[0.04] dark:border-white/[0.05] ${
          depth === 0 ? 'py-3 bg-stone-900/[0.02] dark:bg-white/[0.02]' : 'py-2'
        }`}
        style={{ paddingLeft: 12 + depth * 22 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(account.code)}
          aria-label={hasChildren ? (open ? `Recolher ${account.name}` : `Expandir ${account.name}`) : undefined}
          tabIndex={hasChildren ? 0 : -1}
          className={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-stone-400 ${
            hasChildren ? 'hover:bg-black/[0.05] active:scale-[0.92] transition-all duration-150' : 'invisible'
          }`}
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </button>

        <span className={`w-24 shrink-0 font-mono tabular-nums text-[12px] ${synthetic ? 'text-stone-500' : 'text-stone-400'}`}>
          {account.code}
        </span>
        <span
          className={`flex-1 min-w-0 truncate tracking-tight ${
            depth === 0
              ? 'text-[14px] font-semibold text-stone-900 dark:text-stone-50'
              : synthetic
                ? 'text-[13px] font-medium text-stone-800 dark:text-stone-200'
                : 'text-[13px] text-stone-600 dark:text-stone-400'
          }`}
        >
          {account.name}
        </span>

        {depth === 0 && <span className="hidden sm:inline text-[11px] text-stone-400">{TYPE_LABEL[account.type]}</span>}
        {account.isContra && (
          <span className="hidden sm:inline px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200/60">
            Redutora
          </span>
        )}
        {!synthetic && account.clientId === 'global' && (
          <span className="hidden sm:inline px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-[#0071E3] border border-blue-200/60">
            Compartilhada
          </span>
        )}
        {!synthetic && !hasChildren && (
          <span className="sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <ConfirmButton
              ariaLabel={`Excluir ${account.name}`}
              label={<Trash2 className="w-3.5 h-3.5" />}
              confirmLabel="Excluir"
              onConfirm={() => onDelete(account)}
            />
          </span>
        )}
      </div>
      {hasChildren &&
        open &&
        children.map((c) => <TreeRow key={c.account.id} node={c} expanded={expanded} onToggle={onToggle} onDelete={onDelete} />)}
    </>
  );
}

/* =========================================================================
   Sheet lateral "Nova conta"
   ========================================================================= */

interface NewAccountSheetProps {
  accounts: ChartAccount[];
  clientId: string;
  onClose: () => void;
  onCreated: () => void;
}

function NewAccountSheet({ accounts, clientId, onClose, onCreated }: NewAccountSheetProps) {
  const parents = useMemo(() => accounts.filter((a) => a.nature === 'SYNTHETIC'), [accounts]);
    const initialParent = useMemo(() => {
    const analyticUnder = (p: ChartAccount) =>
      accounts.filter((a) => a.nature === 'ANALYTIC' && RESULT_TYPES.has(a.type) && a.code.startsWith(`${p.code}.`)).length;
    // Grupo mais específico (mais segmentos) entre os que concentram mais contas analíticas de resultado.
    return [...parents].sort(
      (x, y) => analyticUnder(y) - analyticUnder(x) || y.code.split('.').length - x.code.split('.').length
    )[0];
  }, [parents, accounts]);

  const [parentId, setParentId] = useState<string>(initialParent?.id ?? '');
  const [code, setCode] = useState(() => suggestCode(initialParent, accounts));
  const [name, setName] = useState('');
  const [dreGroup, setDreGroup] = useState<DREGroup | ''>(() => inheritedDREGroup(initialParent, accounts));
  const [saving, setSaving] = useState(false);

  const parent = parents.find((p) => p.id === parentId);
  const trimmed = code.trim();
  const codeError = !trimmed
    ? null
    : isCodeTaken(trimmed, accounts)
      ? 'Código já utilizado.'
      : parent && !trimmed.startsWith(`${parent.code}.`)
        ? `Deve começar com ${parent.code}.`
        : null;
  const valid = Boolean(parent && name.trim() && trimmed && !codeError);

  const handleParent = (id: string) => {
    const p = parents.find((x) => x.id === id);
    setParentId(id);
    setCode(suggestCode(p, accounts));
    setDreGroup(inheritedDREGroup(p, accounts));
  };

  const submit = async () => {
    if (!parent || !valid) return;
    setSaving(true);
    const now = new Date().toISOString();
    try {
      await saveAccount({
        id: `acc-${Date.now()}`,
        clientId,
        code: trimmed,
        name: name.trim(),
        type: parent.type,
        nature: 'ANALYTIC',
        parentId: parent.id,
        level: parent.level + 1,
        dreGroup: dreGroup || undefined,
        createdAt: now,
        updatedAt: now,
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      side="right"
      title="Nova conta analítica"
      subtitle="Contas analíticas recebem lançamentos na conciliação."
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!valid || saving}
          onClick={() => void submit()}
          className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
        >
          {saving ? 'Salvando…' : 'Criar conta'}
        </button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Conta superior">
          <select value={parentId} onChange={(e) => handleParent(e.target.value)} className={INPUT}>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {'  '.repeat(p.code.split('.').length - 1)}
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Código" error={codeError} hint={parent ? `Tipo herdado: ${TYPE_LABEL[parent.type]}` : undefined}>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
        </Field>

        <Field label="Nome">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Energia elétrica" className={INPUT} />
        </Field>

        {parent && RESULT_TYPES.has(parent.type) && (
          <Field label="Grupo na DRE">
            <select value={dreGroup} onChange={(e) => setDreGroup(e.target.value as DREGroup | '')} className={INPUT}>
              <option value="">Não informado</option>
              {DRE_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Sheet>
  );
}

/* =========================================================================
   Página
   ========================================================================= */

export default function PlanoDeContasPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;

  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const list = await getAccounts(id);
    setAccounts(list);
    setLoadedFor(id);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getAccounts(clientId)
      .then((list) => {
        if (!active) return;
        setAccounts(list);
        setLoadedFor(clientId);
      })
      .catch((e) => console.error('Erro ao carregar plano de contas:', e));
    return () => {
      active = false;
    };
  }, [clientId]);

  const tree = useMemo(() => buildTree(accounts), [accounts]);
  const term = search.trim().toLowerCase();
  const visible = useMemo(() => filterTree(tree, term), [tree, term]);

  const analyticCount = accounts.filter((a) => a.nature === 'ANALYTIC').length;
  const isLoading = Boolean(clientId) && loadedFor !== clientId;
  const isEmpty = !isLoading && accounts.length === 0;

  const expanded = useCallback((code: string) => Boolean(term) || !collapsed[code], [collapsed, term]);
  const toggle = (code: string) => setCollapsed((prev) => ({ ...prev, [code]: !prev[code] }));

  const handleDelete = async (account: ChartAccount) => {
    await deleteAccount(account.id);
    if (clientId) await load(clientId);
  };

  const handleApplyTemplate = async () => {
    if (!clientId) return;
    setApplying(true);
    try {
      const created = await applyDefaultChartTemplate(clientId);
      await load(clientId);
      setNotice(created > 0 ? `${created} contas do plano ITG 1000 adicionadas.` : 'O plano já contém todas as contas da ITG 1000.');
    } catch {
      setNotice('Não foi possível aplicar o plano ITG 1000.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-8">
      <PageHeader
        eyebrow={currentClient?.name}
        title="Plano de contas"
        description={
          <>
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{accounts.length}</span> contas ·{' '}
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{analyticCount}</span> analíticas disponíveis
            para classificação.
          </>
        }
        actions={
          <>
            {isEmpty && (
              <button type="button" onClick={() => void handleApplyTemplate()} disabled={applying} className={BUTTON.secondary}>
                <Wand2 className="w-4 h-4" strokeWidth={1.75} />
                {applying ? 'Aplicando…' : 'Aplicar plano ITG 1000 (2022)'}
              </button>
            )}
            <button type="button" onClick={() => setSheetOpen(true)} disabled={isEmpty || !clientId} className={BUTTON.primary}>
              <Plus className="w-4 h-4" strokeWidth={2} />
              Nova conta
            </button>
          </>
        }
      />

      {notice && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-white/70 dark:bg-stone-900/60 border border-black/[0.06] text-[13px] text-stone-600 dark:text-stone-300 animate-fade-in">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="text-[#0071E3] font-medium">
            OK
          </button>
        </div>
      )}

      <SearchField value={search} onChange={setSearch} placeholder="Buscar por código ou nome da conta" />

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        {isLoading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-4 rounded bg-black/[0.05] animate-pulse" style={{ marginLeft: (i % 4) * 22 }} />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            title="Plano de contas vazio"
            description="Aplique o modelo para microentidades da ITG 1000 (CFC, 15/12/2022 — NBC TG 1002, Anexo 11), já amarrado à DRE."
            action={
              <button type="button" onClick={() => void handleApplyTemplate()} disabled={applying} className={BUTTON.accent}>
                <Wand2 className="w-4 h-4" />
                {applying ? 'Aplicando…' : 'Aplicar plano ITG 1000 (2022)'}
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState title="Nenhuma conta encontrada" description={`Nada corresponde a “${search}”.`} />
        ) : (
          <div role="tree" aria-label="Plano de contas" className="[&>*:last-child]:border-b-0">
            {visible.map((n) => (
              <TreeRow key={n.account.id} node={n} expanded={expanded} onToggle={toggle} onDelete={(a) => void handleDelete(a)} />
            ))}
          </div>
        )}
      </section>

      {sheetOpen && clientId && (
        <NewAccountSheet
          accounts={accounts}
          clientId={clientId}
          onClose={() => setSheetOpen(false)}
          onCreated={() => {
            setSheetOpen(false);
            void load(clientId);
          }}
        />
      )}
    </main>
  );
}
