'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Check } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { useSetupSteps } from '@/hooks/useSetupSteps';
import { nextSetupStep, type SetupStatus } from '@/lib/setup-steps';

const MARK: Record<SetupStatus, string> = {
  done: 'bg-emerald-500 text-white border-transparent',
  todo: 'bg-surface text-amber-800 dark:text-amber-300 border-amber-400 dark:border-amber-500/70',
  hint: 'bg-surface text-stone-500 dark:text-stone-400 border-line-strong',
};
const STATUS_LABEL: Record<SetupStatus, string> = { done: 'pronto', todo: 'falta fazer', hint: 'a completar' };

/**
 * Faixa de implantação no topo das telas de Cadastros: os passos na ordem do menu, o que falta
 * em cada um e o próximo a fazer. Com tudo pronto, some: empresa implantada não precisa dela.
 */
export function SetupProgress() {
  const pathname = usePathname();
  const { currentClient } = useClient();
  const steps = useSetupSteps(currentClient);
  const next = steps ? nextSetupStep(steps) : null;
  if (!steps || !next) return null;

  const done = steps.filter((s) => s.status === 'done').length;
  const here = steps.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
  // Na tela do próprio passo, a faixa diz o que falta nele; nas outras, aponta o próximo.
  const focus = here && here.status !== 'done' ? here : next;
  const elsewhere = focus.href !== here?.href;

  return (
    <section aria-label="Implantação da empresa" className="rounded-2xl border border-line bg-surface px-4 py-3 space-y-2.5 print:hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[12px] font-medium text-stone-600 dark:text-stone-300 whitespace-nowrap">
          Implantação de {currentClient?.tradeName || currentClient?.name}
          <span className="ml-2 font-mono tabular-nums text-stone-500 dark:text-stone-400">
            {done}/{steps.length}
          </span>
        </p>
        <ol className="flex flex-wrap items-center gap-1.5">
          {steps.map((s, i) => {
            const current = s.href === here?.href;
            return (
              <li key={s.key}>
                <Link
                  href={s.href}
                  title={s.detail}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 h-7 pl-1 pr-2.5 rounded-full border text-[12px] transition-colors hover:bg-black/3 dark:hover:bg-white/5 ${
                    current ? 'border-stone-400/80 dark:border-white/30 font-medium text-stone-900 dark:text-stone-100' : 'border-transparent text-stone-600 dark:text-stone-300'
                  }`}
                >
                  <span aria-hidden className={`w-5 h-5 rounded-full border inline-flex items-center justify-center text-[10.5px] font-semibold font-mono ${MARK[s.status]}`}>
                    {s.status === 'done' ? <Check className="w-3 h-3" strokeWidth={2.75} /> : i + 1}
                  </span>
                  {s.label}
                  <span className="sr-only"> ({STATUS_LABEL[s.status]})</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
      <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] ${focus.status === 'todo' ? 'text-amber-800 dark:text-amber-300' : 'text-stone-600 dark:text-stone-300'}`}>
        <span className="font-medium">{elsewhere ? `Próximo: ${focus.label}.` : 'Nesta tela:'}</span>
        <span className="min-w-0">{focus.detail}</span>
        {elsewhere && (
          <Link href={focus.href} className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline whitespace-nowrap">
            Abrir <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </p>
    </section>
  );
}
