'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import { BUTTON, Sheet } from '@/components/ui/primitives';

interface DeleteClientSheetProps {
  client: ClientCompany;
  backingUp: boolean;
  /** Baixa o backup; devolve se deu certo e se a auditoria atingiu o teto. */
  onBackup: () => Promise<{ ok: boolean; auditTruncated?: boolean }>;
  onClose: () => void;
  onConfirm: () => void;
}

/** Confirmação de exclusão de empresa, oferecendo o backup antes. Pede dois toques. */
export function DeleteClientSheet({ client, backingUp, onBackup, onClose, onConfirm }: DeleteClientSheetProps) {
  const [saved, setSaved] = useState(false);
  const [auditTruncated, setAuditTruncated] = useState(false);
  const [armed, setArmed] = useState(false);

  return (
    <Sheet
      title="Excluir empresa"
      subtitle={client.tradeName || client.name}
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={backingUp}
          onClick={() => (armed ? onConfirm() : setArmed(true))}
          className={`w-full h-12 rounded-2xl text-[15px] font-medium text-white transition-all active:scale-[0.98] disabled:opacity-40 ${armed ? 'bg-rose-700' : 'bg-rose-600 hover:bg-rose-700'}`}
        >
          {armed ? 'Toque de novo para excluir definitivamente' : 'Excluir empresa e todos os dados'}
        </button>
      }
    >
      <div className="space-y-4 pb-2 text-[13px] text-stone-600 dark:text-stone-300">
        <p className="flex gap-2 rounded-2xl px-4 py-3 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200/60 dark:border-rose-500/25">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            A exclusão não tem volta: apaga lançamentos, extratos, regras, plano de contas, contas bancárias, saldos de abertura, lançamentos
            manuais, fechamentos e pendências desta empresa. Só a trilha de auditoria é preservada.
          </span>
        </p>
        <p>Antes de excluir, guarde uma cópia: o backup reúne todos esses dados num arquivo JSON.</p>
        <button
          type="button"
          disabled={backingUp}
          onClick={() =>
            void onBackup().then((res) => {
              if (!res.ok) return;
              setSaved(true);
              setAuditTruncated(Boolean(res.auditTruncated));
            })
          }
          className={`${BUTTON.secondary} w-full`}
        >
          {saved ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300" /> : <Download className="w-4 h-4" />}
          {backingUp ? 'Gerando backup…' : saved ? 'Backup baixado · baixar de novo' : 'Baixar backup (JSON)'}
        </button>
        {saved && auditTruncated && (
          <p className="flex gap-2 rounded-2xl px-4 py-3 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 border border-amber-200/70 dark:border-amber-500/25 text-[12px]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Auditoria parcial neste backup: o histórico atingiu o limite de 20.000 eventos por arquivo, então registros mais antigos ficaram de
              fora do JSON (eles permanecem guardados na nuvem).
            </span>
          </p>
        )}
        {!saved && <p className="text-[12px] text-stone-500 dark:text-stone-400">Sem o backup, os dados excluídos não poderão ser recuperados.</p>}
      </div>
    </Sheet>
  );
}
