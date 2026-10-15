'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, RotateCcw } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { useExplanatoryNotes } from '@/hooks/notas/useExplanatoryNotes';
import { accountingStandard } from '@/lib/accounting-standard';
import { placeholdersIn } from '@/lib/notes';
import { describeError } from '@/lib/utils/errors';
import { BUTTON, EmptyState, Field, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { AccountantNotice } from '@/components/ui/AccountantNotice';

const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => String(thisYear - i));

const SAVE_LABEL = { idle: null, saving: 'Salvando…', saved: 'Salvo', local: 'Guardado só neste navegador' } as const;

/**
 * Notas explicativas do exercício: blocos de texto-padrão (contexto, base de preparação pela
 * norma do porte, práticas contábeis, patrimônio líquido com os saldos de 31/12, CBS/IBS no
 * regime normal, eventos subsequentes) para revisar, completar e gerar em PDF com as
 * assinaturas. O texto é gravado por empresa e exercício (ver `useExplanatoryNotes`).
 */
export default function NotasPage() {
  const { currentClient } = useClient();
  const [year, setYear] = useState(String(thisYear - 1));
  const { list, figures, org, saveState, remote, error: saveError, update, restore } = useExplanatoryNotes(currentClient ?? null, year);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = useMemo(() => (list ?? []).filter((n) => n.enabled).flatMap((n) => placeholdersIn(n.text)), [list]);

  const exportPdf = async () => {
    if (!currentClient || !list) return;
    setExporting(true);
    setError(null);
    try {
      const [{ generateNotesPdf }, { downloadBlob }] = await Promise.all([import('@/lib/export/notes-pdf'), import('@/lib/export/dre-rows')]);
      const { blob, fileName } = generateNotesPdf({
        client: currentClient,
        year,
        notes: list,
        signatories: {
          legalRepresentative: { name: currentClient.legalRepresentativeName, cpf: currentClient.legalRepresentativeCpf },
          accountant: org ? { name: org.accountantName, crc: org.accountantCrc } : undefined,
        },
      });
      downloadBlob(blob, fileName);
    } catch (e) {
      setError(`Não foi possível gerar o PDF (${describeError(e)}).`);
    } finally {
      setExporting(false);
    }
  };

  const saveLabel = saveState === 'saved' ? (remote ? 'Salvo para a empresa (visto em qualquer aparelho do escritório)' : 'Salvo (modo local)') : SAVE_LABEL[saveState];

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Notas explicativas"
        description={
          <>
            Textos-padrão das notas às demonstrações do exercício, pela {currentClient ? accountingStandard(currentClient) : 'norma do porte'}. Revise, complete os
            trechos entre colchetes e gere o PDF. As edições são gravadas para a empresa e o exercício.
          </>
        }
        actions={
          <button type="button" disabled={!list || exporting} onClick={() => void exportPdf()} className={BUTTON.primary}>
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" strokeWidth={1.75} />}
            {exporting ? 'Gerando…' : 'Gerar PDF'}
          </button>
        }
      />

      {(error ?? saveError) && <p role="alert" className="text-[13px] text-rose-600">{error ?? saveError}</p>}

      <AccountantNotice org={org} ready={Boolean(list)} />

      {!currentClient ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Nenhuma empresa selecionada" description="Escolha a empresa em Clientes para preparar as notas." />
        </section>
      ) : !list ? (
        <p className="py-16 text-center text-[13px] text-stone-400">Carregando…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Exercício">
              <select value={year} onChange={(e) => setYear(e.target.value)} className={`${INPUT} w-36 font-mono tabular-nums`}>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
            {saveLabel && (
              <p role="status" className={`flex items-center gap-1.5 pb-2 text-[12px] ${saveState === 'local' ? 'text-amber-700' : 'text-stone-500'}`}>
                {saveState === 'saved' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                {saveLabel}
              </p>
            )}
            {pending.length > 0 && (
              <p role="status" className="flex items-start gap-2 pb-2 text-[13px] text-amber-700">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {pending.length} trecho(s) entre colchetes ainda por preencher nas notas selecionadas.
              </p>
            )}
          </div>
          {!figures && (
            <p className="text-[12px] text-stone-500">Sem os saldos de {year} (plano de contas vazio ou falha de leitura): a nota de patrimônio líquido fica com campos a preencher.</p>
          )}

          {list.map((n, i) => {
            const order = list.slice(0, i + 1).filter((x) => x.enabled).length;
            return (
              <section key={n.id} className={`${SURFACE} rounded-[22px] p-5 space-y-3 ${n.enabled ? '' : 'opacity-60'}`} aria-label={n.title}>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-[13px] text-stone-600">
                    <input type="checkbox" checked={n.enabled} onChange={(e) => update(n.id, { enabled: e.target.checked })} />
                    {n.enabled ? `Nota ${order}` : 'Fora do PDF'}
                  </label>
                  <input
                    aria-label="Título da nota"
                    value={n.title}
                    onChange={(e) => update(n.id, { title: e.target.value })}
                    className={`${INPUT} h-9 flex-1 min-w-[12rem] text-[14px] font-semibold`}
                  />
                  <button type="button" onClick={() => restore(n.id)} className={`${BUTTON.secondary} h-9`} title="Voltar ao texto-padrão desta nota, com os saldos do exercício">
                    <RotateCcw className="w-3.5 h-3.5" /> Texto-padrão
                  </button>
                </div>
                <textarea
                  aria-label={`Texto da nota ${n.title}`}
                  value={n.text}
                  onChange={(e) => update(n.id, { text: e.target.value })}
                  rows={Math.min(12, Math.max(4, Math.ceil(n.text.length / 110) + n.text.split('\n').length))}
                  className="w-full px-3.5 py-3 rounded-xl bg-white/80 dark:bg-stone-800/70 border border-black/[0.08] dark:border-white/[0.10] text-[13px] leading-relaxed outline-none focus:border-[#0071E3]/60 focus:shadow-[0_0_0_4px_rgba(0,113,227,0.12)]"
                />
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
