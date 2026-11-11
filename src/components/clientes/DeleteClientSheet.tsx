'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import { BUTTON, Sheet } from '@/components/ui/primitives';

interface DeleteClientSheetProps {
  client: ClientCompany;
  backingUp: boolean;
  /** Baixa o backup; devolve se deu certo. */
  onBackup: () => Promise<boolean>;
  onClose: () => void;
  onConfirm: () => void;
}

/** Confirmação de exclusão de empresa, oferecendo o backup antes. Pede dois toques. */
export function DeleteClientSheet({ client, backingUp, onBackup, onClose, onConfirm }: DeleteClientSheetProps) {
  const [saved, setSaved] = useState(false);
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
          onClick={() => void onBackup().then((ok) => ok && setSaved(true))}
          className={`${BUTTON.secondary} w-full`}
        >
          {saved ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300" /> : <Download className="w-4 h-4" />}
          {backingUp ? 'Gerando backup…' : saved ? 'Backup baixado · baixar de novo' : 'Baixar backup (JSON)'}
        </button>
        {!saved && <p className="text-[12px] text-stone-400">Sem o backup, os dados excluídos não poderão ser recuperados.</p>}
      </div>
    </Sheet>
  );
}
