'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { BookRegistrationMethod } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { useClosingChecklist } from '@/hooks/fechamento/useClosingChecklist';
import { BOOK_METHOD_LABEL } from '@/lib/closing-checklist';
import type { CheckLevel, StatementCheck } from '@/lib/statement-checks';
import { formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => String(thisYear - i));

const ICON: Record<CheckLevel, React.ReactNode> = {
  block: <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
  info: <Info className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />,
  ok: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />,
};
const ORDER: Record<CheckLevel, number> = { block: 0, warn: 1, info: 2, ok: 3 };

/**
 * Fechamento do exercício: as conferências que o sistema faz sobre o balancete do ano, os itens
 * conferidos à mão e a comprovação da escrituração (ECD ou registro dos livros).
 */
export default function FechamentoPage() {
  const { currentClient } = useClient();
  const [year, setYear] = useState(String(thisYear - 1));
  const data = useClosingChecklist(currentClient ?? null, year);

  const checks = [...data.checks].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const pending = checks.filter((c) => c.level === 'block' || c.level === 'warn').length;
  const manualDone = data.items.filter((i) => data.checklist?.items[i.id]?.done).length;
  const booksDone = Boolean(data.checklist?.books?.date);

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Fechamento do exercício"
        description="Checklist do encerramento anual: o que o sistema confere sozinho no balancete, o que você confere com os documentos do cliente e a comprovação da escrituração."
        actions={
          <select aria-label="Exercício" value={year} onChange={(e) => setYear(e.target.value)} className={`${INPUT} h-9 w-32 font-mono tabular-nums text-[13px]`}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        }
      />
      {data.error && (
        <p role="alert" className="text-[13px] text-rose-600">
          {data.error}
        </p>
      )}

      {!data.ready ? (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
          <TableSkeleton rows={6} label="Conferindo o exercício…" />
        </section>
      ) : (
        <>
          <p className="text-[13px] text-stone-600 dark:text-stone-300">
            {pending === 0 ? 'Nenhuma pendência nas conferências automáticas' : `${pending} pendência(s) nas conferências automáticas`} · {manualDone} de {data.items.length} itens conferidos à mão ·{' '}
            {booksDone ? 'escrituração comprovada' : 'escrituração ainda não comprovada'}
          </p>

          <section aria-label="Conferências automáticas" className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <h2 className="px-5 pt-4 pb-2 text-[15px] font-semibold tracking-tight">Conferências automáticas</h2>
            <ul className="divide-y divide-black/4 dark:divide-white/6">
              {checks.map((c) => (
                <CheckRow
                  key={c.id}
                  check={c}
                  action={
                    (c.id === 'provision-term' && data.renames.provision.length > 0) || (c.id === 'disposal-term' && data.renames.disposal.length > 0) ? (
                      <button
                        type="button"
                        disabled={data.saving}
                        onClick={() => void data.applyRenames(c.id === 'provision-term' ? 'provision' : 'disposal')}
                        className={`${BUTTON.secondary} h-8 shrink-0`}
                      >
                        Renomear
                      </button>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          </section>

          <section aria-label="Conferências manuais" className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <h2 className="px-5 pt-4 pb-2 text-[15px] font-semibold tracking-tight">Conferidos com os documentos do cliente</h2>
            <ul className="divide-y divide-black/4 dark:divide-white/6">
              {data.items.map((item) => {
                const state = data.checklist?.items[item.id];
                return (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                    <input
                      id={`item-${item.id}`}
                      type="checkbox"
                      checked={Boolean(state?.done)}
                      disabled={data.saving}
                      onChange={(e) => void data.toggle(item.id, e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#B5552F]"
                    />
                    <label htmlFor={`item-${item.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block text-[13px] font-medium text-stone-800 dark:text-stone-100">{item.title}</span>
                      <span className="block text-[12px] text-stone-500">{item.hint}</span>
                    </label>
                    {state?.done && <span className="shrink-0 text-[11px] text-stone-400 font-mono tabular-nums">{formatDateBR(state.at.slice(0, 10))}</span>}
                  </li>
                );
              })}
            </ul>
          </section>

          <BooksSection
            key={`${currentClient?.id}|${year}|${data.checklist?.books?.method ?? ''}`}
            year={year}
            value={data.checklist?.books ?? null}
            saving={data.saving}
            onSave={(b) => void data.saveBooks(b)}
          />
        </>
      )}
    </main>
  );
}

function CheckRow({ check, action }: { check: StatementCheck; action?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 px-5 py-3">
      {ICON[check.level]}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-stone-800 dark:text-stone-100">{check.title}</p>
        {check.items && check.items.length > 0 && (
          <ul className="mt-0.5 space-y-0.5 text-[12px] text-stone-600 dark:text-stone-400">
            {check.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
      {action ??
        (check.href && check.linkLabel && check.level !== 'ok' && (
          <Link href={check.href} className="shrink-0 self-center text-[12px] font-medium text-accent-ink hover:underline">
            {check.linkLabel}
          </Link>
        ))}
    </li>
  );
}

/** ECD entregue ou livros registrados na Junta Comercial ou no cartório: a prova de que a contabilidade foi feita. */
function BooksSection({
  year,
  value,
  saving,
  onSave,
}: {
  year: string;
  value: { method: BookRegistrationMethod; date?: string; protocol?: string } | null;
  saving: boolean;
  onSave: (books: { method: BookRegistrationMethod; date?: string; protocol?: string } | null) => void;
}) {
  const [method, setMethod] = useState<BookRegistrationMethod | ''>(value?.method ?? '');
  const [date, setDate] = useState(value?.date ?? '');
  const [protocol, setProtocol] = useState(value?.protocol ?? '');
  const changed = method !== (value?.method ?? '') || date !== (value?.date ?? '') || protocol !== (value?.protocol ?? '');

  return (
    <section aria-label="Comprovação da escrituração" className={`${SURFACE} rounded-[22px] px-5 py-4 space-y-3`}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">Comprovação da escrituração de {year}</h2>
        <p className="text-[12px] text-stone-500">
          Empresas fora do Simples entregam a ECD. As do Simples podem entregar a ECD ou registrar o Livro Diário e as demonstrações na Junta Comercial ou no cartório, conforme
          onde a empresa foi registrada.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Como">
          <select value={method} onChange={(e) => setMethod(e.target.value as BookRegistrationMethod)} className={`${INPUT} ${method ? '' : 'text-stone-400'}`}>
            <option value="">Ainda não comprovada</option>
            {(Object.keys(BOOK_METHOD_LABEL) as BookRegistrationMethod[]).map((m) => (
              <option key={m} value={m}>
                {BOOK_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Data da entrega ou do registro">
          <input type="date" disabled={!method} value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
        </Field>
        <Field label="Recibo ou número do registro">
          <input disabled={!method} value={protocol} onChange={(e) => setProtocol(e.target.value)} className={INPUT} placeholder="opcional" />
        </Field>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving || !changed}
          onClick={() => onSave(method ? { method, ...(date ? { date } : {}), ...(protocol.trim() ? { protocol: protocol.trim() } : {}) } : null)}
          className={BUTTON.secondary}
        >
          Salvar
        </button>
      </div>
    </section>
  );
}
