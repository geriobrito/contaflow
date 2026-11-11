'use client';

import { ChevronRight, Pencil, Trash2 } from 'lucide-react';
import type { ChartAccount } from '@/types/firestore';
import { dreLabel, TYPE_LABEL, type TreeNode } from '@/lib/chart/tree';
import { ConfirmButton } from '@/components/ui/primitives';

interface AccountTreeRowProps {
  node: TreeNode;
  expanded: (code: string) => boolean;
  onToggle: (code: string) => void;
  onEdit: (account: ChartAccount, hasChildren: boolean) => void;
  onDelete: (account: ChartAccount) => void;
  isAdmin: boolean;
}

/** Linha da árvore do plano de contas; desenha os filhos abertos logo abaixo. */
export function AccountTreeRow({ node, expanded, onToggle, onEdit, onDelete, isAdmin }: AccountTreeRowProps) {
  const { account, depth, children } = node;
  const hasChildren = children.length > 0;
  const open = expanded(account.code);
  const synthetic = account.nature === 'SYNTHETIC';
  const canDelete = isAdmin && !synthetic && !hasChildren && account.clientId !== 'global';

  return (
    <>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={false}
        aria-expanded={hasChildren ? open : undefined}
        className={`group flex items-center gap-2 pr-3 border-b border-black/4 dark:border-white/5 ${
          depth === 0 ? 'py-3 bg-stone-900/2 dark:bg-white/2' : 'py-2'
        }`}
        style={{ paddingLeft: 12 + depth * 22 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(account.code)}
          aria-label={hasChildren ? (open ? `Recolher ${account.name}` : `Expandir ${account.name}`) : undefined}
          tabIndex={hasChildren ? 0 : -1}
          className={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-stone-400 ${
            hasChildren ? 'hover:bg-black/5 active:scale-[0.92] transition-all duration-150' : 'invisible'
          }`}
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </button>

        <span className={`w-32 shrink-0 font-mono tabular-nums text-[12px] ${synthetic ? 'text-stone-500' : 'text-stone-400'}`}>
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

        <span className="flex items-center gap-1.5 shrink-0">
          {account.isContra && (
            <span className="inline px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-500/25">
              Redutora
            </span>
          )}
          {!synthetic && account.clientId === 'global' && (
            <span className="inline px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-accent/[0.07] text-accent-ink border border-accent/25">
              Compartilhada
            </span>
          )}
        </span>

        {/* Colunas de detalhe */}
        <span className="block w-28 shrink-0 text-[12px] text-stone-500">
          {depth === 0 ? (
            <span className="font-medium text-stone-600 dark:text-stone-300">{TYPE_LABEL[account.type]}</span>
          ) : synthetic ? (
            'Sintética'
          ) : (
            <span className="inline-flex px-2 py-0.5 rounded-full bg-stone-900/5 dark:bg-white/8 text-stone-700 dark:text-stone-300">
              Analítica
            </span>
          )}
        </span>
        <span className="block w-56 xl:w-64 shrink-0 truncate text-[12px] text-stone-500">
          {!synthetic ? dreLabel(account) ?? <span className="text-stone-300 dark:text-stone-600">Patrimonial</span> : null}
        </span>

        <span className="w-16 shrink-0 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onEdit(account, hasChildren)}
            aria-label={`Editar ${account.name}`}
            className="w-7 h-7 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/8 active:scale-[0.94] transition-all duration-150"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {canDelete && (
            <ConfirmButton
              ariaLabel={`Excluir ${account.name}`}
              label={<Trash2 className="w-3.5 h-3.5" />}
              confirmLabel="Excluir"
              onConfirm={() => onDelete(account)}
            />
          )}
        </span>
      </div>
      {hasChildren &&
        open &&
        children.map((c) => (
          <AccountTreeRow
            key={c.account.id}
            node={c}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            isAdmin={isAdmin}
          />
        ))}
    </>
  );
}
