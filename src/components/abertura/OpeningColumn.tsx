'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronDown, Landmark } from 'lucide-react';
import type { OpeningAccountRow, OpeningBankRow, OpeningPlugRow, OpeningRow, OpeningSection } from '@/lib/opening-view';
import { OPENING_ACCOUNT_CODE } from '@/lib/ledger';
import { isISODate } from '@/lib/periods';
import { formatDateBR } from '@/lib/utils/formatters';
import { AccountingAmount } from '@/components/ui/Amount';
import { SURFACE } from '@/components/ui/primitives';
import { AccountSelectField } from '@/components/ui/AccountCombobox';

/** Campo de valor compacto (o INPUT padrão tem 44px de altura, alto demais para uma lista de contas). */
const FIELD =
  'w-full h-8 px-2.5 rounded-lg bg-white/80 dark:bg-stone-800/70 border border-line-strong text-right font-mono tabular-nums text-[13px] text-stone-900 dark:text-stone-100 placeholder:text-stone-300 dark:placeholder:text-stone-600 outline-none transition-all duration-150 hover:border-black/[0.14] focus:border-accent/60 focus:bg-white dark:focus:bg-stone-800 focus:shadow-[0_0_0_3px_rgba(181,85,47,0.12)]';
const ROW = 'flex items-center gap-3 px-5 py-1 min-h-10';
const VALUE_BOX = 'w-36 shrink-0 text-right text-[13px]';

export interface OpeningColumnProps {
  title: string;
  total: number;
  sections: readonly OpeningSection[];
  frozen: boolean;
  /** Data da abertura (aviso de banco com saldo inicial em outra data). */
  date: string;
  values: Readonly<Record<string, string>>;
  invalid: ReadonlySet<string>;
  onValue: (accountId: string, text: string) => void;
  /** Saída do campo: formata o valor digitado. */
  onValueBlur: (accountId: string) => void;
  bankValues: Readonly<Record<string, string>>;
  bankInvalid: ReadonlySet<string>;
  onBankValue: (bankId: string, text: string) => void;
  onBankValueBlur: (bankId: string) => void;
  collapsed: ReadonlySet<string>;
  onToggle: (sectionKey: string) => void;
  /** Há busca: todas as seções abertas, sem o "+ adicionar conta". */
  searching: boolean;
  /** Conta escolhida no "+ adicionar conta" de uma seção. */
  onAdd: (accountId: string) => void;
}

/** Uma coluna do balanço de abertura: Ativo, ou Passivo e PL. */
export function OpeningColumn(props: OpeningColumnProps) {
  const { title, total, sections } = props;
  return (
    <section aria-label={title} className={`${SURFACE} min-w-0 rounded-[22px] overflow-hidden`}>
      <header className="flex items-baseline justify-between gap-3 px-5 py-4 border-b border-line">
        <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">{title}</h2>
        <AccountingAmount value={total} className="text-[15px] font-semibold text-stone-900 dark:text-stone-50" />
      </header>
      {sections.map((s) => (
        <SectionBlock key={s.key} section={s} {...props} />
      ))}
    </section>
  );
}

function SectionBlock({ section, collapsed, onToggle, searching, onAdd, ...rest }: OpeningColumnProps & { section: OpeningSection }) {
  const open = searching || !collapsed.has(section.key);
  const canAdd = !rest.frozen && !searching && section.addable.length > 0;
  const empty = rest.frozen ? 'Sem saldo.' : searching ? 'Nenhuma conta encontrada.' : canAdd ? null : 'Nenhuma conta neste grupo.';
  const bodyId = `opening-section-${section.key}`;
  return (
    <div className="border-b last:border-b-0 border-black/4 dark:border-white/6">
      <button
        type="button"
        onClick={() => onToggle(section.key)}
        aria-expanded={open}
        aria-controls={bodyId}
        disabled={searching}
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-black/2 dark:hover:bg-white/3 disabled:hover:bg-transparent transition-colors"
      >
        <ChevronDown className={`w-4 h-4 shrink-0 text-stone-400 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="flex-1 min-w-0 truncate text-[12px] font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-300">{section.title}</span>
        <AccountingAmount value={section.subtotal} zero="—" className="text-[13px] font-semibold text-stone-800 dark:text-stone-200" />
      </button>
      {open && (
        <div id={bodyId} className="pb-2">
          {section.groups.length === 0 ? (
            empty && <p className="px-5 pb-2 pl-11 text-[12px] text-stone-400">{empty}</p>
          ) : (
            section.groups.map((g) => (
              <div key={g.key}>
                {g.title && (
                  <div className="flex items-baseline justify-between gap-3 px-5 pl-11 pt-2 pb-0.5">
                    <span className="truncate text-[12px] font-medium text-stone-500">{g.title}</span>
                    <AccountingAmount value={g.subtotal} zero="—" className="text-[12px] text-stone-400" />
                  </div>
                )}
                <ul>
                  {g.rows.map((r) => (
                    <li key={r.key}>
                      <RowView row={r} {...rest} />
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {canAdd && (
            <div className="px-5 pl-11 pt-1.5 pb-1">
              <AccountSelectField
                accounts={section.addable}
                value=""
                onChange={onAdd}
                label={`Adicionar conta em ${section.title}`}
                placeholder="+ adicionar conta"
                className="w-64 max-w-full"
                triggerClassName="h-8"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type RowProps = Omit<OpeningColumnProps, 'title' | 'total' | 'sections' | 'collapsed' | 'onToggle' | 'searching' | 'onAdd'>;

function RowView({ row, ...rest }: RowProps & { row: OpeningRow }) {
  if (row.type === 'bank') return <BankRowView row={row} {...rest} />;
  if (row.type === 'plug') return <PlugRowView row={row} />;
  return <AccountRowView row={row} {...rest} />;
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <span className="w-20 shrink-0 font-mono tabular-nums text-[11px] text-stone-400">{children}</span>
);

function AccountRowView({ row, frozen, values, invalid, onValue, onValueBlur }: RowProps & { row: OpeningAccountRow }) {
  const { account, contra } = row;
  const bad = invalid.has(account.id);
  // Retificadora: o nome do modelo já começa com "(-)"; nas criadas sem ele, o sinal entra na frente.
  const name = contra && !/^\(\s*[-−]\s*\)/.test(account.name) ? `(−) ${account.name}` : account.name;
  return (
    <div className={`${ROW} pl-11`}>
      <Code>{account.code}</Code>
      <label htmlFor={`op-${account.id}`} title={account.name} className="flex-1 min-w-0 truncate text-[13px] text-stone-800 dark:text-stone-200">
        {name}
      </label>
      <div className={VALUE_BOX}>
        {frozen ? (
          <AccountingAmount value={row.value} zero="—" className="text-stone-700 dark:text-stone-300" />
        ) : (
          <div className="relative">
            {contra && (
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] text-stone-400">
                −
              </span>
            )}
            <input
              id={`op-${account.id}`}
              inputMode="decimal"
              value={values[account.id] ?? ''}
              onChange={(e) => onValue(account.id, e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => onValueBlur(account.id)}
              data-opening-field
              placeholder="0,00"
              aria-invalid={bad}
              title={contra ? 'Retificadora: informe o valor positivo; ele reduz o grupo.' : undefined}
              className={`${FIELD} ${contra ? 'pl-7' : ''} ${bad ? 'border-rose-300 dark:border-rose-500/25' : ''}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BankRowView({ row, frozen, date, bankValues, bankInvalid, onBankValue, onBankValueBlur }: RowProps & { row: OpeningBankRow }) {
  const { bank, ledger } = row;
  const bad = bankInvalid.has(bank.id);
  const moves = bank.openingDate && isISODate(date) && bank.openingDate !== date && bank.openingBalance !== undefined;
  return (
    <div className={`${ROW} pl-11`}>
      <span className="w-20 shrink-0 font-mono tabular-nums text-[11px] text-stone-400">{ledger?.code ?? ''}</span>
      <div className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <Landmark aria-hidden className="w-3.5 h-3.5 shrink-0 text-stone-400" />
          <label htmlFor={`bank-${bank.id}`} title={bank.nickname} className="truncate text-[13px] text-stone-800 dark:text-stone-200">
            {bank.nickname}
          </label>
          <span className="shrink-0 rounded-full bg-sky-50 dark:bg-sky-950/40 px-1.5 py-px text-[10px] font-medium text-sky-700 dark:text-sky-300">extrato</span>
        </span>
        {!ledger ? (
          <span className="block text-[11px] text-amber-700 dark:text-amber-400">
            Sem conta contábil vinculada.{' '}
            <Link href="/contas" className="font-medium underline-offset-2 hover:underline">
              Vincular em Contas e Extratos
            </Link>
          </span>
        ) : (
          moves && (
            <span className="block text-[11px] text-amber-700 dark:text-amber-400">
              Saldo hoje em {formatDateBR(bank.openingDate)}; passa a {formatDateBR(date)} ao salvar.
            </span>
          )
        )}
      </div>
      <div className={VALUE_BOX}>
        {frozen ? (
          <AccountingAmount value={row.value} zero="—" className="text-stone-700 dark:text-stone-300" />
        ) : (
          <input
            id={`bank-${bank.id}`}
            inputMode="decimal"
            value={bankValues[bank.id] ?? ''}
            onChange={(e) => onBankValue(bank.id, e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => onBankValueBlur(bank.id)}
            data-opening-field
            placeholder={bank.openingBalance === undefined ? 'não informado' : '0,00'}
            aria-invalid={bad}
            title="Saldo do extrato no início do dia da abertura; saldo devedor com sinal de menos."
            className={`${FIELD} ${bad ? 'border-rose-300 dark:border-rose-500/25' : ''}`}
          />
        )}
      </div>
    </div>
  );
}

function PlugRowView({ row }: { row: OpeningPlugRow }) {
  const { account, plug } = row;
  return (
    <div className={`${ROW} pl-11`}>
      <Code>{account?.code ?? OPENING_ACCOUNT_CODE}</Code>
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="truncate text-[13px] text-stone-800 dark:text-stone-200">{account?.name ?? 'Balanço de Abertura'}</span>
        <span
          title="Conta transitória: recebe sozinha a diferença entre ativo e passivo + PL, e o encerramento do exercício a zera contra Lucros ou Prejuízos Acumulados."
          className="shrink-0 rounded-full bg-black/5 dark:bg-white/8 px-1.5 py-px text-[10px] font-medium text-stone-500"
        >
          automática · transitória{account ? '' : ' · criada ao salvar'}
        </span>
      </span>
      <div className={VALUE_BOX}>
        <AccountingAmount value={row.value} className="text-stone-700 dark:text-stone-300" />
        <span className="sr-only">{plug.nature === 'C' ? ' credora' : ' devedora'}</span>
      </div>
    </div>
  );
}
