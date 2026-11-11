'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import type { BankAccount, ChartAccount } from '@/types/firestore';
import { buildImport, importTargets, matchTrialBalance, parseTrialBalanceText, type ImportResult, type ImportRow, type ImportStatus } from '@/lib/opening-import';
import { formatCurrency } from '@/lib/utils/formatters';
import { AccountSelectField } from '@/components/ui/AccountCombobox';
import { BUTTON, Sheet } from '@/components/ui/primitives';

interface PasteTrialBalanceSheetProps {
  accounts: readonly ChartAccount[];
  banks: readonly BankAccount[];
  onApply: (result: ImportResult) => void;
  onClose: () => void;
}

const STATUS: Record<Exclude<ImportStatus, 'ignored'>, { label: string; dot: string }> = {
  matched: { label: 'Casada', dot: 'bg-emerald-500' },
  suggested: { label: 'Conferir', dot: 'bg-amber-500' },
  unmatched: { label: 'Sem conta', dot: 'bg-rose-500' },
};

const EXAMPLE = `Código    Conta                      Saldo atual
1.1.1.01  Caixa                      1.200,00 D
1.1.2.01  Clientes                   3.200,00 D
2.3.1.01  Capital Subscrito         10.000,00 C`;

const lineValue = (r: ImportRow) => (r.amount === null ? '—' : `${r.negative && !r.side ? '−' : ''}${formatCurrency(r.amount)}${r.side ? ` ${r.side}` : ''}`);

/**
 * Colar o balancete do contador anterior (Excel ou PDF): lê, casa as linhas com o plano e mostra
 * para conferir antes de preencher os campos da abertura. Não grava nada.
 */
export function PasteTrialBalanceSheet({ accounts, banks, onApply, onClose }: PasteTrialBalanceSheetProps) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const targets = useMemo(() => importTargets(accounts, banks), [accounts, banks]);
  const result = useMemo(() => (rows ? buildImport(rows, accounts, banks) : null), [rows, accounts, banks]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);

  const read = () => setRows(matchTrialBalance(parseTrialBalanceText(text), accounts, banks));
  const update = (line: number, patch: Partial<ImportRow>) => setRows((prev) => prev?.map((r) => (r.line === line ? { ...r, ...patch } : r)) ?? prev);
  const choose = (line: number, accountId: string) => update(line, { accountId, status: 'matched', reason: 'Escolhida por você.' });

  const included = rows?.filter((r) => r.status !== 'ignored') ?? [];
  const ignored = rows?.filter((r) => r.status === 'ignored') ?? [];
  const count = (s: ImportStatus) => rows?.filter((r) => r.status === s).length ?? 0;
  const withoutAccount = included.filter((r) => !r.accountId).length;
  const resultWithBalance = ignored.filter((r) => /resultado/.test(r.reason) && r.amount);
  const filled = result ? result.values.size + result.bankValues.size : 0;
  const unbalanced = result ? Math.abs(result.debits - result.credits) >= 0.005 : false;

  const footer = !rows ? (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className={BUTTON.ghost}>
        Cancelar
      </button>
      <button type="button" onClick={read} disabled={!text.trim()} className={BUTTON.accent}>
        Ler balancete
      </button>
    </div>
  ) : (
    <div className="space-y-3">
      {result && result.used > 0 && (
        <p className={`text-[12px] ${unbalanced ? 'text-amber-700 dark:text-amber-400' : 'text-stone-500'}`}>
          Linhas incluídas: débitos {formatCurrency(result.debits)} · créditos {formatCurrency(result.credits)}
          {unbalanced ? ` · diferença de ${formatCurrency(Math.abs(result.debits - result.credits))}: confira se faltou alguma linha.` : ' · fecham.'}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {withoutAccount > 0 && <span className="mr-auto text-[12px] text-stone-500">{withoutAccount} linha(s) sem conta não entram.</span>}
        <button type="button" onClick={() => setRows(null)} className={BUTTON.ghost}>
          Voltar ao texto
        </button>
        <button type="button" disabled={filled === 0} onClick={() => result && onApply(result)} className={BUTTON.accent}>
          Preencher {filled} conta(s)
        </button>
      </div>
    </div>
  );

  return (
    <Sheet
      title="Colar balancete"
      subtitle={
        rows
          ? `${count('matched')} casada(s) · ${count('suggested')} para conferir · ${count('unmatched')} sem conta · ${ignored.length} fora`
          : 'Do Excel ou copiado do PDF do contador anterior. Nada é salvo até você clicar em Salvar na tela.'
      }
      onClose={onClose}
      footer={footer}
      size="lg"
    >
      {!rows ? (
        <div className="space-y-3 pb-3">
          <textarea
            aria-label="Balancete colado"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
            spellCheck={false}
            autoFocus
            className="w-full h-72 p-3.5 rounded-xl bg-white/80 dark:bg-stone-800/70 border border-line-strong font-mono text-[12px] leading-relaxed text-stone-900 dark:text-stone-100 placeholder:text-stone-400 outline-none focus:border-accent/60"
          />
          <ul className="space-y-1 text-[12px] text-stone-500 list-disc pl-5">
            <li>Uma conta por linha: código (se houver), nome e saldo. Com várias colunas de valor, vale a do saldo atual (ou a última).</li>
            <li>D ou C ao lado do valor dá a natureza. Sem D/C, vale o lado normal da conta; valor negativo ou entre parênteses, o contrário.</li>
            <li>Grupos, totais e contas de resultado ficam de fora sozinhos. As contas que já têm valor e aparecem no balancete são substituídas.</li>
          </ul>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-stone-500">Nenhuma linha com conta e saldo no texto colado.</p>
      ) : (
        <div className="space-y-4 pb-3">
          {resultWithBalance.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-950/30 text-[12px] text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
              {resultWithBalance.length} conta(s) de resultado com saldo ficaram de fora. Na data de implantação, o resultado anterior já deve estar em Lucros ou Prejuízos
              Acumulados: confira se o balancete é de depois do encerramento.
            </p>
          )}
          {result && result.inverted.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-950/30 text-[12px] text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
              Saldo contrário à natureza, que a abertura não aceita (lance por lançamento manual):{' '}
              {result.inverted.map((i) => `${byId.get(i.accountId)?.code} ${byId.get(i.accountId)?.name} (${formatCurrency(i.amount)})`).join(', ')}.
            </p>
          )}

          <ul className="divide-y divide-black/5 dark:divide-white/6 rounded-2xl border border-line bg-white/60 dark:bg-stone-900/40">
            {included.map((r) => (
              <li key={r.line} className="flex items-center gap-3 px-3.5 py-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS[r.status as Exclude<ImportStatus, 'ignored'>].dot}`} title={STATUS[r.status as Exclude<ImportStatus, 'ignored'>].label} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[13px] text-stone-800 dark:text-stone-200" title={r.raw}>
                    {r.code && <span className="mr-1.5 font-mono text-[11px] text-stone-400">{r.code}</span>}
                    {r.name || <span className="text-stone-400">(sem nome)</span>}
                  </p>
                  {r.status !== 'matched' && <p className="text-[11px] text-stone-500">{r.reason}</p>}
                </div>
                <span className="w-36 shrink-0 text-right font-mono tabular-nums text-[12px] text-stone-700 dark:text-stone-300">{lineValue(r)}</span>
                <AccountSelectField
                  accounts={targets}
                  value={r.accountId ?? ''}
                  onChange={(id) => choose(r.line, id)}
                  label={`Conta do plano para ${r.name || r.code || `a linha ${r.line}`}`}
                  placeholder="Escolher conta…"
                  className="w-72 shrink-0"
                  triggerClassName="h-8"
                  align="end"
                />
                <button
                  type="button"
                  onClick={() => update(r.line, { status: 'ignored', reason: 'Retirada por você.' })}
                  aria-label={`Deixar de fora ${r.name || `a linha ${r.line}`}`}
                  title="Deixar de fora"
                  className="w-7 h-7 shrink-0 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-black/5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
            {included.length === 0 && <li className="px-3.5 py-3 text-[12px] text-stone-500">Nenhuma linha incluída.</li>}
          </ul>

          {ignored.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowIgnored((v) => !v)}
                aria-expanded={showIgnored}
                className="flex items-center gap-1.5 text-[12px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showIgnored ? '' : '-rotate-90'}`} />
                {ignored.length} linha(s) fora: grupos, totais, resultado, zeradas
              </button>
              {showIgnored && (
                <ul className="mt-2 divide-y divide-black/5 dark:divide-white/6 rounded-2xl border border-line">
                  {ignored.map((r) => (
                    <li key={r.line} className="flex items-center gap-3 px-3.5 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[12px] text-stone-600 dark:text-stone-400" title={r.raw}>
                          {r.code && <span className="mr-1.5 font-mono text-[11px] text-stone-400">{r.code}</span>}
                          {r.name}
                        </p>
                        <p className="text-[11px] text-stone-400">{r.reason}</p>
                      </div>
                      <span className="w-36 shrink-0 text-right font-mono tabular-nums text-[12px] text-stone-400">{lineValue(r)}</span>
                      {r.amount ? (
                        <AccountSelectField
                          accounts={targets}
                          value=""
                          onChange={(id) => choose(r.line, id)}
                          label={`Incluir ${r.name || `a linha ${r.line}`} numa conta`}
                          placeholder="Incluir em…"
                          className="w-72 shrink-0"
                          triggerClassName="h-8"
                          align="end"
                        />
                      ) : (
                        <span className="w-72 shrink-0" />
                      )}
                      <span className="w-7 shrink-0" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
