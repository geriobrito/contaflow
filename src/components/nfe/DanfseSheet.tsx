'use client';

import { useState } from 'react';
import { CheckCircle2, FileDown, XCircle } from 'lucide-react';
import { parseNFeXml, NFSE_MODEL } from '@/lib/nfe/parser';
import { DANFSE_SITUATION_LABEL, generateDanfse, type DanfseSituation } from '@/lib/nfe/danfse';
import { sanitizeFileName } from '@/lib/export/ledger-pdf';
import { reportError } from '@/lib/monitoring';
import { describeError } from '@/lib/utils/errors';
import { BUTTON, FIELD_LABEL, IOSSwitch, SegmentedControl, Sheet } from '@/components/ui/primitives';

interface FileResult {
  name: string;
  ok: boolean;
  message: string;
}

const SITUATIONS = (Object.keys(DANFSE_SITUATION_LABEL) as DanfseSituation[]).map((value) => ({ value, label: DANFSE_SITUATION_LABEL[value] }));

/**
 * Gera a DANFSe (PDF) a partir do XML da NFS-e do padrão nacional, no navegador, pelo gerador
 * oficial da Receita. O XML não é guardado nem enviado.
 */
export function DanfseSheet({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [situation, setSituation] = useState<DanfseSituation>('NORMAL');
  const [stub, setStub] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FileResult[]>([]);

  const generate = async () => {
    setBusy(true);
    setResults([]);
    const out: FileResult[] = [];
    const { downloadBlob } = await import('@/lib/export/dre-rows');
    for (const file of files) {
      try {
        const xml = await file.text();
        const parsed = parseNFeXml(xml);
        if (parsed.kind !== 'invoice' || parsed.invoice.model !== NFSE_MODEL) {
          out.push({ name: file.name, ok: false, message: 'não é o XML de uma NFS-e do padrão nacional' });
          continue;
        }
        const inv = parsed.invoice;
        const pdf = await generateDanfse(xml, { situation, stub });
        const who = sanitizeFileName(inv.issuer.name) || 'prestador';
        downloadBlob(pdf, `DANFSe_${inv.number}_${who}.pdf`);
        out.push({ name: file.name, ok: true, message: `NFS-e ${inv.number} · ${inv.issuer.name}` });
      } catch (e) {
        reportError(e, { area: 'nfe', op: 'gerar DANFSe', level: 'warning' });
        out.push({ name: file.name, ok: false, message: describeError(e) });
      } finally {
        // Mostra cada arquivo assim que termina (inclusive os recusados).
        setResults([...out]);
      }
    }
    setBusy(false);
  };

  return (
    <Sheet
      title="DANFSe"
      subtitle="PDF da NFS-e do padrão nacional, gerado no navegador pelo gerador oficial da Receita Federal. O XML não é guardado."
      onClose={onClose}
      footer={
        <button type="button" disabled={!files.length || busy} onClick={() => void generate()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
          <FileDown className="w-4 h-4" />
          {busy ? 'Gerando…' : files.length > 1 ? `Gerar ${files.length} DANFSe` : 'Gerar DANFSe'}
        </button>
      }
    >
      <div className="space-y-4 pb-2">
        <label className="block space-y-1.5">
          <span className={FIELD_LABEL}>XML da NFS-e</span>
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            multiple
            aria-label="XML da NFS-e"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
              setResults([]);
            }}
            className="block w-full text-[13px] text-stone-700 dark:text-stone-300 file:mr-3 file:h-9 file:px-4 file:rounded-full file:border file:border-line-strong file:bg-surface file:text-[13px] file:font-medium file:text-stone-800 dark:file:text-stone-100"
          />
        </label>

        <div className="space-y-1.5">
          <span className={`block ${FIELD_LABEL}`}>Situação da nota</span>
          <SegmentedControl ariaLabel="Situação da nota" value={situation} onChange={setSituation} options={SITUATIONS} />
        </div>

        <label className="flex items-center justify-between gap-3 text-[13px] text-stone-700 dark:text-stone-300">
          Canhoto de recebimento
          <IOSSwitch checked={stub} onChange={setStub} />
        </label>

        <p className="text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
          Na primeira DANFSe, o navegador baixa o gerador (cerca de 3 MB); as seguintes saem na hora.
        </p>

        {results.length > 0 && (
          <ul aria-label="Resultado da geração" className="space-y-1.5 text-[13px]">
            {results.map((r) => (
              <li key={r.name} className={`flex items-start gap-2 ${r.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-300'}`}>
                {r.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                <span className="min-w-0">
                  <span className="font-medium">{r.name}</span>: {r.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
