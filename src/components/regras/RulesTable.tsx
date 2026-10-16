'use client';

import React from 'react';
import type { ClassificationRule, RuleMatchType } from '@/types/firestore';
import type { RuleConflict } from '@/lib/reconciliation';
import type { RuleListRow } from '@/hooks/regras/useRulesData';
import { RULE_SAMPLE_MONTHS } from '@/lib/services/reconciliation-service';
import { EmptyState, SURFACE } from '@/components/ui/primitives';
import { RuleRow } from '@/components/regras/RuleRow';
import { TableSkeleton } from '@/components/ui/Skeleton';

interface RulesTableProps {
  /** Motivo de a carga ter falhado, ou null. */
  loadFailure: string | null;
  isLoading: boolean;
  rows: readonly RuleListRow[];
  /** Total de regras do cliente, antes da busca. */
  ruleCount: number;
  search: string;
  memos: readonly string[];
  conflicts: ReadonlyMap<string, readonly RuleConflict[]>;
  rulesById: ReadonlyMap<string, ClassificationRule>;
  /** Regra sendo aplicada aos pendentes agora. */
  applyingId: string | null;
  isDuplicate: (key: string, exceptId: string) => boolean;
  onApply: (rule: ClassificationRule) => Promise<void>;
  onSave: (rule: ClassificationRule, pattern: string, matchType: RuleMatchType) => Promise<void>;
  onDelete: (rule: ClassificationRule) => Promise<void>;
}

/** Tabela de regras de aprendizado, com edição do termo, aplicação aos pendentes e exclusão. */
export function RulesTable({ loadFailure, isLoading, rows, ruleCount, search, memos, conflicts, rulesById, applyingId, isDuplicate, onApply, onSave, onDelete }: RulesTableProps) {
  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      {loadFailure ? (
        <p role="alert" className="px-5 py-10 text-center text-[13px] text-rose-600">
          Não foi possível carregar as regras ({loadFailure}). Recarregue a página para tentar de novo.
        </p>
      ) : isLoading ? (
        <TableSkeleton rows={5} label="Carregando regras…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={ruleCount === 0 ? 'Nenhuma regra ainda' : 'Nenhuma regra encontrada'}
          description={
            ruleCount === 0
              ? 'Adicione acima ou marque “Lembrar essa classificação” ao conciliar um lançamento.'
              : `Nada corresponde a “${search}”.`
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.04] dark:border-white/[0.06]">
                <th scope="col" className="font-medium pl-5 pr-3 py-2.5 w-[34%]">Termo</th>
                <th scope="col" className="font-medium px-3 py-2.5">Conta de destino</th>
                <th scope="col" className="font-medium px-3 py-2.5 w-32">Criada em</th>
                <th
                  scope="col"
                  title={`Pendentes de qualquer período e lançamentos dos últimos ${RULE_SAMPLE_MONTHS} meses`}
                  className="font-medium px-3 py-2.5 text-right w-44 whitespace-nowrap"
                >
                  Lançamentos afetados
                </th>
                <th scope="col" className="pl-3 pr-4 py-2.5 w-24">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rule, account, affected, pending, assessment }) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  assessment={assessment}
                  memos={memos}
                  account={account}
                  affected={affected}
                  pending={pending}
                  conflicts={conflicts.get(rule.id) ?? []}
                  rulesById={rulesById}
                  onApply={onApply}
                  applying={applyingId === rule.id}
                  isDuplicate={isDuplicate}
                  onSave={onSave}
                  onDelete={onDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
