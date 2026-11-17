'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import type { ChartAccount } from '@/types/firestore';
import { REGISTER_CONTROL_HREF, REGISTER_CONTROL_LABEL, type OpeningRegisterCheck } from '@/lib/opening-registers';
import { fromCents } from '@/lib/money';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, CardHeader, SURFACE } from '@/components/ui/primitives';

interface RegisterCheckCardProps {
  checks: readonly OpeningRegisterCheck[];
  accountsById: ReadonlyMap<string, ChartAccount>;
  /** Contas que a tela deixa editar (analíticas, patrimoniais e sem banco vinculado). */
  editable: ReadonlySet<string>;
  frozen: boolean;
  /** Troca o valor das contas pelo do cadastro (reais). */
  onUse: (amounts: ReadonlyMap<string, number>) => void;
}

const money = (cents: number) => formatCurrency(fromCents(cents));

/**
 * Cadastros de Bens e Contratos × balanço de abertura: o que cada cadastro diz que já existia na
 * data da abertura, o valor informado e a diferença, com o atalho de usar o valor do cadastro.
 */
export function RegisterCheckCard({ checks, accountsById, editable, frozen, onUse }: RegisterCheckCardProps) {
  const [showOk, setShowOk] = useState(false);
  const fixable = (c: OpeningRegisterCheck) => !frozen && c.status === 'diverges' && c.accountId !== null && editable.has(c.accountId);
  const problems = checks.filter((c) => c.status !== 'ok');
  const ok = checks.filter((c) => c.status === 'ok');
  const toFix = checks.filter(fixable);
  const use = (list: readonly OpeningRegisterCheck[]) => onUse(new Map(list.map((c) => [c.accountId!, fromCents(c.expectedCents)] as const)));
  const shown = showOk ? checks : problems;

  return (
    <section aria-label="Conferência com Bens e Contratos" className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      <CardHeader
        icon={ClipboardCheck}
        title="Conferência com Bens e Contratos"
        meta={problems.length ? `${problems.length} conta(s) a conferir` : 'Tudo confere'}
        iconClassName={problems.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}
        actions={
          toFix.length > 1 ? (
            <button type="button" onClick={() => use(toFix)} className={`${BUTTON.secondary} h-8 px-3 text-[12px]`}>
              Usar os valores dos cadastros ({toFix.length})
            </button>
          ) : undefined
        }
      />
      <p className="px-5 pt-3 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
        O que os cadastros dizem que já existia antes da abertura precisa estar nela: bens e depreciação acumulada, apólices a apropriar,
        saldo dos contratos e o saldo das aplicações e do estoque no fim do mês anterior. Diferença aqui reaparece na conciliação de cada
        controle com o balancete.
      </p>
      {shown.length > 0 && (
        <ul className="mt-2 divide-y divide-black/4 dark:divide-white/5">
          {shown.map((c) => {
            const account = c.accountId ? accountsById.get(c.accountId) : undefined;
            const diff = c.enteredCents - c.expectedCents;
            return (
              <li key={c.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
                <span className="w-5 shrink-0">
                  {c.status === 'ok' ? (
                    <CheckCircle2 aria-label="Confere" className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle aria-label="A conferir" className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  )}
                </span>
                <div className="min-w-0 flex-1 basis-[260px]">
                  <p className="truncate text-stone-900 dark:text-stone-100">
                    <span className="font-mono tabular-nums text-[12px] text-stone-500 dark:text-stone-400 mr-1.5">{c.accountCode}</span>
                    {account?.name ?? 'Conta fora do plano'}
                  </p>
                  <p className="text-[12px] text-stone-500 dark:text-stone-400">
                    <Link href={REGISTER_CONTROL_HREF[c.control]} className="hover:underline underline-offset-2">
                      {REGISTER_CONTROL_LABEL[c.control]}
                    </Link>
                    {c.parts.length > 0 && ` · ${c.parts.join(' · ')}`}
                    {c.status === 'missing-account' && ' · a conta não existe no plano: complete-o com o modelo em Plano de Contas'}
                    {c.status === 'unregistered' && ' · saldo na abertura sem bem cadastrado: sem o cadastro, a depreciação não é lançada'}
                  </p>
                </div>
                <dl className="flex items-baseline gap-4 font-mono tabular-nums text-[12.5px]">
                  <div className="text-right">
                    <dt className="font-sans text-[10.5px] text-stone-500 dark:text-stone-400">Cadastro</dt>
                    <dd className="text-stone-800 dark:text-stone-200">{c.status === 'unregistered' ? '—' : money(c.expectedCents)}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="font-sans text-[10.5px] text-stone-500 dark:text-stone-400">Abertura</dt>
                    <dd className="text-stone-800 dark:text-stone-200">{money(c.enteredCents)}</dd>
                  </div>
                  <div className="text-right w-28">
                    <dt className="font-sans text-[10.5px] text-stone-500 dark:text-stone-400">Diferença</dt>
                    <dd className={diff === 0 ? 'text-stone-500' : 'text-amber-700 dark:text-amber-400'}>{diff === 0 ? '—' : money(diff)}</dd>
                  </div>
                </dl>
                <span className="w-44 shrink-0 text-right">
                  {fixable(c) ? (
                    <button type="button" onClick={() => use([c])} className={`${BUTTON.ghost} h-8 px-3 text-[12px] text-accent-ink`}>
                      Usar o do cadastro
                    </button>
                  ) : c.status === 'unregistered' ? (
                    <Link href={REGISTER_CONTROL_HREF.depreciation} className="text-[12px] font-medium text-accent-ink hover:underline">
                      Cadastrar os bens →
                    </Link>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {ok.length > 0 && (
        <button
          type="button"
          onClick={() => setShowOk((v) => !v)}
          className="w-full px-5 py-2.5 border-t border-line text-left text-[12px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
        >
          {showOk ? 'Mostrar só o que falta conferir' : `${ok.length} conta(s) conferem com os cadastros · mostrar`}
        </button>
      )}
    </section>
  );
}
