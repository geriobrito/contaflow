'use client';

import React, { useMemo, useState } from 'react';
import { TABLE_HEAD, Th } from '@/components/ui/Table';
import { Car, ChevronDown, ChevronRight, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import type { FixedAsset } from '@/types/firestore';
import type { FixedAssetContext } from '@/lib/services/fixed-asset-service';
import {
  assetCostCents,
  assetPositionAt,
  depreciationSchedule,
  DISPOSAL_REASON_LABEL,
  isAssetFrozen,
  monthlyQuotaCents,
  postedQuotaCents,
} from '@/lib/fixed-assets';
import { fromCents } from '@/lib/money';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, ConfirmButton, EmptyState, INPUT_COMPACT, SearchField, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

const NUM = 'px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap';
const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

export type AssetStatusFilter = 'ALL' | 'ACTIVE' | 'DISPOSED';

export interface FixedAssetsTableProps {
  ctx: FixedAssetContext | null;
  assets: readonly FixedAsset[];
  month: string;
  busy: boolean;
  onCreate: () => void;
  onEdit: (asset: FixedAsset) => void;
  onDispose: (asset: FixedAsset) => void;
  onUndoDisposal: (asset: FixedAsset) => void;
  onDelete: (asset: FixedAsset) => void;
}

/** Bens da empresa na posição do fim de `month`: custo, cota, acumulada, valor líquido, filtros e cronograma. */
export function FixedAssetsTable({
  ctx,
  assets,
  month,
  busy,
  onCreate,
  onEdit,
  onDispose,
  onUndoDisposal,
  onDelete,
}: FixedAssetsTableProps) {
  const [statusFilter, setStatusFilter] = useState<AssetStatusFilter>('ALL');
  const [accountFilter, setAccountFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...assets].sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }) || a.inUseDate.localeCompare(b.inUseDate)),
    [assets]
  );

  const allRows = useMemo(
    () =>
      ctx
        ? sorted.map((a) => ({
            asset: a,
            pos: assetPositionAt(a, month, ctx.implantationMonth),
            quota: postedQuotaCents(a, month, ctx.implantationMonth),
          }))
        : [],
    [ctx, sorted, month]
  );

  const counts = useMemo(() => {
    let active = 0;
    let disposed = 0;
    for (const r of allRows) {
      if (r.asset.disposal) disposed++;
      else active++;
    }
    return { all: allRows.length, active, disposed };
  }, [allRows]);

  const distinctAccounts = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of sorted) {
      if (!map.has(a.accountCode)) map.set(a.accountCode, a.accountName ?? a.accountCode);
    }
    return [...map.entries()];
  }, [sorted]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter(({ asset }) => {
      if (statusFilter === 'ACTIVE' && asset.disposal) return false;
      if (statusFilter === 'DISPOSED' && !asset.disposal) return false;
      if (accountFilter !== 'ALL' && asset.accountCode !== accountFilter) return false;
      if (q) {
        const hay = `${asset.description} ${asset.accountCode} ${asset.accountName ?? ''} ${asset.documentRef ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, statusFilter, accountFilter, search]);

  const total = rows.reduce((t, r) => ({ cost: t.cost + r.pos.costCents, acc: t.acc + r.pos.accumulatedCents, quota: t.quota + r.quota }), { cost: 0, acc: 0, quota: 0 });

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
        <Car className="w-4 h-4 text-stone-400" />
        <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Bens</h2>
        {ctx && (
          <button type="button" onClick={onCreate} className={`${BUTTON.secondary} h-8`}>
            <Plus className="w-3.5 h-3.5" />
            Novo bem
          </button>
        )}
      </div>

      {ctx && assets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 px-5 py-3 border-b border-black/4 dark:border-white/6 bg-black/[0.015] dark:bg-white/[0.015]">
          <SegmentedControl<AssetStatusFilter>
            ariaLabel="Filtrar bens por situação"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'ALL', label: `Todos (${counts.all})` },
              { value: 'ACTIVE', label: `Em uso (${counts.active})` },
              { value: 'DISPOSED', label: `Baixados (${counts.disposed})` },
            ]}
          />
          {distinctAccounts.length > 1 && (
            <select
              aria-label="Filtrar por conta do bem"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className={`${INPUT_COMPACT} max-w-[240px]`}
            >
              <option value="ALL">Todas as classes ({distinctAccounts.length})</option>
              {distinctAccounts.map(([code, name]) => (
                <option key={code} value={code}>
                  {code} · {name}
                </option>
              ))}
            </select>
          )}
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Buscar bem, conta ou NF…"
            className="w-full sm:w-64 sm:ml-auto"
          />
        </div>
      )}

      {!ctx ? (
        <TableSkeleton rows={3} label="Carregando bens…" />
      ) : assets.length === 0 ? (
        <EmptyState
          title="Nenhum bem cadastrado"
          description="Cadastre os bens do imobilizado e do intangível: a depreciação de cada mês passa a ser calculada e lançada pelo sistema."
          action={
            <button type="button" onClick={onCreate} className={BUTTON.accent}>
              <Plus className="w-4 h-4" />
              Cadastrar o primeiro bem
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-stone-500">Nenhum bem corresponde aos filtros selecionados.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className={TABLE_HEAD}>
                <Th className="w-10" />
                <Th>Bem</Th>
                <Th>Em uso desde</Th>
                <Th align="right">Custo</Th>
                <Th align="right">Taxa</Th>
                <Th align="right">Cota do mês</Th>
                <Th align="right">Acumulada</Th>
                <Th align="right">Valor líquido</Th>
                <Th edge="end" className="w-28"><span className="sr-only">Ações</span></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ asset: a, pos, quota }) => {
                const gone = pos.costCents === 0 && Boolean(a.disposal);
                const frozen = isAssetFrozen(a, ctx.lockedMonths, ctx.implantationMonth);
                const expanded = expandedId === a.id;
                const costCents = assetCostCents(a);
                let runningAcc = 0;
                const schedule = expanded
                  ? depreciationSchedule(a, ctx.implantationMonth).map((q) => {
                      runningAcc += q.cents;
                      return { ...q, accumulatedCents: runningAcc, netCents: Math.max(0, costCents - runningAcc) };
                    })
                  : [];
                return (
                  <React.Fragment key={a.id}>
                    <tr className={`border-b border-black/4 dark:border-white/6 last:border-0 text-[13px] ${gone ? 'text-stone-400' : ''}`}>
                      <td className="pl-3 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : a.id)}
                          aria-label={expanded ? 'Recolher cotas' : `Ver cotas de ${a.description}`}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-black/5 dark:hover:bg-white/8"
                        >
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="pr-3 py-3">
                        <p className="font-medium text-stone-900 dark:text-stone-100">{a.description}</p>
                        <p className="text-[11px] text-stone-500 dark:text-stone-400">
                          <span className="font-mono">{a.accountCode}</span> {a.accountName}
                          {a.documentRef ? ` · NF ${a.documentRef}` : ''} · {a.use === 'COST' ? 'custo' : 'despesa'}
                        </p>
                        {a.disposal && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            Baixado em {formatDateBR(a.disposal.date)} por {DISPOSAL_REASON_LABEL[a.disposal.reason]}
                            {a.disposal.sale ? ` (${formatCurrency(a.disposal.sale.amount)})` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono tabular-nums text-[12px] whitespace-nowrap">{formatDateBR(a.inUseDate)}</td>
                      <td className={NUM}>{gone ? '—' : formatCurrency(fromCents(pos.costCents))}</td>
                      <td className={NUM}>{a.annualRate.toLocaleString('pt-BR')}%</td>
                      <td className={NUM} title={`Cota de um mês cheio: ${formatCurrency(fromCents(monthlyQuotaCents(a)))}`}>
                        {quota ? formatCurrency(fromCents(quota)) : '—'}
                      </td>
                      <td className={NUM}>{gone ? '—' : formatCurrency(fromCents(pos.accumulatedCents))}</td>
                      <td className={NUM}>{gone ? '—' : formatCurrency(fromCents(pos.netCents))}</td>
                      <td className="pl-3 pr-5 py-3 text-right whitespace-nowrap">
                        <button type="button" onClick={() => onEdit(a)} aria-label={`Editar ${a.description}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 dark:hover:bg-white/8 active:scale-[0.94] transition-all">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {a.disposal ? (
                          <button type="button" disabled={busy} onClick={() => onUndoDisposal(a)} aria-label={`Desfazer a baixa de ${a.description}`} title="Desfazer a baixa" className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 dark:hover:bg-white/8 active:scale-[0.94] transition-all">
                            <Undo2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <>
                            <button type="button" disabled={busy} onClick={() => onDispose(a)} className="h-8 px-2.5 rounded-full text-[12px] font-medium text-stone-500 hover:text-stone-800 hover:bg-black/5 dark:hover:bg-white/8 active:scale-[0.97] transition-all">
                              Baixar
                            </button>
                            {!frozen && <ConfirmButton ariaLabel={`Excluir ${a.description}`} label={<Trash2 className="w-3.5 h-3.5" />} confirmLabel="Excluir" onConfirm={() => onDelete(a)} />}
                          </>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-black/4 dark:border-white/6 bg-black/2 dark:bg-white/2">
                        <td colSpan={9} className="px-5 py-3">
                          {schedule.length === 0 ? (
                            <p className="text-[12px] text-stone-500">Este bem não gera cotas mensais (taxa 0%).</p>
                          ) : (
                            <div className="max-h-64 overflow-y-auto">
                              <table aria-label={`Cotas de ${a.description}`} className="w-full text-left text-[12px]">
                                <thead>
                                  <tr className={TABLE_HEAD}>
                                    <Th className="py-1.5">Competência</Th>
                                    <Th className="py-1.5">Origem</Th>
                                    <Th align="right" className="py-1.5">Cota</Th>
                                    <Th align="right" className="py-1.5">Acumulada</Th>
                                    <Th align="right" className="py-1.5">Valor líquido</Th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {schedule.map((q) => (
                                    <tr key={q.month} className={`border-t border-black/4 dark:border-white/6 ${q.month === month ? 'font-semibold bg-accent/6' : ''}`}>
                                      <td className="py-1.5 font-mono tabular-nums">{competence(q.month)}</td>
                                      <td className="py-1.5 text-stone-500">{q.posted ? 'Rotina mensal' : 'Saldo anterior / abertura'}</td>
                                      <td className="py-1.5 text-right font-mono tabular-nums">{formatCurrency(fromCents(q.cents))}</td>
                                      <td className="py-1.5 text-right font-mono tabular-nums">{formatCurrency(fromCents(q.accumulatedCents))}</td>
                                      <td className="py-1.5 text-right font-mono tabular-nums">{formatCurrency(fromCents(q.netCents))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-black/8 dark:border-white/10 text-[13px] font-semibold">
                <td className="pl-5 pr-3 py-3" colSpan={3}>
                  Total
                </td>
                <td className={NUM}>{formatCurrency(fromCents(total.cost))}</td>
                <td />
                <td className={NUM}>{formatCurrency(fromCents(total.quota))}</td>
                <td className={NUM}>{formatCurrency(fromCents(total.acc))}</td>
                <td className={NUM}>{formatCurrency(fromCents(total.cost - total.acc))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
