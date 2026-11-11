'use client';

import { TABLE_HEAD, Th } from '@/components/ui/Table';
import React from 'react';
import { Car, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import type { FixedAsset } from '@/types/firestore';
import type { FixedAssetContext } from '@/lib/services/fixed-asset-service';
import { assetPositionAt, DISPOSAL_REASON_LABEL, isAssetFrozen, monthlyQuotaCents, postedQuotaCents } from '@/lib/fixed-assets';
import { fromCents } from '@/lib/money';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, ConfirmButton, EmptyState, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

const NUM = 'px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap';

/** Bens da empresa na posição do fim de `month`: custo, cota, acumulada e valor líquido. */
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
}: {
  ctx: FixedAssetContext | null;
  assets: readonly FixedAsset[];
  month: string;
  busy: boolean;
  onCreate: () => void;
  onEdit: (asset: FixedAsset) => void;
  onDispose: (asset: FixedAsset) => void;
  onUndoDisposal: (asset: FixedAsset) => void;
  onDelete: (asset: FixedAsset) => void;
}) {
  const sorted = [...assets].sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }) || a.inUseDate.localeCompare(b.inUseDate));
  const rows = ctx
    ? sorted.map((a) => ({ asset: a, pos: assetPositionAt(a, month, ctx.implantationMonth), quota: postedQuotaCents(a, month, ctx.implantationMonth) }))
    : [];
  const total = rows.reduce((t, r) => ({ cost: t.cost + r.pos.costCents, acc: t.acc + r.pos.accumulatedCents, quota: t.quota + r.quota }), { cost: 0, acc: 0, quota: 0 });

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
        <Car className="w-4 h-4 text-stone-400" />
        <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Bens</h2>
        {ctx && (
          <button type="button" onClick={onCreate} className={`${BUTTON.secondary} h-8`}>
            <Plus className="w-3.5 h-3.5" />
            Novo bem
          </button>
        )}
      </div>
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
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className={TABLE_HEAD}>
                <Th edge="start">Bem</Th>
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
                return (
                  <tr key={a.id} className={`border-b border-black/4 last:border-0 text-[13px] ${gone ? 'text-stone-400' : ''}`}>
                    <td className="pl-5 pr-3 py-3">
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
                      <button type="button" onClick={() => onEdit(a)} aria-label={`Editar ${a.description}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 active:scale-[0.94] transition-all">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {a.disposal ? (
                        <button type="button" disabled={busy} onClick={() => onUndoDisposal(a)} aria-label={`Desfazer a baixa de ${a.description}`} title="Desfazer a baixa" className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 active:scale-[0.94] transition-all">
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <>
                          <button type="button" disabled={busy} onClick={() => onDispose(a)} className="h-8 px-2.5 rounded-full text-[12px] font-medium text-stone-500 hover:text-stone-800 hover:bg-black/5 active:scale-[0.97] transition-all">
                            Baixar
                          </button>
                          {!frozen && <ConfirmButton ariaLabel={`Excluir ${a.description}`} label={<Trash2 className="w-3.5 h-3.5" />} confirmLabel="Excluir" onConfirm={() => onDelete(a)} />}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-black/8 text-[13px] font-semibold">
                <td className="pl-5 pr-3 py-3" colSpan={2}>
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
