'use client';

import React, { useState } from 'react';
import type { DREStatement as DREData } from '@/lib/dre/build';
import { EmptyState, SURFACE } from '@/components/ui/primitives';
import { Amount, GrossRevenueContext, Pct, Row, Section } from '@/components/dre/DREStatementParts';
import { StatementSkeleton } from '@/components/ui/Skeleton';

interface DREStatementProps {
  dre: DREData;
  failed: boolean;
  isLoading: boolean;
  hasData: boolean;
  profit: boolean;
}

/** Demonstrativo no layout da NBC TG 1002: grupos recolhíveis com o detalhe por conta e a análise vertical. */
export function DREStatement({ dre, failed, isLoading, hasData, profit }: DREStatementProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  const isOpen = (id: string) => !collapsed[id];
  return (
    <GrossRevenueContext.Provider value={dre.grossRevenue}>
      {/* Demonstrativo */}
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <div className="flex items-baseline gap-3 px-5 py-3 border-b border-black/[0.05] dark:border-white/[0.06] text-[11px] uppercase tracking-wider text-stone-400">
          <span className="flex-1">Demonstrativo</span>
          <span className="hidden md:inline w-20 text-right">% RB</span>
          <span className="w-36 xl:w-44 text-right">R$</span>
        </div>

        {failed ? (
          <EmptyState title="DRE indisponível" description="Os dados não puderam ser carregados. Corrija o erro indicado acima e recarregue a página." />
        ) : isLoading ? (
          <StatementSkeleton rows={12} label="Carregando DRE…" />
        ) : !hasData ? (
          <EmptyState title="Sem lançamentos conciliados" description="Não há movimentação conciliada neste período." />
        ) : (
          <div className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            <Section
              id="rob"
              label="Receita operacional bruta"
              value={dre.grossRevenue}
              parts={[{ lines: dre.sections.GROSS_REVENUE.lines, sign: 1 }]}
              open={isOpen('rob')}
              onToggle={toggle}
            />
            <Section
              id="ded"
              label="(−) Deduções da receita bruta"
              value={-dre.deductions}
              parts={[{ lines: dre.sections.DEDUCTIONS.lines, sign: -1 }]}
              open={isOpen('ded')}
              onToggle={toggle}
            />
            <Row label="(=) Receita operacional líquida" value={dre.netRevenue} variant="subtotal" />
            <Section
              id="cus"
              label="(−) Custos das vendas"
              value={-dre.costs}
              parts={[{ lines: dre.sections.COSTS.lines, sign: -1 }]}
              open={isOpen('cus')}
              onToggle={toggle}
            />
            <Row label="(=) Lucro bruto" value={dre.grossProfit} variant="subtotal" />
            <Section
              id="dop"
              label="(−) Despesas operacionais"
              value={-dre.operatingExpenses}
              parts={[{ lines: dre.sections.OPERATING_EXPENSES.lines, sign: -1 }]}
              open={isOpen('dop')}
              onToggle={toggle}
            />
            <Section
              id="fin"
              label="(+/−) Resultado financeiro líquido"
              value={dre.financialResult}
              parts={[
                { lines: dre.sections.FINANCIAL_INCOME.lines, sign: 1 },
                { lines: dre.sections.FINANCIAL_EXPENSES.lines, sign: -1 },
              ]}
              open={isOpen('fin')}
              onToggle={toggle}
            />
            <Section
              id="out"
              label="(+/−) Outras receitas e despesas operacionais"
              value={dre.otherResult}
              parts={[
                { lines: dre.sections.OTHER_INCOME.lines, sign: 1 },
                { lines: dre.sections.OTHER_EXPENSES.lines, sign: -1 },
              ]}
              open={isOpen('out')}
              onToggle={toggle}
            />
            {dre.sections.INCOME_TAXES.lines.length > 0 && (
              <Section
                id="ir"
                label="(−) IRPJ e CSLL"
                value={-dre.incomeTaxes}
                parts={[{ lines: dre.sections.INCOME_TAXES.lines, sign: -1 }]}
                open={isOpen('ir')}
                onToggle={toggle}
              />
            )}

            <div
              className={`flex items-baseline gap-3 px-5 py-4 ${
                profit ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : 'bg-rose-50/60 dark:bg-rose-950/20'
              }`}
            >
              <span className="flex-1 text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
                (=) Resultado líquido do exercício
              </span>
              <Pct value={dre.netResult} strong />
              <span className={`w-36 xl:w-44 text-right text-[15px] ${profit ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                <Amount value={dre.netResult} strong />
              </span>
            </div>
          </div>
        )}
      </section>
    </GrossRevenueContext.Provider>
  );
}
