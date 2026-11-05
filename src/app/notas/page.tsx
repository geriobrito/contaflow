'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSignature, FileText, Loader2, RotateCcw } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { useExplanatoryNotes } from '@/hooks/notas/useExplanatoryNotes';
import { accountingStandard, porteOf } from '@/lib/accounting-standard';
import { noteIssue, placeholdersIn } from '@/lib/notes';
import { letterGaps } from '@/lib/responsibility-letter';
import { describeError } from '@/lib/utils/errors';
import { BUTTON, EmptyState, Field, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { useSignatureReminder } from '@/hooks/useSignatureReminder';
import { TextSkeleton } from '@/components/ui/Skeleton';

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
  const [letterBusy, setLetterBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signature = useSignatureReminder(org);

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
      signature.remind();
    } catch (e) {
      setError(`Não foi possível gerar o PDF (${describeError(e)}).`);
    } finally {
      setExporting(false);
    }
  };

  /** Carta de responsabilidade do exercício: texto-padrão, assinada pelo representante legal. */
  const exportLetter = async () => {
    if (!currentClient) return;
    setLetterBusy(true);
    setError(null);
    try {
      const [{ generateResponsibilityLetterPdf }, { downloadBlob }] = await Promise.all([
        import('@/lib/export/responsibility-letter-pdf'),
        import('@/lib/export/dre-rows'),
      ]);
      const { blob, fileName } = generateResponsibilityLetterPdf({ client: currentClient, org, year });
      downloadBlob(blob, fileName);
    } catch (e) {
      setError(`Não foi possível gerar a carta (${describeError(e)}).`);
    } finally {
      setLetterBusy(false);
    }
  };
  const gaps = currentClient ? letterGaps(currentClient, org) : [];

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

      {!currentClient ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Nenhuma empresa selecionada" description="Escolha a empresa em Clientes para preparar as notas." />
        </section>
      ) : !list ? (
        <section className={`${SURFACE} rounded-[22px] p-6`}>
          <TextSkeleton paragraphs={3} label="Carregando notas explicativas…" />
        </section>
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
            const issue = noteIssue(n, porteOf(currentClient), figures);
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
                    className={`${INPUT} h-9 flex-1 min-w-48 text-[14px] font-semibold`}
                  />
                  <button type="button" onClick={() => restore(n.id)} className={`${BUTTON.secondary} h-9`} title="Voltar ao texto-padrão desta nota, com os saldos do exercício">
                    <RotateCcw className="w-3.5 h-3.5" /> Texto-padrão
                  </button>
                </div>
                {issue && (
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 bg-amber-50 dark:bg-amber-950/30 text-[13px] text-amber-800 dark:text-amber-300">
                    <span className="flex items-start gap-2 min-w-0">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      {issue}
                    </span>
                    <button
                      type="button"
                      onClick={() => restore(n.id)}
                      title="Substitui o texto desta nota pelo texto-padrão atualizado"
                      className="shrink-0 font-medium text-accent-ink hover:underline"
                    >
                      Usar o texto atualizado
                    </button>
                  </div>
                )}
                <textarea
                  aria-label={`Texto da nota ${n.title}`}
                  value={n.text}
                  onChange={(e) => update(n.id, { text: e.target.value })}
                  rows={Math.min(12, Math.max(4, Math.ceil(n.text.length / 110) + n.text.split('\n').length))}
                  className="w-full px-3.5 py-3 rounded-xl bg-white/80 dark:bg-stone-800/70 border border-black/8 dark:border-white/10 text-[13px] leading-relaxed outline-none focus:border-accent/60 focus:shadow-[0_0_0_4px_rgba(181,85,47,0.12)]"
                />
              </section>
            );
          })}

          <section aria-label="Carta de responsabilidade da administração" className={`${SURFACE} rounded-[22px] p-5 space-y-3`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h2 className="text-[14px] font-semibold tracking-tight">Carta de responsabilidade da administração</h2>
                <p className="text-[12px] text-stone-500 max-w-2xl">
                  O representante legal declara a você que as informações e os documentos do exercício de {year} são fidedignos, que os documentos são idôneos, que
                  os estoques foram levantados e que não há fraudes nem fatos que afetem a continuidade. Texto-padrão: gere, imprima e colete a assinatura.
                </p>
              </div>
              <button type="button" disabled={letterBusy} onClick={() => void exportLetter()} className={BUTTON.secondary}>
                {letterBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" strokeWidth={1.75} />}
                {letterBusy ? 'Gerando…' : 'Gerar carta (PDF)'}
              </button>
            </div>
            {gaps.length > 0 && (
              <ul className="space-y-1">
                {gaps.map((g) => (
                  <li key={g} className="flex items-start gap-2 text-[12px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {g}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {signature.toast}
    </main>
  );
}
