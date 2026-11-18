'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, FileJson, Info, Loader2, Upload } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import type { BackupSummary, NormalizedClientBackup, RestoreMode } from '@/lib/export/client-restore';
import type { RestoreMaintenanceResult } from '@/hooks/clientes/useClientMaintenance';
import { BUTTON, Field, INPUT, OVERLINE, Sheet } from '@/components/ui/primitives';

interface RestoreClientSheetProps {
  repoMode: 'firestore' | 'local';
  restoring: boolean;
  onRestore: (
    backup: NormalizedClientBackup,
    options: { mode: RestoreMode; targetName?: string; onProgress?: (stage: string) => void }
  ) => Promise<RestoreMaintenanceResult>;
  onClose: () => void;
  onRestored: (client: ClientCompany, message: string) => Promise<void> | void;
}

/** Empresas dentro de um .zip do backup da carteira, para escolher qual restaurar. */
interface ZipChoice {
  fileName: string;
  entries: { file: string; name: string; text: string }[];
}

/**
 * Modal de importação e restauração de backup exportado pelo ContaFlow: o JSON de uma empresa ou
 * o .zip do backup da carteira (escolhe-se a empresa dentro dele).
 */
export function RestoreClientSheet({ repoMode, restoring, onRestore, onClose, onRestored }: RestoreClientSheetProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [backup, setBackup] = useState<NormalizedClientBackup | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [mode, setMode] = useState<RestoreMode>('new-company');
  const [targetName, setTargetName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<{ message: string; stage?: string; partialClientId?: string } | null>(null);
  const [zip, setZip] = useState<ZipChoice | null>(null);

  /** Lê o JSON de backup de uma empresa (direto ou de dentro do .zip). */
  const loadJson = async (text: string, name: string) => {
    try {
      const { parseClientBackup, inspectClientBackup } = await import('@/lib/export/client-restore');
      const parsed = parseClientBackup(text);
      const meta = inspectClientBackup(parsed);
      setFileName(name);
      setBackup(parsed);
      setSummary(meta);
      setMode('new-company');
      setTargetName(`${parsed.client.name} (Restaurada)`);
    } catch (e) {
      setFileName(name);
      setBackup(null);
      setSummary(null);
      setParseError(e instanceof Error ? e.message : 'Arquivo inválido.');
    }
  };

  const loadFile = async (file: File) => {
    setParseError(null);
    setRestoreError(null);
    setProgress(null);
    setZip(null);
    if (!/\.zip$/i.test(file.name)) return loadJson(await file.text(), file.name);
    try {
      const [{ readZip }, { MANIFEST_FILE }] = await Promise.all([import('@/lib/archive/zip'), import('@/lib/portfolio-backup')]);
      const files = await readZip(await file.arrayBuffer());
      const decoder = new TextDecoder();
      const manifestEntry = files.find((f) => f.name === MANIFEST_FILE);
      const names = new Map<string, string>();
      if (manifestEntry) {
        const manifest = JSON.parse(decoder.decode(manifestEntry.data)) as { files?: { file: string; name: string }[] };
        for (const f of manifest.files ?? []) names.set(f.file, f.name);
      }
      const entries = files
        .filter((f) => f.name !== MANIFEST_FILE && /\.json$/i.test(f.name))
        .map((f) => ({ file: f.name, name: names.get(f.name) ?? f.name, text: decoder.decode(f.data) }));
      if (!entries.length) throw new Error('O .zip não tem backup de nenhuma empresa.');
      setBackup(null);
      setSummary(null);
      setFileName(file.name);
      if (entries.length === 1) return loadJson(entries[0].text, `${file.name} › ${entries[0].file}`);
      setZip({ fileName: file.name, entries });
    } catch (e) {
      setFileName(file.name);
      setBackup(null);
      setSummary(null);
      setParseError(e instanceof Error ? `Não foi possível ler o .zip (${e.message}).` : 'Arquivo .zip inválido.');
    }
  };

  const handleModeChange = (next: RestoreMode) => {
    setMode(next);
    if (!backup) return;
    setTargetName(next === 'local-exact' ? backup.client.name : `${backup.client.name} (Restaurada)`);
  };

  const submit = async () => {
    if (!backup || restoring || !targetName.trim()) return;
    setRestoreError(null);
    setProgress('Iniciando restauração...');
    const res = await onRestore(backup, {
      mode,
      targetName: targetName.trim(),
      onProgress: setProgress,
    });
    if (!res.ok || !res.client) {
      setRestoreError({ message: res.message, stage: res.stage, partialClientId: res.partialClientId });
      setProgress(null);
      return;
    }
    const suffix = res.warnings?.length ? ` · ${res.warnings.length} aviso(s)` : '';
    await onRestored(res.client, `${res.message}${suffix}`);
  };

  const auxCount = summary
    ? [
        summary.hasOpeningBalances && 'abertura',
        summary.hasFixedAssets && 'imobilizado',
        summary.hasPrepaidExpenses && 'antecipadas',
        summary.hasFinancingContracts && 'financiamentos',
        summary.hasInvestments && 'aplicações',
        summary.hasStockControl && 'estoque',
        summary.hasPayrollRegister && 'folha',
      ].filter(Boolean)
    : [];

  return (
    <Sheet
      title="Restaurar backup"
      subtitle={summary ? `${summary.clientName} · arquivo v${summary.version}` : 'Importe um arquivo JSON gerado pelo ContaFlow'}
      onClose={restoring ? () => {} : onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" disabled={restoring} onClick={onClose} className={BUTTON.ghost}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!backup || restoring || !targetName.trim()}
            onClick={() => void submit()}
            className={BUTTON.accent}
          >
            {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {restoring ? 'Restaurando…' : 'Restaurar empresa'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 pb-2 text-[13px] text-stone-600 dark:text-stone-300">
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json,.zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = '';
          }}
        />

        <button
          type="button"
          disabled={restoring}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file && !restoring) void loadFile(file);
          }}
          className="w-full flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-2xl border border-dashed border-line-strong bg-surface-2/60 hover:border-accent/60 hover:bg-surface-2 transition-colors text-center"
        >
          <FileJson className="w-6 h-6 text-stone-400" />
          <span className="font-medium text-stone-800 dark:text-stone-100">
            {fileName ? `Arquivo: ${fileName}` : 'Clique ou arraste o JSON de backup da empresa ou o .zip do backup da carteira'}
          </span>
          <span className="text-[12px] text-stone-500 dark:text-stone-400">Compatível com backups v1 e v2 do ContaFlow</span>
        </button>

        {zip && (
          <label className="block space-y-1.5">
            <span className="block text-[12px] font-medium text-stone-600 dark:text-stone-400">Empresa do backup da carteira</span>
            <select
              aria-label="Empresa do backup da carteira"
              defaultValue=""
              disabled={restoring}
              onChange={(e) => {
                const entry = zip.entries.find((x) => x.file === e.target.value);
                setParseError(null);
                if (entry) void loadJson(entry.text, `${zip.fileName} › ${entry.file}`);
              }}
              className={INPUT}
            >
              <option value="" disabled>
                Escolha a empresa ({zip.entries.length} no arquivo)…
              </option>
              {zip.entries.map((x) => (
                <option key={x.file} value={x.file}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {parseError && (
          <p className="flex gap-2 rounded-2xl px-4 py-3 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200/60 dark:border-rose-500/25">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{parseError}</span>
          </p>
        )}

        {summary && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={OVERLINE}>Conteúdo do backup</p>
                  <p className="mt-1 font-medium text-stone-900 dark:text-stone-100">{summary.clientName}</p>
                  <p className="text-[12px] text-stone-500 dark:text-stone-400">
                    {summary.cnpj || 'Sem CNPJ'} · Exportado em {summary.exportedAt.slice(0, 10)} · versão {summary.version}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 pt-2 border-t border-line text-[12px]">
                <div>
                  <dt className="text-stone-500">Bancários</dt>
                  <dd className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">{summary.transactions}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Diário</dt>
                  <dd className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">{summary.journalEntries}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Fechamentos</dt>
                  <dd className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">{summary.periodLocks}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Contas / Regras</dt>
                  <dd className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">
                    {summary.accounts} / {summary.rules}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">Notas fiscais</dt>
                  <dd className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">{summary.invoices}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Checklists / Notas</dt>
                  <dd className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">
                    {summary.closingChecklists} / {summary.explanatoryNotes}
                  </dd>
                </div>
              </dl>
              {auxCount.length > 0 && (
                <p className="text-[12px] text-stone-500 dark:text-stone-400 pt-1 border-t border-line">
                  Inclui: {auxCount.join(', ')}.
                </p>
              )}
            </div>

            {repoMode === 'local' ? (
              <div className="space-y-2">
                <p className={OVERLINE}>Modo de restauração</p>
                <div className="grid grid-cols-1 gap-2">
                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-line bg-surface cursor-pointer">
                    <input
                      type="radio"
                      name="restoreMode"
                      checked={mode === 'new-company'}
                      disabled={restoring}
                      onChange={() => handleModeChange('new-company')}
                      className="mt-1"
                    />
                    <span className="text-[12px]">
                      <strong className="block text-stone-900 dark:text-stone-100">Importar como nova empresa (remapeando IDs)</strong>
                      Mantém eventuais empresas existentes intactas e gera novos identificadores internos.
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-line bg-surface cursor-pointer">
                    <input
                      type="radio"
                      name="restoreMode"
                      checked={mode === 'local-exact'}
                      disabled={restoring}
                      onChange={() => handleModeChange('local-exact')}
                      className="mt-1"
                    />
                    <span className="text-[12px]">
                      <strong className="block text-stone-900 dark:text-stone-100">Restaurar fielmente no modo local (IDs originais)</strong>
                      Preserva IDs exatos, sequência de lançamentos e trilha histórica; sobrescreve empresa local com o mesmo ID.
                    </span>
                  </label>
                </div>
              </div>
            ) : (
              <p className="flex gap-2 rounded-2xl px-4 py-3 bg-surface-2 text-stone-700 dark:text-stone-300 border border-line text-[12px]">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-stone-500" />
                <span>
                  Na nuvem (Firestore), o backup é importado como uma nova empresa com novos IDs para não colidir com dados ou trilhas imutáveis
                  existentes. O histórico de auditoria antigo permanece no JSON.
                </span>
              </p>
            )}

            <Field label="Nome da empresa restaurada">
              <input
                type="text"
                value={targetName}
                disabled={restoring}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="Razão social da cópia restaurada"
                className={INPUT}
              />
            </Field>

            {summary.auditTruncated && (
              <p className="flex gap-2 rounded-2xl px-4 py-3 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 border border-amber-200/70 dark:border-amber-500/25 text-[12px]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Este backup atingiu o teto de 20.000 eventos de auditoria quando foi exportado; registros mais antigos não constam nele.</span>
              </p>
            )}
          </div>
        )}

        {progress && (
          <p className="flex items-center gap-2 rounded-2xl px-4 py-3 bg-surface-2 border border-line text-[12px] text-stone-700 dark:text-stone-200">
            <Loader2 className="w-4 h-4 animate-spin shrink-0 text-accent" />
            <span>{progress}</span>
          </p>
        )}

        {restoreError && (
          <div className="flex gap-2 rounded-2xl px-4 py-3 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200/60 dark:border-rose-500/25 text-[12px]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">
                {restoreError.stage ? `Falha em “${restoreError.stage}”` : 'Falha na restauração'}: {restoreError.message}
              </p>
              {restoreError.partialClientId && (
                <p>
                  Uma cópia parcial ({restoreError.partialClientId}) pode ter sido criada na carteira; exclua-a antes de tentar novamente.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

