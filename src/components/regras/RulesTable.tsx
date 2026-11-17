'use client';

import { TABLE_HEAD, Th } from '@/components/ui/Table';
import type { BankAccount, ChartAccount, ClassificationRule } from '@/types/firestore';
import type { RuleConflict } from '@/lib/reconciliation';
import type { RuleListRow } from '@/hooks/regras/useRulesData';
import { RULE_SAMPLE_MONTHS } from '@/lib/services/reconciliation-service';
import { EmptyState, SURFACE } from '@/components/ui/primitives';
import { RuleRow, type RuleEdit } from '@/components/regras/RuleRow';
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
  analytic: readonly ChartAccount[];
  bankAccounts: readonly BankAccount[];
  /** Recorte ativo (além da busca), para a mensagem de lista vazia. */
  filtered?: boolean;
  canDelete?: (rule: ClassificationRule) => boolean;
  onApply: (rule: ClassificationRule) => Promise<void>;
  onSave: (rule: ClassificationRule, edit: RuleEdit) => Promise<void>;
  onDelete: (rule: ClassificationRule) => Promise<void>;
}

/** Tabela de regras de aprendizado, com edição do termo, aplicação aos pendentes e exclusão. */
export function RulesTable({ loadFailure, isLoading, rows, ruleCount, search, memos, conflicts, rulesById, applyingId, isDuplicate, analytic, bankAccounts, filtered = false, canDelete, onApply, onSave, onDelete }: RulesTableProps) {
  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      {loadFailure ? (
        <p role="alert" className="px-5 py-10 text-center text-[13px] text-rose-600 dark:text-rose-300">
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
              : search.trim()
                ? `Nada corresponde a “${search}”${filtered ? ' neste filtro' : ''}.`
                : 'Nenhuma regra neste filtro.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className={TABLE_HEAD}>
                <Th scope="col" edge="start" className="w-[34%]">Termo</Th>
                <Th scope="col">Conta de destino</Th>
                <Th scope="col" className="w-32">Criada em</Th>
                <Th
                  scope="col"
                  title={`Pendentes de qualquer período e lançamentos dos últimos ${RULE_SAMPLE_MONTHS} meses`}
                  align="right" className="w-44 whitespace-nowrap"
                >
                  Lançamentos afetados
                </Th>
                <Th scope="col" className="pl-3 pr-4 py-2.5 w-24">
                  <span className="sr-only">Ações</span>
                </Th>
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
                  analytic={analytic}
                  bankAccounts={bankAccounts}
                  canDelete={canDelete ? canDelete(rule) : true}
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
