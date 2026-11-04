'use client';

import { AlertTriangle } from 'lucide-react';
import type { CompanyPorte, TaxRegime } from '@/types/firestore';
import { FIELD_LABEL, type FieldChange } from '@/lib/cnpj-review';
import type { PendingLookup } from '@/hooks/clientes/useCnpjLookup';
import { PORTE_LABEL } from '@/lib/accounting-standard';
import { regimeLabel } from '@/components/clientes/options';
import { BUTTON } from '@/components/ui/primitives';

const shown = (c: FieldChange, value: string) =>
  !value ? '(vazio)' : c.field === 'regime' ? regimeLabel(value as TaxRegime) : c.field === 'porte' ? PORTE_LABEL[value as CompanyPorte] : value;

/** Pergunta antes de usar a resposta da Receita: CNPJ de outra empresa ou lista do que vai mudar. */
export function CnpjReviewPanel({ pending, onAccept, onDismiss }: { pending: PendingLookup; onAccept: () => void; onDismiss: () => void }) {
  const { review, inactiveStatus } = pending;
  const otherCompany = review.kind === 'other-company' || review.otherCompany;

  return (
    <div role="alertdialog" aria-labelledby="cnpj-review-title" className="rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20 p-3.5 space-y-2.5 animate-fade-in">
      <p id="cnpj-review-title" className="flex items-center gap-1.5 text-[13px] font-medium text-amber-900 dark:text-amber-200">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {otherCompany ? 'Este CNPJ é de outra empresa?' : 'Atualizar o cadastro pela Receita?'}
      </p>

      {review.kind === 'other-company' ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-stone-500">Na Receita</dt>
          <dd className="font-medium text-stone-800 dark:text-stone-100">
            {review.receitaName}
            {review.receitaCity && <span className="font-normal text-stone-500"> · {review.receitaCity}</span>}
          </dd>
          <dt className="text-stone-500">Você digitou</dt>
          <dd className="text-stone-800 dark:text-stone-100">{review.typed}</dd>
        </dl>
      ) : (
        <ul className="space-y-1 text-[12px]">
          {review.changes.map((c) => (
            <li key={c.field} className="text-stone-700 dark:text-stone-300">
              <span className="text-stone-500">{FIELD_LABEL[c.field]}:</span> {shown(c, c.from)} <span className="text-stone-400">→</span>{' '}
              <span className="font-medium text-stone-900 dark:text-stone-100">{shown(c, c.to)}</span>
            </li>
          ))}
        </ul>
      )}

      {otherCompany && <p className="text-[12px] text-amber-800 dark:text-amber-300">Confira os dígitos do CNPJ: um número trocado leva ao cadastro de outra empresa.</p>}
      {inactiveStatus && <p className="text-[12px] text-amber-800 dark:text-amber-300">Situação cadastral na Receita: “{inactiveStatus}”.</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAccept} className={`${BUTTON.primary} h-9 px-3.5`}>
          {review.kind === 'other-company' ? 'Usar dados da Receita' : 'Aplicar alterações'}
        </button>
        <button type="button" onClick={onDismiss} className={`${BUTTON.secondary} h-9 px-3.5`}>
          {review.kind === 'other-company' ? 'Manter o que digitei' : 'Cancelar'}
        </button>
      </div>
    </div>
  );
}
